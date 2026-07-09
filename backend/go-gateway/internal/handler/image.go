package handler

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/config"
	"go-gateway/internal/middleware"
	"go-gateway/internal/orchestrator"
	"go-gateway/internal/pkg/response"
	"go-gateway/internal/service"
)

// 本文件原是 1500 行的"上帝 handler"：HTTP 协议层、业务编排、外部调用、
// 异步补偿全部塞在一起。现已按"资源 + 编排"分层重构：
//   - 业务编排（额度预留 → 调 AI API → 异步持久化 + saga 补偿）下沉到
//     internal/orchestrator，多点回滚由 saga 框架显式建模。
//   - 本文件只保留 HTTP 协议层：解析请求、调用 orchestrator、写响应，
//     以及不涉及编排的薄 CRUD/存储代理（UploadReference / ProxyStorage / history）。
//
// 类型别名（ImageGenResponse 等）保持 handler 包对外 API 不变，现有测试零改动。

// --- 类型别名：re-export orchestrator 的 domain 类型，保持 handler 包 API 稳定 ---

// ImageGenRequest 是图片生成请求体（与 orchestrator.GenRequest 等价）。
type ImageGenRequest = orchestrator.GenRequest

// ImageGenReference 表示一张参考图。
type ImageGenReference = orchestrator.GenReference

// ImageGenResponse 是图片生成响应体。
type ImageGenResponse = orchestrator.GenResponse

// ImageResult 表示一张生成结果。
type ImageResult = orchestrator.ImageResult

// ImageHandler 是图片相关的 HTTP handler。
//
// 业务编排委托给 orchestrator；本结构同时持有 storageService 等依赖，
// 供 UploadReference / ProxyStorage / history 等薄 CRUD 方法直接使用，
// 以及 Diagnostics 报告各服务可用性。
type ImageHandler struct {
	orch           *orchestrator.ImageOrchestrator
	storageService orchestrator.StorageService     // 薄 CRUD/代理方法直接使用
	creditService  orchestrator.CreditService      // 仅 Diagnostics 报告可用性
	idempotencySvc orchestrator.IdempotencyService // 仅 Diagnostics 报告可用性
	httpClient     *http.Client                    // 仅 Diagnostics 报告可用性
}

// NewImageHandler 创建图片 handler。credit/storage/idempotency 可为 nil（表示禁用）。
func NewImageHandler(
	creditService orchestrator.CreditService,
	storageService orchestrator.StorageService,
	idempotencySvc orchestrator.IdempotencyService,
) *ImageHandler {
	creditService = normalizeCreditService(creditService)
	storageService = normalizeStorageService(storageService)
	idempotencySvc = normalizeIdempotencyService(idempotencySvc)
	orch := orchestrator.NewImageOrchestrator(creditService, storageService, idempotencySvc)
	return &ImageHandler{
		orch:           orch,
		storageService: storageService,
		creditService:  creditService,
		idempotencySvc: idempotencySvc,
		httpClient:     &http.Client{},
	}
}

func normalizeCreditService(service orchestrator.CreditService) orchestrator.CreditService {
	if dependencyIsNil(service) {
		return nil
	}
	return service
}

func normalizeStorageService(service orchestrator.StorageService) orchestrator.StorageService {
	if dependencyIsNil(service) {
		return nil
	}
	return service
}

func normalizeIdempotencyService(service orchestrator.IdempotencyService) orchestrator.IdempotencyService {
	if dependencyIsNil(service) {
		return nil
	}
	return service
}

func dependencyIsNil(value any) bool {
	if value == nil {
		return true
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return reflected.IsNil()
	default:
		return false
	}
}

// WithProviderSettings 注入图片 Provider 配置源。返回自身以支持链式调用。
func (h *ImageHandler) WithProviderSettings(providerSettingsSvc orchestrator.ProviderSettingsService) *ImageHandler {
	h.orch = h.orch.WithProviderSettings(providerSettingsSvc)
	return h
}

type referenceUploadResponse struct {
	Reference ImageGenReference `json:"reference"`
}

const referenceUploadMaxBytes = 12 * 1024 * 1024
const imageGenerateMaxBytes = 2 * 1024 * 1024

