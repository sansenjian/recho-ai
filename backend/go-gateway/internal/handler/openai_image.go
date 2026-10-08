package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/config"
	"go-gateway/internal/middleware"
	"go-gateway/internal/orchestrator"
	"go-gateway/internal/pkg/response"
)

// 本文件实现 OpenAI 兼容的图片生成端点，让外部客户端（OpenAI SDK、New API、
// 各类画图前端）把本站当作 `baseURL` 即可调用。
//
// 分工：
//   - 协议转换只发生在本层。请求从 OpenAI 形状翻译为 orchestrator.GenRequest，
//     响应从 GenResponse 翻译回 OpenAI 形状。
//   - 计费、额度预留、存储、saga 补偿全部复用既有编排，本层不重复实现。
//
// 认证走既有 rk-* 密钥（middleware.AuthMiddleware 已解析），因此外部调用扣的是
// 密钥所属用户的 credit，价格沿用管理后台按模型配置的单价。

const (
	// OpenAI 生图响应格式。
	openAIImageFormatURL     = "url"
	openAIImageFormatB64JSON = "b64_json"
)

// openAIImageRequest 是 OpenAI /v1/images/generations 的请求体。
//
// 只声明会被采纳的字段。n、size、response_format 之外的 OpenAI 参数
// （如 user、style）在本站没有对应语义，静默忽略比报错更利于客户端兼容。
type openAIImageRequest struct {
	Prompt         string `json:"prompt"`
	Model          string `json:"model,omitempty"`
	N              int    `json:"n,omitempty"`
	Size           string `json:"size,omitempty"`
	Quality        string `json:"quality,omitempty"`
	ResponseFormat string `json:"response_format,omitempty"`
	// Background 仅接受 "transparent"，映射到本站的透明背景能力。
	Background string `json:"background,omitempty"`
}

// openAIImageResponse 是 OpenAI /v1/images/generations 的响应体。
type openAIImageResponse struct {
	Created int64                     `json:"created"`
	Data    []openAIImageResponseItem `json:"data"`
}

// openAIImageResponseItem 是响应中的单张图片。
//
// URL 与 B64JSON 互斥：由 response_format 决定填哪个，另一个留空不序列化。
type openAIImageResponseItem struct {
	URL           string `json:"url,omitempty"`
	B64JSON       string `json:"b64_json,omitempty"`
	RevisedPrompt string `json:"revised_prompt,omitempty"`
}

// openAIErrorResponse 是 OpenAI 风格的错误响应。
//
// OpenAI 客户端按 {"error":{"message","type","code"}} 解析失败原因，
// 沿用本站的 {"error":"..."} 会让客户端读不到信息，故错误路径单独包装。
type openAIErrorResponse struct {
	Error openAIErrorDetail `json:"error"`
}

type openAIErrorDetail struct {
	Message string `json:"message"`
	Type    string `json:"type"`
	Code    string `json:"code,omitempty"`
}

// openAIModelList 是 GET /v1/models 的响应体。
type openAIModelList struct {
	Object string        `json:"object"`
	Data   []openAIModel `json:"data"`
}

type openAIModel struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

// sizeToAspectRatioResolution 把 OpenAI 的 "宽x高" 解析为本站的
// aspectRatio + resolution 组合。
//
// 优先查本站尺寸表（见 orchestrator.determineSize）反向映射，命中时能精确还原
// 原始尺寸；未命中时按宽高比归类并给出最接近的 resolution，避免直接报错。
//
// 返回 ok=false 表示 size 无法解析为合法尺寸（格式错误或超出合理范围）。
func sizeToAspectRatioResolution(size string) (aspectRatio string, resolution string, ok bool) {
	width, height, parsed := parseOpenAISize(size)
	if !parsed {
		return "", "", false
	}

	// 与本站尺寸表一一对应：命中即精确还原。
	for _, res := range []string{"1k", "2k", "4k"} {
		for _, ratio := range []string{"1:1", "3:2", "2:3", "16:9", "9:16"} {
			if orchestrator.DetermineSize(res, ratio) == size {
				return ratio, res, true
			}
		}
	}

	// 表外尺寸：按宽高比归类，resolution 取像素规模最接近的一档。
	ratio := nearestSupportedAspectRatio(width, height)
	return ratio, resolutionForPixelCount(width * height), true
}