// Generate handles POST /api/image/generate
//
// 瘦 handler：只负责 HTTP 协议层（访客开关、body 读取、prompt 校验），
// 业务编排（幂等、额度、调 API、异步持久化）全部委托给 orchestrator。
func (h *ImageHandler) Generate(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)

	// 访客与免费生成开关
	if user == nil && !config.GuestGenerationEnabled {
		response.Error(w, http.StatusForbidden, "请先登录后再生成图片")
		return
	}
	if user == nil && !config.FreeGenerationEnabled {
		response.Error(w, http.StatusForbidden, "免费生成已关闭，请登录后使用额度生成")
		return
	}

	// 读取原始 body（用于幂等指纹），再恢复供 JSON 解码
	body := http.MaxBytesReader(w, r.Body, imageGenerateMaxBytes)
	defer body.Close()
	rawBody, err := io.ReadAll(body)
	if err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			response.Error(w, http.StatusRequestEntityTooLarge, "请求内容过大。")
			return
		}
		response.Error(w, http.StatusBadRequest, "无效的请求格式。")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(rawBody))

	var req ImageGenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "无效的请求格式。")
		return
	}

	// 校验 prompt
	if req.Prompt == "" {
		response.Error(w, http.StatusBadRequest, "请输入图片描述。")
		return
	}
	if h.storageService == nil {
		log.Printf("[image] 503: storageService is nil (DB not configured or connection failed)")
		response.Error(w, http.StatusServiceUnavailable, "图片存储服务暂时不可用。")
		return
	}

	idemKey := r.Header.Get("Idempotency-Key")

	// 委托业务编排
	resp, statusErr := h.orch.Generate(r.Context(), orchestrator.GenerateParams{
		User:    user,
		RawBody: rawBody,
		IdemKey: idemKey,
		Request: req,
	})
	if statusErr != nil {
		// 幂等重放：直接写回缓存的原始字节
		if statusErr.Body != nil {
			for k, v := range statusErr.Headers {
				w.Header().Set(k, v)
			}
			w.WriteHeader(statusErr.Code)
			_, _ = w.Write(statusErr.Body)
			return
		}
		response.Error(w, statusErr.Code, statusErr.Message)
		return
	}

	response.JSON(w, http.StatusOK, resp)
}

// UploadReference handles POST /api/image/references.
func (h *ImageHandler) UploadReference(w http.ResponseWriter, r *http.Request) {
	if h.storageService == nil {
		response.Error(w, http.StatusServiceUnavailable, "参考图存储服务暂时不可用。")
		return
	}

	mime := requestContentType(r)
	if !isAllowedReferenceMime(mime) {
		response.Error(w, http.StatusUnsupportedMediaType, "reference image type is not supported")
		return
	}

	body := http.MaxBytesReader(w, r.Body, referenceUploadMaxBytes)
	defer body.Close()
	data, err := io.ReadAll(body)
	if err != nil {
		response.Error(w, http.StatusRequestEntityTooLarge, "reference image is too large")
		return
	}
	if len(data) == 0 {
		response.Error(w, http.StatusBadRequest, "reference image is required")
		return
	}

	user := middleware.GetUserFromRequest(r)
	userID := "anon"
	if user != nil && user.ID != "" {
		userID = user.ID
	}
	referenceID := headerText(r.Header.Get("x-reference-id"), 80)
	if referenceID == "" {
		referenceID = "ref_" + randomID()
	}
	title := headerText(r.Header.Get("x-reference-title"), 80)
	if title == "" {
		title = "参考图"
	}
	fileName := headerText(r.Header.Get("x-reference-filename"), 120)
	if fileName == "" {
		fileName = referenceID + "." + extensionForMime(mime)
	}
	uploadName := safeUploadName(fileName, extensionForMime(mime))

	storagePath := strings.Join([]string{
		"references",
		"uploads",
		safePathPart(userID, "anon"),
		fmt.Sprintf("%d_%s_%s", time.Now().UnixMilli(), randomID(), uploadName),
	}, "/")
	stored, err := h.storageService.StoreFromBufferAtPath(r.Context(), data, mime, storagePath)
	if err != nil || stored == nil || stored.StoragePath == "" {
		log.Printf("[image] reference upload failed: %v", err)
		response.Error(w, http.StatusServiceUnavailable, "参考图上传失败，请稍后重试。")
		return
	}

	response.JSON(w, http.StatusOK, referenceUploadResponse{
		Reference: ImageGenReference{
			ID:          referenceID,
			Title:       title,
			StoragePath: stored.StoragePath,
			PreviewURL:  firstNonEmpty(stored.PreviewURL, stored.PublicURL),
			FileName:    fileName,
		},
	})
}

// ProxyStorage handles GET /api/image/storage/{encodedPath}.
// Public images (and reference uploads without a DB record) are served to
// anyone. Private generated images require the authenticated user to own them.
func (h *ImageHandler) ProxyStorage(w http.ResponseWriter, r *http.Request) {
	if h.storageService == nil {
		response.Error(w, http.StatusServiceUnavailable, "图片存储服务暂时不可用。")
		return
	}
	encodedPath := strings.TrimPrefix(chi.URLParam(r, "*"), "/")
	if encodedPath == "" {
		encodedPath = chi.URLParam(r, "encodedPath")
	}
	storagePath, ok := safeProxyStoragePath(encodedPath)
	if !ok {
		response.Error(w, http.StatusBadRequest, "invalid image storage path")
		return
	}

	// Enforce ownership gate for private images. Look up the DB record, if any,
	// and deny access when visibility is "private" and the requester isn't the owner.
	visibility, ownerID, visErr := h.storageService.GetImageVisibilityByPath(r.Context(), storagePath)
	if visErr != nil {
		log.Printf("[image] ProxyStorage: visibility lookup failed: %v", visErr)
		response.Error(w, http.StatusInternalServerError, "图片访问验证失败。")
		return
	}
	if visibility == "private" {
		user := middleware.GetUserFromRequest(r)
		if user == nil || user.ID != ownerID {
			response.Error(w, http.StatusForbidden, "无权访问该图片。")
			return
		}
	}

	image, err := h.storageService.DownloadImage(r.Context(), storagePath)
	if err != nil || image == nil || len(image.Data) == 0 {
		response.Error(w, http.StatusNotFound, "image not found")
		return
	}

	w.Header().Set("Content-Type", firstNonEmpty(image.Mime, mimeFromPath(storagePath)))
	w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(image.Data)
}

type ImageHistoryListResponse struct {
	Images      []service.ImageHistoryItem `json:"images"`
	Total       int                        `json:"total"`
	Limit       int                        `json:"limit,omitempty"`
	Offset      int                        `json:"offset,omitempty"`
	HasMore     bool                       `json:"hasMore"`
	NextOffset  *int                       `json:"nextOffset"`
	Persistence bool                       `json:"persistence"`
}

// ListHistory handles GET /api/image/history
func (h *ImageHandler) ListHistory(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	scope := r.URL.Query().Get("scope")
	if scope == "" {
		scope = "public"
	}
	if scope == "mine" && (user == nil || user.ID == "") {
		response.JSON(w, http.StatusOK, ImageHistoryListResponse{
			Images:      []service.ImageHistoryItem{},
			Total:       0,
			Persistence: h.storageService != nil,
		})
		return
	}

	// Parse pagination
	limit := 12
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
			if limit > 50 {
				limit = 50
			}
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	// Get history from storage
	var userID string
	if scope == "mine" && user != nil {
		userID = user.ID
	}

	if h.storageService == nil {
		response.JSON(w, http.StatusOK, ImageHistoryListResponse{
			Images:      []service.ImageHistoryItem{},
			Total:       0,
			Limit:       limit,
			Offset:      offset,
			Persistence: false,
		})
		return
	}

	history, err := h.storageService.ListImageHistory(r.Context(), userID, scope, limit, offset)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "图片历史加载失败。")
		return
	}

	hasMore := offset+len(history.Images) < history.Total
	var nextOffset *int
	if hasMore {
		value := offset + len(history.Images)
		nextOffset = &value
	}

	response.JSON(w, http.StatusOK, ImageHistoryListResponse{
		Images:      history.Images,
		Total:       history.Total,
		Limit:       limit,
		Offset:      offset,
		HasMore:     hasMore,
		NextOffset:  nextOffset,
		Persistence: true,
	})
}

// GetHistoryDetail handles GET /api/image/history/:id
func (h *ImageHandler) GetHistoryDetail(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		response.Error(w, http.StatusBadRequest, "图片ID不能为空。")
		return
	}

	user := middleware.GetUserFromRequest(r)
	scope := r.URL.Query().Get("scope")
	if scope == "" {
		scope = "public"
	}
	if h.storageService == nil {
		response.Error(w, http.StatusNotFound, "图片不存在。")
		return
	}

	var userID string
	if scope == "mine" && user != nil {
		userID = user.ID
	}

	image, err := h.storageService.GetImageHistory(r.Context(), id, userID, scope)
	if err != nil || image == nil {
		response.Error(w, http.StatusNotFound, "图片不存在。")
		return
	}

	response.JSON(w, http.StatusOK, map[string]any{
		"image":       image,
		"persistence": true,
	})
}

// DeleteHistory handles DELETE /api/image/history/:id
func (h *ImageHandler) DeleteHistory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		response.Error(w, http.StatusBadRequest, "图片ID不能为空。")
		return
	}

	user := middleware.GetUserFromRequest(r)
	if user == nil || user.ID == "" {
		response.Error(w, http.StatusUnauthorized, "请先登录。")
		return
	}
	if h.storageService == nil {
		response.Error(w, http.StatusServiceUnavailable, "图片历史服务暂时不可用。")
		return
	}

	deleted, err := h.storageService.DeleteImageHistory(r.Context(), id, user.ID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "删除失败。")
		return
	}

	response.JSON(w, http.StatusOK, map[string]any{
		"ok":          deleted,
		"persistence": true,
	})
}