// parseOpenAISize 解析 "1024x1024" 形式的尺寸字符串。
func parseOpenAISize(size string) (int, int, bool) {
	trimmed := strings.ToLower(strings.TrimSpace(size))
	if trimmed == "" {
		return 0, 0, false
	}
	parts := strings.Split(trimmed, "x")
	if len(parts) != 2 {
		return 0, 0, false
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
	if widthErr != nil || heightErr != nil {
		return 0, 0, false
	}
	// 与 orchestrator.parseAspectRatio 的上限保持一致，避免上游收到无法处理的尺寸。
	if width < 1 || height < 1 || width > 10000 || height > 10000 {
		return 0, 0, false
	}
	return width, height, true
}

// nearestSupportedAspectRatio 把任意宽高比归到本站支持的五种比例之一。
func nearestSupportedAspectRatio(width, height int) string {
	target := float64(width) / float64(height)
	best := "1:1"
	bestDelta := -1.0
	for _, candidate := range []struct {
		ratio string
		value float64
	}{
		{"1:1", 1.0},
		{"3:2", 1.5},
		{"2:3", 2.0 / 3.0},
		{"16:9", 16.0 / 9.0},
		{"9:16", 9.0 / 16.0},
	} {
		delta := target - candidate.value
		if delta < 0 {
			delta = -delta
		}
		if bestDelta < 0 || delta < bestDelta {
			best = candidate.ratio
			bestDelta = delta
		}
	}
	return best
}

// resolutionForPixelCount 按总像素数选择最接近的 resolution 档位。
//
// 分界取相邻档位像素数的几何中点，避免小尺寸被整体推到高档：
// 1k 约 1.05M、2k 约 4.19M、4k 约 8.29M 像素。
func resolutionForPixelCount(pixels int) string {
	const (
		oneK  = 1024 * 1024
		twoK  = 2048 * 2048
		fourK = 2880 * 2880
	)
	switch {
	case pixels <= (oneK+twoK)/2:
		return "1k"
	case pixels <= (twoK+fourK)/2:
		return "2k"
	default:
		return "4k"
	}
}

// normalizeOpenAICount 把 OpenAI 的 n 收敛到本站支持的张数。
//
// 本站只支持 1/2/4/8，取「不超过 n 的最大支持值」：张数直接决定扣费金额，
// 向上取会让调用方为它没请求的图片付费（请求 3 张却扣 4 张）。少给一张的代价
// 远小于多扣一次费。n < 1 时按 1 处理，避免出现零张的请求。
func normalizeOpenAICount(n int) int {
	switch {
	case n >= 8:
		return 8
	case n >= 4:
		return 4
	case n >= 2:
		return 2
	default:
		return 1
	}
}

// openAIQualityToSiteQuality 把 OpenAI 的 quality 映射到本站档位。
func openAIQualityToSiteQuality(quality string) string {
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "low", "standard":
		return "low"
	case "high", "hd":
		return "high"
	case "medium", "auto":
		return "medium"
	default:
		return "medium"
	}
}

// writeOpenAIError 以 OpenAI 错误形状写响应。
func writeOpenAIError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(openAIErrorResponse{
		Error: openAIErrorDetail{
			Message: message,
			Type:    openAIErrorTypeForStatus(status),
			Code:    code,
		},
	})
}

// openAIErrorTypeForStatus 给出与 HTTP 状态匹配的 OpenAI 错误类型。
func openAIErrorTypeForStatus(status int) string {
	switch {
	case status == http.StatusUnauthorized:
		return "authentication_error"
	case status == http.StatusForbidden:
		return "permission_error"
	case status == http.StatusTooManyRequests:
		return "rate_limit_error"
	case status >= 500:
		return "server_error"
	default:
		return "invalid_request_error"
	}
}

// generateOpenAIImage 处理 POST /v1/images/generations。
func (h *ImageHandler) generateOpenAIImage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	// 外部端点必须携带有效密钥：访客与免费生成开关是站内语义，不适用于按额度
	// 计费的外部调用，否则任何人都能无凭证消耗他人额度。
	if user == nil || user.ID == "" {
		writeOpenAIError(w, http.StatusUnauthorized, "invalid_api_key", "缺少或无效的 API 密钥。请在 Authorization 头中提供 Bearer rk-* 密钥。")
		return
	}

	var req openAIImageRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, imageGenerateMaxBytes)).Decode(&req); err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", "无效的请求格式。")
		return
	}

	if strings.TrimSpace(req.Prompt) == "" {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", "prompt 不能为空。")
		return
	}

	format, formatErr := h.resolveResponseFormat(r.Context(), req.ResponseFormat)
	if formatErr != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", formatErr.Error())
		return
	}
	// 白名单校验必须早于计费与上游调用：编排层对未命中的模型会回退到
	// 优先级最高的 Provider，不拦的话调用方会拿到别的模型生成的图。
	if modelErr := h.validateRequestedModel(r.Context(), req.Model); modelErr != nil {
		writeOpenAIError(w, http.StatusBadRequest, "model_not_found", modelErr.Error())
		return
	}

	genReq := orchestrator.GenRequest{
		Prompt:  req.Prompt,
		Model:   strings.TrimSpace(req.Model),
		Count:   normalizeOpenAICount(req.N),
		Quality: openAIQualityToSiteQuality(req.Quality),
	}
	if size := strings.TrimSpace(req.Size); size != "" {
		aspectRatio, resolution, ok := sizeToAspectRatioResolution(size)
		if !ok {
			writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", fmt.Sprintf("不支持的 size：%s。请使用 宽x高 形式，例如 1024x1024。", req.Size))
			return
		}
		genReq.AspectRatio = aspectRatio
		genReq.Resolution = resolution
		// 显式尺寸同时下发，让编排层按原始宽高出图（表内尺寸与 resolution 结果一致）。
		genReq.ExplicitSize = size
	}
	if strings.EqualFold(strings.TrimSpace(req.Background), "transparent") {
		genReq.TransparentBackground = true
	}

	// 幂等键：外部 OpenAI 客户端不知道要传这个非标准头，因此不能强制要求。
	// 未提供时按用户 + 请求内容派生一个确定性键——同一用户用相同参数重试会命中
	// 幂等重放而不是重复扣费，这正是 OpenAI 客户端超时重试时期望的语义。
	idemKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idemKey == "" {
		resolved, resolveErr := h.resolveOpenAIIdempotencyKey(r.Context(), user.ID, genReq, format)
		if resolveErr != nil {
			// 探测失败时拒绝请求，而不是改用当前桶新建：上一桶可能已有成功记录，
			// 此刻新建会让这次重试真正再生成一张并再次扣费。宁可返回可重试的 503。
			writeOpenAIError(w, http.StatusServiceUnavailable, "idempotency_unavailable", "幂等服务暂时不可用，请稍后重试。")
			return
		}
		idemKey = resolved
	}

	// 幂等指纹必须来自规范化后的请求体，不能传 nil：编排层用 body 的哈希区分
	// 「同键同请求」与「同键不同请求」，nil 会让所有外部请求共享同一个空哈希，
	// 导致相同幂等键下的不同请求被误判为冲突。
	canonicalBody, marshalErr := json.Marshal(genReq)
	if marshalErr != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", "无法解析请求参数。")
		return
	}

	// AwaitPersistence：外部客户端要的是可直接下载的图片地址，而不是内联数据。
	// 同步等待上传完成，响应里就是存储直链（约 200 字节），
	// 避免近 1MB 的 base64 图片数据穿过网关。
	resp, statusErr := h.orch.Generate(r.Context(), orchestrator.GenerateParams{
		User:             user,
		RawBody:          canonicalBody,
		IdemKey:          idemKey,
		RequestID:        strings.TrimSpace(r.Header.Get("X-Request-ID")),
		Request:          genReq,
		AwaitPersistence: true,
	})
	if statusErr != nil {
		// 命中幂等重放时 statusErr 携带的是成功响应体，必须先识别出来，
		// 否则重试的调用方会拿到错误信封而不是缓存的图片。
		replayed, ok := replayResponse(statusErr)
		if !ok {
			writeStatusError(w, statusErr)
			return
		}
		writeReplayHeaders(w, statusErr)
		resp = replayed
	}

	items, err := h.openAIImageItems(r.Context(), resp, format)
	if err != nil {
		writeOpenAIError(w, http.StatusBadGateway, "upstream_error", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, openAIImageResponse{
		Created: time.Now().Unix(),
		Data:    items,
	})
}

// --- OpenAI 兼容：图像编辑端点 ---

const (
	// OpenAI 编辑端点的图片字段名。不同客户端用法不一：
	//   - 官方 SDK 使用 image（单数），可传一个文件或文件数组
	//   - 部分中转实现（含本站上游）使用 image[]
	// 两者都接受，避免因字段名不一致而让客户端无法接入。
	openAIImageField    = "image"
	openAIImageArrField = "image[]"

	// 每张输入图上限，与官方文档的 50MB 对齐。
	openAIEditMaxImageBytes = 50 * 1024 * 1024
	// 单次编辑请求的总体上限，防止大量图片撑爆内存。
	openAIEditMaxTotalBytes = 100 * 1024 * 1024
	// 官方允许最多 16 张输入图。
	openAIEditMaxImages = 16
	// mask 字段名，与官方 multipart 规范一致。
	openAIEditMaskField = "mask"
	// 官方要求蒙版小于 4MB（比参考图的 50MB 严格得多）。
	openAIEditMaxMaskBytes = 4 * 1024 * 1024
)

// openAIEditForm 是解析后的编辑请求。
type openAIEditForm struct {
	prompt         string
	model          string
	size           string
	quality        string
	responseFormat string
	background     string
	count          int
	references     []orchestrator.GenReference
	// mask 是局部重绘蒙版，nil 表示整图重绘。官方要求它是 PNG 且小于 4MB。
	mask *orchestrator.GenReference
}

// parseOpenAIEditForm 解析 multipart 请求并转换为本站的参考图结构。
//
// 图片直接以 data URL 形式放进 GenReference，不先落存储：编辑是一次性输入，
// 与历史记录里的参考图不同，没必要产生对象存储副作用。
func parseOpenAIEditForm(w http.ResponseWriter, r *http.Request) (*openAIEditForm, error) {
	// 先给请求体套上硬上限再解析：ParseMultipartForm 的参数只限制驻留内存的
	// 部分，超出会写临时文件。逐张与总量的上限原本在解析完成后才检查，届时
	// 整个请求体已经收完，已认证用户可以借此占用磁盘与带宽。
	// 上限取总量上限再多一点余量，留给 multipart 边界与其它表单字段。
	r.Body = http.MaxBytesReader(w, r.Body, openAIEditMaxTotalBytes+(1<<20))
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return nil, fmt.Errorf("请求体过大：上传图片总量不得超过 %d MB", openAIEditMaxTotalBytes>>20)
		}
		return nil, fmt.Errorf("无效的 multipart 表单")
	}

	form := &openAIEditForm{
		prompt:         strings.TrimSpace(r.FormValue("prompt")),
		model:          strings.TrimSpace(r.FormValue("model")),
		size:           strings.TrimSpace(r.FormValue("size")),
		quality:        strings.TrimSpace(r.FormValue("quality")),
		responseFormat: strings.ToLower(strings.TrimSpace(r.FormValue("response_format"))),
		background:     strings.TrimSpace(r.FormValue("background")),
	}

	if raw := strings.TrimSpace(r.FormValue("n")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			return nil, fmt.Errorf("n 必须是整数")
		}
		form.count = parsed
	}

	// 兼容 image 与 image[] 两种字段名。
	fileHeaders := append([]*multipart.FileHeader{}, r.MultipartForm.File[openAIImageField]...)
	fileHeaders = append(fileHeaders, r.MultipartForm.File[openAIImageArrField]...)
	if len(fileHeaders) == 0 {
		return nil, fmt.Errorf("缺少输入图片：请以 %s 字段上传", openAIImageField)
	}
	if len(fileHeaders) > openAIEditMaxImages {
		return nil, fmt.Errorf("输入图片过多：最多 %d 张", openAIEditMaxImages)
	}

	totalBytes := int64(0)
	for index, header := range fileHeaders {
		if header.Size > openAIEditMaxImageBytes {
			return nil, fmt.Errorf("第 %d 张图片过大：单张上限 %d 字节", index+1, openAIEditMaxImageBytes)
		}
		totalBytes += header.Size
		if totalBytes > openAIEditMaxTotalBytes {
			return nil, fmt.Errorf("输入图片总量过大：上限 %d 字节", openAIEditMaxTotalBytes)
		}

		file, err := header.Open()
		if err != nil {
			return nil, fmt.Errorf("无法读取第 %d 张图片", index+1)
		}
		data, readErr := io.ReadAll(io.LimitReader(file, openAIEditMaxImageBytes+1))
		_ = file.Close()
		if readErr != nil {
			return nil, fmt.Errorf("无法读取第 %d 张图片", index+1)
		}
		if len(data) == 0 {
			return nil, fmt.Errorf("第 %d 张图片为空", index+1)
		}

		mime := strings.TrimSpace(header.Header.Get("Content-Type"))
		if mime == "" || !strings.HasPrefix(mime, "image/") {
			mime = http.DetectContentType(data)
		}
		if !strings.HasPrefix(mime, "image/") {
			return nil, fmt.Errorf("第 %d 个文件不是图片", index+1)
		}

		form.references = append(form.references, orchestrator.GenReference{
			ID:       fmt.Sprintf("openai-ref-%d", index+1),
			FileName: header.Filename,
			DataUrl:  fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data)),
		})
	}

	mask, err := parseOpenAIEditMask(r)
	if err != nil {
		return nil, err
	}
	form.mask = mask

	return form, nil
}