// ClearHistory handles DELETE /api/image/history
func (h *ImageHandler) ClearHistory(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	if user == nil || user.ID == "" {
		response.Error(w, http.StatusUnauthorized, "请先登录。")
		return
	}
	if h.storageService == nil {
		response.Error(w, http.StatusServiceUnavailable, "图片历史服务暂时不可用。")
		return
	}

	deleted, err := h.storageService.ClearImageHistory(r.Context(), user.ID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "清理失败。")
		return
	}

	response.JSON(w, http.StatusOK, map[string]any{
		"ok":          deleted,
		"persistence": true,
	})
}

// RegisterRoutes registers image routes
func (h *ImageHandler) RegisterRoutes(r chi.Router) {
	r.Post("/references", h.UploadReference)
	r.Get("/storage/*", h.ProxyStorage)
	r.Post("/generate", h.Generate)
	r.Get("/history", h.ListHistory)
	r.Get("/history/{id}", h.GetHistoryDetail)
	r.Delete("/history/{id}", h.DeleteHistory)
	r.Delete("/history", h.ClearHistory)
	if config.EnableDiagnostics {
		r.Get("/diagnostics", h.Diagnostics)
	}
}

// diagnosticsResponse is the typed response for the diagnostics endpoint.
// It only exposes boolean service-availability flags — no internal details.
type diagnosticsResponse struct {
	StorageService bool `json:"storageService"`
	CreditService  bool `json:"creditService"`
	IdempotencySvc bool `json:"idempotencySvc"`
	HTTPClient     bool `json:"httpClient"`
}

// Diagnostics handles GET /api/image/diagnostics — returns service status
// for debugging 503 errors. Only registered when ENABLE_DIAGNOSTICS=true.
func (h *ImageHandler) Diagnostics(w http.ResponseWriter, r *http.Request) {
	status := diagnosticsResponse{
		StorageService: h.storageService != nil,
		CreditService:  h.creditService != nil,
		IdempotencySvc: h.idempotencySvc != nil,
		HTTPClient:     h.httpClient != nil,
	}
	response.JSON(w, http.StatusOK, status)
}

// --- HTTP-only helpers（业务 helper 已迁移到 orchestrator 包） ---

func requestContentType(r *http.Request) string {
	mime := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if mime == "image/jpg" {
		return "image/jpeg"
	}
	if mime == "" {
		return "application/octet-stream"
	}
	return mime
}

func isAllowedReferenceMime(mime string) bool {
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return true
	default:
		return false
	}
}

func extensionForMime(mime string) string {
	switch mime {
	case "image/jpeg", "image/jpg":
		return "jpg"
	case "image/webp":
		return "webp"
	case "image/gif":
		return "gif"
	default:
		return "png"
	}
}

func headerText(value string, maxLength int) string {
	if value == "" {
		return ""
	}
	decoded, err := url.QueryUnescape(value)
	if err != nil {
		decoded = value
	}
	decoded = strings.ReplaceAll(decoded, "\r", " ")
	decoded = strings.ReplaceAll(decoded, "\n", " ")
	decoded = strings.TrimSpace(decoded)
	if len(decoded) > maxLength {
		return decoded[:maxLength]
	}
	return decoded
}

// safePathPart sanitizes a single path segment for use in generated storage
// paths. This is intentionally stricter than service.safePathPart in
// internal/service/imageproc.go: it collapses the value to path.Base and
// disallows "/", "." and other separators so the result is safe to embed in
// URL path segments. The service version permits "/" and "." so that nested
// storage prefixes are preserved.
func safePathPart(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = fallback
	}
	value = strings.Trim(path.Base(value), ". ")
	var builder strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			builder.WriteRune(r)
		} else {
			builder.WriteByte('_')
		}
		if builder.Len() >= 80 {
			break
		}
	}
	result := strings.Trim(builder.String(), "_")
	if result == "" {
		return fallback
	}
	return result
}

func safeUploadName(fileName, extension string) string {
	stem := strings.TrimSuffix(fileName, path.Ext(fileName))
	stem = safePathPart(stem, "reference")
	stem = strings.Trim(stem, "_")
	if stem == "" {
		stem = "reference"
	}
	return stem + "." + extension
}

func safeProxyStoragePath(value string) (string, bool) {
	if value == "" {
		return "", false
	}
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return "", false
	}
	decoded = strings.TrimSpace(decoded)
	if decoded == "" || strings.HasPrefix(decoded, "/") || strings.HasPrefix(decoded, "\\") {
		return "", false
	}
	if strings.Contains(decoded, "..") || strings.HasPrefix(strings.ToLower(decoded), "http:") || strings.HasPrefix(strings.ToLower(decoded), "https:") || strings.HasPrefix(strings.ToLower(decoded), "data:") {
		return "", false
	}
	return decoded, true
}

func mimeFromPath(storagePath string) string {
	switch strings.ToLower(path.Ext(storagePath)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	default:
		return "image/png"
	}
}

func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