// parseOpenAIEditMask 解析可选的 mask 字段。
//
// 官方对 mask 的要求比参考图严格：必须是 PNG、小于 4MB，且尺寸与底图一致。
// 尺寸一致性这里无法校验（参考图此时还是原始字节），所以先卡住格式与体积；
// 尺寸不符由上游报错，消息对调用方仍然可读。
//
// 返回 (nil, nil) 表示调用方没传 mask，属于整图重绘的合法用法。
func parseOpenAIEditMask(r *http.Request) (*orchestrator.GenReference, error) {
	headers := r.MultipartForm.File[openAIEditMaskField]
	if len(headers) == 0 {
		return nil, nil
	}
	if len(headers) > 1 {
		return nil, fmt.Errorf("mask 只能有一张")
	}

	header := headers[0]
	if header.Size > openAIEditMaxMaskBytes {
		return nil, fmt.Errorf("蒙版过大：上限 %d 字节", openAIEditMaxMaskBytes)
	}

	file, err := header.Open()
	if err != nil {
		return nil, fmt.Errorf("无法读取蒙版")
	}
	data, readErr := io.ReadAll(io.LimitReader(file, openAIEditMaxMaskBytes+1))
	_ = file.Close()
	if readErr != nil {
		return nil, fmt.Errorf("无法读取蒙版")
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("蒙版为空")
	}

	// 官方要求 mask 必须是 PNG：它的语义依赖 alpha 通道。JPEG 没有 alpha，
	// 放过去只会在上游得到一张全不透明的蒙版——等于什么都没改，却让人以为
	// 蒙版生效了。静默失效比直接报错更难排查，所以这里必须挡住。
	if !isPNG(data) {
		return nil, fmt.Errorf("蒙版必须是 PNG 格式：它用 alpha 通道标记需要重绘的区域")
	}
	if int64(len(data)) > openAIEditMaxMaskBytes {
		return nil, fmt.Errorf("蒙版过大：上限 %d 字节", openAIEditMaxMaskBytes)
	}

	return &orchestrator.GenReference{
		ID:       "openai-mask",
		FileName: "mask.png",
		DataUrl:  "data:image/png;base64," + base64.StdEncoding.EncodeToString(data),
	}, nil
}

// isPNG 判断数据是否以 PNG 签名开头。
func isPNG(data []byte) bool {
	return len(data) >= 8 && bytes.Equal(data[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a})
}

// editOpenAIImage 处理 POST /v1/images/edits。
func (h *ImageHandler) editOpenAIImage(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	if user == nil || user.ID == "" {
		writeOpenAIError(w, http.StatusUnauthorized, "invalid_api_key", "缺少或无效的 API 密钥。请在 Authorization 头中提供 Bearer rk-* 密钥。")
		return
	}

	form, err := parseOpenAIEditForm(w, r)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	if form.prompt == "" {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", "prompt 不能为空。")
		return
	}

	format, formatErr := h.resolveResponseFormat(r.Context(), form.responseFormat)
	if formatErr != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", formatErr.Error())
		return
	}
	if modelErr := h.validateRequestedModel(r.Context(), form.model); modelErr != nil {
		writeOpenAIError(w, http.StatusBadRequest, "model_not_found", modelErr.Error())
		return
	}

	genReq := orchestrator.GenRequest{
		Prompt:     form.prompt,
		Model:      form.model,
		Count:      normalizeOpenAICount(form.count),
		Quality:    openAIQualityToSiteQuality(form.quality),
		References: form.references,
		Mask:       form.mask,
	}
	if form.size != "" {
		aspectRatio, resolution, ok := sizeToAspectRatioResolution(form.size)
		if !ok {
			writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", fmt.Sprintf("不支持的 size：%s。请使用 宽x高 形式，例如 1024x1024。", form.size))
			return
		}
		genReq.AspectRatio = aspectRatio
		genReq.Resolution = resolution
		genReq.ExplicitSize = form.size
	}
	if strings.EqualFold(form.background, "transparent") {
		genReq.TransparentBackground = true
	}

	canonicalBody, marshalErr := json.Marshal(genReq)
	if marshalErr != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid_request_error", "无法解析请求参数。")
		return
	}

	idemKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idemKey == "" {
		resolved, resolveErr := h.resolveOpenAIIdempotencyKey(r.Context(), user.ID, genReq, format)
		if resolveErr != nil {
			// 探测失败时拒绝请求，而不是改用当前桶新建：上一桶可能已有成功记录，
			// 此刻新建会让这次重试真正再生成一张并再次扣费。宁可返回可重试的 503。
			writeOpenAIError(w, http.StatusServiceUnavailable, "idempotency_unavailable", "幂等服务暂时不可用，请稍后重试。")
			return
		}
		idemKey = resolved
	}

	// AwaitPersistence：外部客户端要的是可直接下载的图片地址，而不是内联数据。
	// 同步等待上传完成，响应里就是存储直链（约 200 字节），
	// 避免近 1MB 的 base64 图片数据穿过网关。
	resp, statusErr := h.orch.Generate(r.Context(), orchestrator.GenerateParams{
		User:             user,
		RawBody:          canonicalBody,
		IdemKey:          idemKey,
		RequestID:        strings.TrimSpace(r.Header.Get("X-Request-ID")),
		Request:          genReq,
		AwaitPersistence: true,
	})
	if statusErr != nil {
		// 同生图端点：命中幂等重放时 statusErr 携带的是成功响应体。
		replayed, ok := replayResponse(statusErr)
		if !ok {
			writeStatusError(w, statusErr)
			return
		}
		writeReplayHeaders(w, statusErr)
		resp = replayed
	}

	items, itemErr := h.openAIImageItems(r.Context(), resp, format)
	if itemErr != nil {
		writeOpenAIError(w, http.StatusBadGateway, "upstream_error", itemErr.Error())
		return
	}

	response.JSON(w, http.StatusOK, openAIImageResponse{
		Created: time.Now().Unix(),
		Data:    items,
	})
}

// listOpenAIModels 处理 GET /v1/models，列出本站对外开放的生图模型。
func (h *ImageHandler) listOpenAIModels(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	if user == nil || user.ID == "" {
		writeOpenAIError(w, http.StatusUnauthorized, "invalid_api_key", "缺少或无效的 API 密钥。")
		return
	}

	models := h.openAIImageModels(r.Context())
	list := make([]openAIModel, 0, len(models))
	for _, id := range models {
		list = append(list, openAIModel{
			ID:      id,
			Object:  "model",
			Created: 0,
			OwnedBy: "recho-ai",
		})
	}
	response.JSON(w, http.StatusOK, openAIModelList{Object: "list", Data: list})
}

// replayResponse 识别幂等重放：编排层命中重放时返回 Code<400 且 Body 是缓存的
// GenResponse JSON，而不是错误。把 Body 解析回 GenResponse 交给正常响应路径。
//
// 不识别的话，这段「成功但走错误通道」的返回值会被当成失败：调用方的重试
// （客户端超时、用户想再生成一张）拿到的是错误信封，缓存的图片被丢弃。
// 返回的第二个值为 false 表示这不是重放，调用方按普通错误处理。
func replayResponse(statusErr *orchestrator.StatusError) (*orchestrator.GenResponse, bool) {
	if statusErr == nil || statusErr.Body == nil || statusErr.Code >= 400 {
		return nil, false
	}
	var resp orchestrator.GenResponse
	if err := json.Unmarshal(statusErr.Body, &resp); err != nil {
		return nil, false
	}
	return &resp, true
}

// writeReplayHeaders 把重放携带的响应头写回。
//
// 编排层用 StatusError.Headers 传递 X-Idempotent-Replay 之类的信号。识别出重放
// 后如果不写回，调用方就无法区分「这次真的生成了」与「复用了缓存」——客户端
// 重试逻辑与用量监控都依赖这个区分。
func writeReplayHeaders(w http.ResponseWriter, statusErr *orchestrator.StatusError) {
	for key, value := range statusErr.Headers {
		w.Header().Set(key, value)
	}
}

// writeStatusError 把编排层的错误写成 OpenAI 错误信封。
//
// 重放（Code<400 且有 Body）不能走这里：那是成功的响应体，需要由调用方解析后
// 按正常结果返回。这里只负责真正的失败——Code<400 却没有 Body 属于编排层的
// 异常组合，按 400 处理以免向客户端谎报成功。
func writeStatusError(w http.ResponseWriter, statusErr *orchestrator.StatusError) {
	status := statusErr.Code
	if status < 400 {
		status = http.StatusBadRequest
	}
	writeOpenAIError(w, status, statusErr.ErrorCode, statusErr.Message)
}

// validateRequestedModel 校验请求的模型确实在对外可用列表里。
//
// 为什么需要：编排层在模型未命中时会回退到优先级最高的 Provider
// （selectImageProvider 的 candidates[0]），于是「管理员关掉的模型」或
// 「根本不存在的模型名」都会照样出图，只是悄悄换了个模型计费。对外提供
// API 时这是两重问题——调用方以为在用 A 模型，实际按 B 计费；管理员也
// 无法通过关闭模型来真正收回访问权。
//
// 这里用对外模型列表做白名单，把它挡在进入编排之前。空模型名放行：
// 那是「用默认模型」的合法语义，由编排层解析。
func (h *ImageHandler) validateRequestedModel(ctx context.Context, model string) error {
	requested := strings.TrimSpace(model)
	if requested == "" {
		return nil
	}
	available := h.openAIImageModels(ctx)
	if len(available) == 0 {
		// 一个模型都没配时给出明确指引，而不是让请求走到上游才失败。
		return fmt.Errorf("服务端尚未配置任何可用的生图模型。")
	}
	for _, id := range available {
		if id == requested {
			return nil
		}
	}
	return fmt.Errorf("模型 %s 不可用。当前可用模型：%s。", requested, strings.Join(available, ", "))
}

// resolveResponseFormat 决定本次响应的图片格式。
//
// 默认值是 b64_json 而非 url，这是刻意对齐 OpenAI 官方语义：GPT image 系列
// 模型不支持 response_format，永远返回 base64 编码的图片（官方文档与
// openai-python 的 Image.b64_json 注释都如此说明）。客户端按官方示例读
// result.data[0].b64_json 时，这里必须给同样的东西，否则拿到 null。
//
// 显式传 url 时给存储直链：这是本站特有的省流量路径（响应从约 760KB 降到
// 约 200 字节），OpenAI 那边不存在对应能力，属于对客户端的增强而非偏差。
//
// 开关语义：b64_json 开关只约束「显式请求 base64」的场景。默认路径不受它
// 影响——关掉开关是为了让管理员能强制客户端走省流量的直链，而不是让默认
// 调用直接失败。
func (h *ImageHandler) resolveResponseFormat(ctx context.Context, requested string) (string, error) {
	format := strings.ToLower(strings.TrimSpace(requested))

	if format == "" {
		// 未指定：对齐官方给 base64；若管理员关闭了该能力则退回直链，
		// 保证请求仍然成功而不是要求客户端改参数。
		if h.b64JSONEnabled(ctx) {
			return openAIImageFormatB64JSON, nil
		}
		return openAIImageFormatURL, nil
	}

	if format != openAIImageFormatURL && format != openAIImageFormatB64JSON {
		return "", fmt.Errorf("不支持的 response_format：%s。", requested)
	}
	if format == openAIImageFormatB64JSON && !h.b64JSONEnabled(ctx) {
		return "", fmt.Errorf("本服务未开启 b64_json 响应格式，请使用 response_format=url。")
	}
	return format, nil
}

// b64JSONEnabled 报告外部端点是否允许返回 base64 图片。
//
// 读取失败时按「关闭」处理：宁可让调用方收到明确的 400，也不要因为配置读取
// 异常而静默回退到一种会显著放大响应的格式。
func (h *ImageHandler) b64JSONEnabled(ctx context.Context) bool {
	if h.appSettings == nil {
		return config.OpenAIB64JSONEnabled
	}
	enabled, err := h.appSettings.OpenAIB64JSONEnabled(ctx)
	if err != nil {
		log.Printf("[openai-image] failed to read b64_json switch, treating as disabled: %v", err)
		return false
	}
	return enabled
}

// openAIImageModels 返回对外可用的生图模型 id。
//
// 读取失败时返回空列表而不是报错：/v1/models 是发现性接口，返回空列表会让
// 客户端知道当前没有可用模型，比 5xx 更利于诊断。
func (h *ImageHandler) openAIImageModels(ctx context.Context) []string {
	if h.providerSettings == nil {
		return nil
	}
	models, err := h.providerSettings.ListImageModels(ctx)
	if err != nil {
		log.Printf("[openai-image] failed to list image models: %v", err)
		return nil
	}
	return models
}

// openAIImageItems 把编排结果转换为 OpenAI 响应项。
//
// 核心约束是「绝不返回空图」：任一取图路径不可用时都要退到另一条，
// 否则客户端会收到 {"url":""} 这类拿不到图片的响应。兜底顺序：
//
//  1. 请求 url   → 优先给存储直链；地址为空则退回 base64（响应变大但不丢图）
//  2. 请求 b64_json → 读存储转 base64；读不到则退回存储直链
//
// 也就是说两条格式互为兜底，只要存储或地址有一方能拿到数据，调用方就有图。
func (h *ImageHandler) openAIImageItems(ctx context.Context, resp *orchestrator.GenResponse, format string) ([]openAIImageResponseItem, error) {
	items := make([]openAIImageResponseItem, 0, len(resp.Images))
	var fallbackErr error

	for _, image := range resp.Images {
		item := openAIImageResponseItem{RevisedPrompt: image.RevisedPrompt}
		imageURL := firstNonEmptyString(image.URL, image.PreviewURL, image.TemporaryURL, image.DataURL)

		if format == openAIImageFormatB64JSON {
			// 主路径：读存储转 base64。
			encoded, err := h.encodeImageBase64(ctx, image)
			if err != nil {
				// 兜底一：同步持久化失败时数据仍在内存的 data URI 里
				// （StoragePath 为空，encodeImageBase64 必然失败）。
				// 直接把它当 base64 返回，只读 b64_json 的客户端才拿得到图。
				if inline, ok := stripDataURLPrefix(imageURL); ok {
					item.B64JSON = inline
					items = append(items, item)
					continue
				}
				// 兜底二：连内联数据都没有时才退回链接，避免整条请求失败。
				fallbackErr = err
				item.URL = imageURL
				items = append(items, item)
				continue
			}
			item.B64JSON = encoded
			items = append(items, item)
			continue
		}

		// format=url 主路径：优先给可直接访问的链接。
		if imageURL != "" && !strings.HasPrefix(imageURL, "data:") {
			item.URL = imageURL
			items = append(items, item)
			continue
		}

		// 走到这里说明没有可用的链接地址（存储未落库、上游只给了 base64 等）。
		// 先尝试读存储转 base64；再不行就用已有的 data URI 本体作为 base64。
		if encoded, err := h.encodeImageBase64(ctx, image); err == nil {
			item.B64JSON = encoded
			items = append(items, item)
			continue
		} else {
			fallbackErr = err
		}
		if encoded, ok := stripDataURLPrefix(imageURL); ok {
			item.B64JSON = encoded
			items = append(items, item)
			continue
		}
		if imageURL != "" {
			// 最后手段：原样给出地址（即便它是 data URI），保证 item 不为空。
			item.URL = imageURL
		}
		items = append(items, item)
	}

	// 全部图片都只能走兜底、且一张都没能产出内容时，才算真正的失败。
	if fallbackErr != nil && !anyItemHasImage(items) {
		return nil, fmt.Errorf("读取图片失败：%w", fallbackErr)
	}
	return items, nil
}

// anyItemHasImage 报告响应项里是否至少有一张图可交付。
func anyItemHasImage(items []openAIImageResponseItem) bool {
	for _, item := range items {
		if item.URL != "" || item.B64JSON != "" {
			return true
		}
	}
	return false
}

// encodeImageBase64 按存储路径读回图片并编码为 base64。
//
// 只走存储读取：DataURL 已内联在结果里，不需要再经存储。
func (h *ImageHandler) encodeImageBase64(ctx context.Context, image orchestrator.ImageResult) (string, error) {
	path := firstNonEmptyString(image.StoragePath, image.PreviewPath)
	if path == "" {
		return "", fmt.Errorf("图片缺少存储路径：%s", image.ID)
	}
	if h.storageService == nil {
		return "", fmt.Errorf("图片存储服务不可用：%s", image.ID)
	}
	downloaded, err := h.storageService.DownloadImage(ctx, path)
	if err != nil {
		return "", fmt.Errorf("读取图片失败：%w", err)
	}
	if len(downloaded.Data) == 0 {
		return "", fmt.Errorf("图片内容为空：%s", image.ID)
	}
	return base64.StdEncoding.EncodeToString(downloaded.Data), nil
}

// stripDataURLPrefix 从 data URI 中取出纯 base64 部分。
//
// 用于 format=url 但没有可用链接、手里只有内联 data URI 的场景：
// 此时把本体填进 b64_json，客户端至少能拿到图片数据。
func stripDataURLPrefix(value string) (string, bool) {
	if !strings.HasPrefix(value, "data:") {
		return "", false
	}
	comma := strings.Index(value, ",")
	if comma < 0 || comma == len(value)-1 {
		return "", false
	}
	meta := value[:comma]
	if !strings.Contains(meta, ";base64") {
		return "", false
	}
	return value[comma+1:], true
}

// deriveOpenAIIdempotencyKey 为未提供 Idempotency-Key 的外部请求派生确定性幂等键。
//
// 为什么需要：编排层要求已登录用户携带幂等键（防止重复扣费），而 OpenAI 客户端
// 不会发送这个非标准头。若直接拒绝，所有外部调用都无法工作。
//
// 为什么是确定性的：超时重试是 OpenAI 客户端的常规行为。用「用户 + 完整请求参数」
// 作为指纹，同一用户以相同参数重试会命中幂等重放而非再次扣费；参数不同则视为
// 新请求。这与站内「显式幂等键」的语义一致，只是键由服务端推导。
func deriveOpenAIIdempotencyKey(userID string, req orchestrator.GenRequest, format string, now time.Time) string {
	fields := []string{
		openAIIdempotencyKeyVersion,
		userID,
		req.Prompt,
		req.Model,
		req.AspectRatio,
		req.Resolution,
		req.ExplicitSize,
		req.Quality,
		strconv.Itoa(req.Count),
		format,
		strconv.FormatBool(req.TransparentBackground),
	}
	// 参考图指纹只在确实有参考图时才参与。
	//
	// 无条件追加（哪怕为空字符串）会改变无参考图请求的指纹，使改动上线后算出的键
	// 与滚动部署期间旧版本写入的记录对不上：旧记录尚未过期，重试却找不到它，
	// 于是重新生成并再次扣费。保持无参考图时的字段序列不变，跨版本重试仍能命中。
	if refs := referenceFingerprint(req.References); refs != "" {
		fields = append(fields, refs)
	}
	fields = append(fields, strconv.FormatInt(idempotencyWindowStart(now), 10))

	sum := sha256.Sum256([]byte(strings.Join(fields, "\x00")))
	return "openai-" + hex.EncodeToString(sum[:16])
}

// openAIRetryReuseWindow 是「跨时间桶重试」可以复用旧记录的时限。
//
// 派生键按时间分桶，跨过边界的重试会算出不同的键。若只看当前桶，12:04:59 发出、
// 12:05:01 重发的请求会重新生成并再次扣费。但不能无条件复用上一桶：幂等记录存活
// 24 小时，上一桶往往还留着很久以前的记录，那样「再生成一张」永远拿不到新图。
//
// 两者的请求字节完全相同，服务端唯一能依据的区分信号就是时间间隔——重试发生在
// 数十秒内，而用户主动重新生成通常在几分钟之后。90 秒既覆盖常见的超时重试与退避
// 重试，又短到不会把「再生成一张」误判成重试。
const openAIRetryReuseWindow = 90 * time.Second

// openAIImageIdempotencyScope 是外部生图端点使用的幂等作用域。
const openAIImageIdempotencyScope = "image_generate"

// resolveOpenAIIdempotencyKey 选出本次请求应使用的幂等键。
//
// 判定顺序（只读探测，不产生占用）：
//  1. 当前桶已有记录 → 用当前桶。同一窗口内的重试都走这里。
//  2. 当前桶没有、上一桶有且那条记录足够新 → 用上一桶。这是跨边界的那两秒重试。
//  3. 其余情况 → 用当前桶，即全新请求。
//
// 第 2 步的时限不能省：没有它，任何新请求只要撞上「上一桶还留着历史记录」就会
// 复用旧键并返回旧图。第 1 步也不能让位给第 2 步——当前桶的记录总是更近的一次。
//
// 探测失败时返回错误，由调用方决定如何处理：把失败当成「没有旧记录」会在查询
// 瞬时抖动的窗口里让重试重复扣费。
func (h *ImageHandler) resolveOpenAIIdempotencyKey(ctx context.Context, userID string, req orchestrator.GenRequest, format string) (string, error) {
	now := h.now()
	currentKey := deriveOpenAIIdempotencyKey(userID, req, format, now)

	if h.idempotencySvc == nil {
		return currentKey, nil
	}

	current, err := h.idempotencySvc.Lookup(ctx, userID, currentKey, openAIImageIdempotencyScope)
	if err != nil {
		return "", fmt.Errorf("查询幂等记录失败：%w", err)
	}
	if current != nil {
		return currentKey, nil
	}

	previousKey := deriveOpenAIIdempotencyKeyForWindow(userID, req, format, idempotencyWindowStart(now)-int64(openAIIdempotencyWindow/time.Second))
	if previousKey == currentKey {
		return currentKey, nil
	}

	previous, err := h.idempotencySvc.Lookup(ctx, userID, previousKey, openAIImageIdempotencyScope)
	if err != nil {
		return "", fmt.Errorf("查询幂等记录失败：%w", err)
	}
	if previous != nil && now.Sub(previous.CreatedAt) <= openAIRetryReuseWindow {
		return previousKey, nil
	}
	return currentKey, nil
}

// deriveOpenAIIdempotencyKeyForWindow 按指定的窗口起点派生键。
//
// 与 deriveOpenAIIdempotencyKey 共用同一套字段序列，只是窗口起点由调用方给出，
// 这样才能为「上一个桶」算出候选键。
func deriveOpenAIIdempotencyKeyForWindow(userID string, req orchestrator.GenRequest, format string, windowStart int64) string {
	fields := []string{
		openAIIdempotencyKeyVersion,
		userID,
		req.Prompt,
		req.Model,
		req.AspectRatio,
		req.Resolution,
		req.ExplicitSize,
		req.Quality,
		strconv.Itoa(req.Count),
		format,
		strconv.FormatBool(req.TransparentBackground),
	}
	// 参考图指纹只在确实有参考图时才参与：无条件追加空字符串会改变无参考图请求
	// 的指纹，使滚动部署期间新旧版本算出的键对不上。
	if refs := referenceFingerprint(req.References); refs != "" {
		fields = append(fields, refs)
	}
	fields = append(fields, strconv.FormatInt(windowStart, 10))
	return openAIIdempotencyHash(fields)
}

// openAIIdempotencyHash 把字段序列折叠成最终的键，避免各处重复哈希逻辑。
func openAIIdempotencyHash(fields []string) string {
	sum := sha256.Sum256([]byte(strings.Join(fields, "\x00")))
	return "openai-" + hex.EncodeToString(sum[:16])
}

// openAIIdempotencyKeyVersion 让派生算法可以演进而不会误命中旧记录。
const openAIIdempotencyKeyVersion = "openai-image-v1"

// openAIIdempotencyWindow 是派生键的时间桶宽度。
//
// 取 5 分钟：足够覆盖一次生成（实测约 30s）加上客户端重试退避，又不会长到
// 让「再生成一张」显得失效。
const openAIIdempotencyWindow = 5 * time.Minute

// idempotencyWindowStart 返回 now 所属时间桶的起点（Unix 秒）。
//
// 用桶起点而不是「当前秒」：同一窗口内的所有请求必须落到同一个键，否则重试
// 会因为时间差落到别的桶上，重放保护就失效了。
func idempotencyWindowStart(now time.Time) int64 {
	window := int64(openAIIdempotencyWindow / time.Second)
	return now.Unix() / window * window
}

// referenceFingerprint 把参考图归纳成一个稳定的短哈希。
//
// 参考图必须进入幂等指纹，否则「同一提示词 + 换一张参考图」会被判定为同一请求，
// 第二次编辑直接命中重放、返回上一张结果。参考图内容是 data URI 或存储路径，
// 可能有数十 MB，因此只把逐项哈希拼进指纹，不把原文带进去。
func referenceFingerprint(references []orchestrator.GenReference) string {
	if len(references) == 0 {
		return ""
	}
	parts := make([]string, 0, len(references)*4)
	for _, ref := range references {
		// 逐张取内容标识：优先实际图像数据，其次是存储位置。
		// 文件名与标题也带上——同名不同图的情况这两者能区分开。
		sum := sha256.Sum256([]byte(strings.Join([]string{
			ref.DataUrl,
			ref.Content,
			ref.StoragePath,
			ref.PreviewURL,
			ref.PreviewPath,
			ref.ThumbnailURL,
			ref.ThumbnailPath,
		}, "\x00")))
		parts = append(parts, hex.EncodeToString(sum[:8]), ref.FileName, ref.Title, ref.ID)
	}
	return strings.Join(parts, "\x01")
}

// firstNonEmptyString 返回第一个非空字符串。
func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// RegisterOpenAIRoutes 注册 OpenAI 兼容路由。
//
// 挂在独立的 /v1 前缀下，与站内 /api 路由互不影响：站内前端继续用
// /api/image/generate，外部客户端用 /v1/images/generations。
func (h *ImageHandler) RegisterOpenAIRoutes(r chi.Router) {
	r.Post("/images/generations", h.generateOpenAIImage)
	// 图像编辑：与生图并列的第二套协议，接收 multipart 输入图 + 提示词。
	r.Post("/images/edits", h.editOpenAIImage)
	r.Get("/models", h.listOpenAIModels)
}
