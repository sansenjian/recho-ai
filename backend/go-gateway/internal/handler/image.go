package handler

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/config"
	"go-gateway/internal/middleware"
	"go-gateway/internal/pkg/response"
	"go-gateway/internal/repository"
	"go-gateway/internal/service"
)

type imageCreditService interface {
	ReserveCredits(ctx context.Context, userID string, imageCount int) (transactionID string, newBalance float64, creditCostPerImage float64, totalCost float64, err error)
	RefundCredits(ctx context.Context, userID string, transactionID string, refundAmount float64, reason string) (float64, error)
	GetCreditCost(imageCount int) (costPerImage, totalCost float64)
}

type imageStorageService interface {
	StoreFromURL(ctx context.Context, url, pathHint string) (*service.StoredImage, error)
	StoreFromBuffer(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error)
	StoreFromBufferAtPath(ctx context.Context, data []byte, mime, storagePath string) (*service.StoredImage, error)
	DownloadImage(ctx context.Context, storagePath string) (*service.DownloadedImage, error)
	SaveImageHistory(ctx context.Context, item *service.ImageHistoryItem, userID string) error
	ListImageHistory(ctx context.Context, userID, scope string, limit, offset int) (*service.ImageHistory, error)
	GetImageHistory(ctx context.Context, id, userID, scope string) (*service.ImageHistoryItem, error)
	DeleteImageHistory(ctx context.Context, id, userID string) (bool, error)
	ClearImageHistory(ctx context.Context, userID string) (int64, error)
}

type imageIdempotencyService interface {
	Acquire(ctx context.Context, userID, idemKey, scope string, body []byte) (*service.IdempotencyOutcome, error)
	Fail(ctx context.Context, userID, idemKey, scope string)
	Complete(ctx context.Context, userID, idemKey, scope string, responseCode int16, responseBody any, transactionID string)
}

// ImageHandler handles image-related endpoints
type ImageHandler struct {
	creditService  imageCreditService
	storageService imageStorageService
	idempotencySvc imageIdempotencyService // optional, nil disables idempotency
	httpClient     *http.Client           // reused HTTP client for upstream image API calls
}

// NewImageHandler creates a new image handler.
// idempotencySvc may be nil to disable idempotency checks.
func NewImageHandler(
	creditService imageCreditService,
	storageService imageStorageService,
	idempotencySvc imageIdempotencyService,
) *ImageHandler {
	return &ImageHandler{
		creditService:  creditService,
		storageService: storageService,
		idempotencySvc: idempotencySvc,
		httpClient:     &http.Client{Timeout: 360 * time.Second},
	}
}

// ImageGenRequest represents the image generation request
type ImageGenRequest struct {
	Prompt        string              `json:"prompt"`
	DisplayPrompt string              `json:"displayPrompt,omitempty"`
	UserPrompt    string              `json:"userPrompt,omitempty"`
	SystemPrompt  string              `json:"systemPrompt,omitempty"`
	ModelPrompt   string              `json:"modelPrompt,omitempty"`
	Size          string              `json:"size,omitempty"`
	AspectRatio   string              `json:"aspectRatio,omitempty"`
	Resolution    string              `json:"resolution,omitempty"`
	Quality       string              `json:"quality,omitempty"`
	Count         int                 `json:"count,omitempty"`
	References    []ImageGenReference `json:"references,omitempty"`
}

// ImageGenReference represents a reference image
type ImageGenReference struct {
	ID            string `json:"id,omitempty"`
	Title         string `json:"title,omitempty"`
	DataUrl       string `json:"dataUrl,omitempty"`
	StoragePath   string `json:"storagePath,omitempty"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	PreviewPath   string `json:"previewPath,omitempty"`
	ThumbnailURL  string `json:"thumbnailUrl,omitempty"`
	ThumbnailPath string `json:"thumbnailPath,omitempty"`
	Content       string `json:"content,omitempty"`
	FileName      string `json:"fileName,omitempty"`
}

// ImageGenResponse represents the image generation response
type ImageGenResponse struct {
	Images        []ImageResult `json:"images"`
	CreditCost    float64       `json:"creditCost,omitempty"`
	TotalCost     float64       `json:"totalCost,omitempty"`
	CreditBalance *struct {
		Balance float64 `json:"balance"`
	} `json:"creditBalance,omitempty"`
}

// ImageResult represents a generated image result
type ImageResult struct {
	ID                string                          `json:"id"`
	UserID            string                          `json:"userId,omitempty"`
	GenerationBatchID string                          `json:"generationBatchId,omitempty"`
	StoragePath       string                          `json:"storagePath,omitempty"`
	URL               string                          `json:"url,omitempty"`
	DataURL           string                          `json:"dataUrl,omitempty"`
	PreviewURL        string                          `json:"previewUrl,omitempty"`
	PreviewPath       string                          `json:"previewPath,omitempty"`
	ThumbnailURL      string                          `json:"thumbnailUrl,omitempty"`
	ThumbnailPath     string                          `json:"thumbnailPath,omitempty"`
	Prompt            string                          `json:"prompt"`
	UserPrompt        string                          `json:"userPrompt,omitempty"`
	SystemPrompt      string                          `json:"systemPrompt,omitempty"`
	ModelPrompt       string                          `json:"modelPrompt,omitempty"`
	References        []service.ImageHistoryReference `json:"references,omitempty"`
	ReferenceCount    int                             `json:"referenceImageCount,omitempty"`
	Bytes             int                             `json:"bytes,omitempty"`
	Visibility        string                          `json:"visibility,omitempty"`
	FundingSource     string                          `json:"fundingSource,omitempty"`
	CreditCost        float64                         `json:"creditCost,omitempty"`
	RevisedPrompt     string                          `json:"revisedPrompt,omitempty"`
	Size              string                          `json:"size"`
	AspectRatio       string                          `json:"aspectRatio,omitempty"`
	Resolution        string                          `json:"resolution,omitempty"`
	Quality           string                          `json:"quality,omitempty"`
	Timestamp         string                          `json:"timestamp"`
	Width             int                             `json:"width,omitempty"`
	Height            int                             `json:"height,omitempty"`
}

type referenceUploadResponse struct {
	Reference ImageGenReference `json:"reference"`
}

const referenceUploadMaxBytes = 12 * 1024 * 1024
const imageGenerateMaxBytes = 2 * 1024 * 1024

// Generate handles POST /api/image/generate
func (h *ImageHandler) Generate(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)

	// Read raw body for idempotency fingerprint, then restore for JSON decoding
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

	// Validate prompt
	if req.Prompt == "" {
		response.Error(w, http.StatusBadRequest, "请输入图片描述。")
		return
	}
	if h.storageService == nil {
		log.Printf("[image] 503: storageService is nil (DB not configured or connection failed)")
		response.Error(w, http.StatusServiceUnavailable, "图片存储服务暂时不可用。")
		return
	}

	// --- Idempotency check ---
	idemKey := r.Header.Get("Idempotency-Key")
	if idemKey != "" && user != nil && user.ID != "" && h.idempotencySvc != nil {
		outcome, err := h.idempotencySvc.Acquire(r.Context(), user.ID, idemKey, "image_generate", rawBody)
		if err != nil {
			// Returning 503 prevents proceeding without idempotency protection,
			// which could lead to double-charging on retries.
			log.Printf("[idempotency] acquire error: %v", err)
			response.Error(w, http.StatusServiceUnavailable, "服务暂时不可用，请稍后重试")
			return
		} else if outcome != nil {
			if outcome.Conflict {
				response.Error(w, http.StatusConflict, "请求正在处理中或使用相同的幂等键发送了不同的请求。")
				return
			}
			if !outcome.Proceed && outcome.ReplayBody != nil {
				// Replay cached response — no credit deduction, no API call
				w.Header().Set("X-Idempotent-Replay", "true")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(int(outcome.ReplayCode))
				w.Write(outcome.ReplayBody)
				return
			}
		}
	}

	// Normalize parameters
	count := normalizeImageCount(req.Count)
	aspectRatio := normalizeAspectRatio(req.AspectRatio)
	resolution := normalizeResolution(req.Resolution)
	quality := normalizeQuality(req.Quality)
	size := determineSize(resolution, aspectRatio)
	displayPrompt := firstNonEmpty(strings.TrimSpace(req.UserPrompt), strings.TrimSpace(req.DisplayPrompt), strings.TrimSpace(req.Prompt))
	modelPrompt := firstNonEmpty(strings.TrimSpace(req.ModelPrompt), strings.TrimSpace(req.Prompt))

	// Calculate credit cost
	costPerImage := config.ImageCreditCostPerImage
	totalCost := roundToTwoDecimals(float64(count) * costPerImage)
	if h.creditService != nil {
		costPerImage, totalCost = h.creditService.GetCreditCost(count)
	}

	// Check and reserve credits if user is authenticated
	var creditReservation *service.CreditReservation
	if user != nil && user.ID != "" && h.creditService != nil {
		txID, newBalance, _, cost, err := h.creditService.ReserveCredits(r.Context(), user.ID, count)
		if err != nil {
			if errors.Is(err, repository.ErrInsufficientCredits) {
				// Mark idempotency as failed so the client can retry after topping up
				if idemKey != "" && h.idempotencySvc != nil {
					h.idempotencySvc.Fail(r.Context(), user.ID, idemKey, "image_generate")
				}
				response.Error(w, http.StatusPaymentRequired, "额度不足。")
				return
			}
			log.Printf("[image] 503: failed to reserve credits: %v", err)
			response.Error(w, http.StatusServiceUnavailable, "额度服务暂时不可用，请稍后重试。")
			return
		} else {
			creditReservation = &service.CreditReservation{
				TransactionID: txID,
				Amount:        cost,
				Balance:       newBalance,
			}
			totalCost = cost
		}
	}

	// Call image generation API
	ctx := r.Context()
	images, err := h.callImageAPI(ctx, req, count, aspectRatio, resolution, quality)
	if err != nil {
		// Full refund on complete failure
		if creditReservation != nil {
			_, refundErr := h.creditService.RefundCredits(r.Context(), user.ID, creditReservation.TransactionID, creditReservation.Amount, "image_generation_failed")
			if refundErr != nil {
				log.Printf("[image] failed to refund credits after generation failure: %v", refundErr)
			}
		}
		// Mark idempotency as failed so the client can retry
		if idemKey != "" && user != nil && h.idempotencySvc != nil {
			h.idempotencySvc.Fail(r.Context(), user.ID, idemKey, "image_generate")
		}
		response.Error(w, http.StatusInternalServerError, "图片生成失败，请稍后重试。")
		return
	}

	// Partial refund: if fewer images returned than requested, refund the difference
	if creditReservation != nil && len(images) < count && count > 0 {
		missingCount := count - len(images)
		refundAmount := roundToTwoDecimals(float64(missingCount) * costPerImage)
		if refundAmount > 0 {
			newBalance, refundErr := h.creditService.RefundCredits(r.Context(), user.ID, creditReservation.TransactionID, refundAmount, "partial_generation")
			if refundErr != nil {
				log.Printf("[image] failed to refund credits for partial generation (%d/%d): %v", len(images), count, refundErr)
			} else {
				totalCost = roundToTwoDecimals(totalCost - refundAmount)
				creditReservation.Balance = newBalance
			}
		}
	}

	references := historyReferences(req.References)
	visibility := "public"
	fundingSource := "free"
	creditCost := 0.0
	var userID string
	var creditTransactionID string
	if user != nil {
		userID = user.ID
	}
	if creditReservation != nil {
		visibility = "private"
		fundingSource = "credit"
		creditCost = costPerImage
		creditTransactionID = creditReservation.TransactionID
	}

	batchID := "batch_" + randomID()
	responseImages := make([]ImageResult, 0, len(images))
	for _, image := range images {
		image.UserID = userID
		image.GenerationBatchID = batchID
		image.Prompt = displayPrompt
		image.UserPrompt = displayPrompt
		image.SystemPrompt = req.SystemPrompt
		image.ModelPrompt = modelPrompt
		image.References = references
		image.ReferenceCount = len(references)
		image.Visibility = visibility
		image.FundingSource = fundingSource
		image.CreditCost = creditCost
		image.Size = size
		image.AspectRatio = aspectRatio
		image.Resolution = resolution
		image.Quality = quality
		image.Timestamp = time.Now().UTC().Format(time.RFC3339)
		if image.PreviewURL == "" {
			image.PreviewURL = image.URL
		}
		if h.storageService != nil {
			generatedAt := time.Now().UTC()
			if parsed, err := time.Parse(time.RFC3339, image.Timestamp); err == nil {
				generatedAt = parsed
			}
			historyItem := service.ImageHistoryItem{
				ID:                  image.ID,
				UserID:              userID,
				GenerationBatchID:   batchID,
				Prompt:              displayPrompt,
				UserPrompt:          displayPrompt,
				SystemPrompt:        req.SystemPrompt,
				ModelPrompt:         modelPrompt,
				StoragePath:         image.StoragePath,
				URL:                 image.URL,
				PreviewURL:          image.PreviewURL,
				PreviewPath:         image.PreviewPath,
				ThumbnailURL:        image.ThumbnailURL,
				ThumbnailPath:       image.ThumbnailPath,
				Size:                size,
				AspectRatio:         aspectRatio,
				Resolution:          resolution,
				Quality:             quality,
				ImageModel:          config.ImageResponsesImageModel,
				RevisedPrompt:       image.RevisedPrompt,
				Width:               image.Width,
				Height:              image.Height,
				Timestamp:           generatedAt,
				References:          references,
				ReferenceCount:      len(references),
				Visibility:          visibility,
				FundingSource:       fundingSource,
				CreditCost:          creditCost,
				CreditTransactionID: creditTransactionID,
			}
			if err := h.storageService.SaveImageHistory(r.Context(), &historyItem, userID); err != nil {
			log.Printf("[image] 503: SaveImageHistory failed: %v", err)
			if creditReservation != nil {
					_, refundErr := h.creditService.RefundCredits(r.Context(), userID, creditReservation.TransactionID, creditReservation.Amount, "history_save_failed")
					if refundErr != nil {
						log.Printf("[image] failed to refund credits after history save failure: %v", refundErr)
					}
					if idemKey != "" && user != nil && h.idempotencySvc != nil {
						h.idempotencySvc.Fail(r.Context(), user.ID, idemKey, "image_generate")
					}
					response.Error(w, http.StatusServiceUnavailable, "私有图片保存失败，已退回额度，请稍后重试。")
					return
				}
				log.Printf("[image-history] save skipped: %v", err)
			}
		}
		responseImages = append(responseImages, image)
	}
	// Build response
	resp := ImageGenResponse{
		Images:     responseImages,
		CreditCost: costPerImage,
		TotalCost:  totalCost,
	}
	if creditReservation != nil {
		resp.CreditBalance = &struct {
			Balance float64 `json:"balance"`
		}{Balance: creditReservation.Balance}
	}

	// Cache response for future idempotent replays
	if idemKey != "" && user != nil && h.idempotencySvc != nil {
		txID := ""
		if creditReservation != nil {
			txID = creditReservation.TransactionID
		}
		h.idempotencySvc.Complete(r.Context(), user.ID, idemKey, "image_generate", 200, resp, txID)
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

// callImageAPI calls the image generation API
func (h *ImageHandler) callImageAPI(ctx context.Context, req ImageGenRequest, count int, aspectRatio, resolution, quality string) ([]ImageResult, error) {
	// Build API request
	size := determineSize(resolution, aspectRatio)

	// Image format MIME type. The API currently returns PNG for b64_json
	// responses. If a format/response_format field is added to the request
	// in the future, derive the MIME type from that field here.
	imageMime := "image/png"

	apiReq := map[string]any{
		"model":   config.ImageResponsesImageModel,
		"prompt":  req.Prompt,
		"n":       count,
		"size":    size,
		"quality": mapQualityToAPI(quality),
	}

	// Shared HTTP client with retry logic
	client := h.httpClient
	if client == nil {
		client = &http.Client{Timeout: 360 * time.Second}
	}
	maxRetries := 3
	urlPath := "/images/generations"
	var bodyFactory func() (io.Reader, string, error)
	if len(req.References) > 0 {
		urlPath = "/images/edits"
		bodyFactory = func() (io.Reader, string, error) {
			return h.imageEditBody(ctx, apiReq, req.References)
		}
	} else {
		reqBody, err := json.Marshal(apiReq)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request: %w", err)
		}
		bodyFactory = func() (io.Reader, string, error) {
			return bytes.NewReader(reqBody), "application/json", nil
		}
	}

	var resp *http.Response
	var body []byte

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff: 1s, 2s, 4s
			backoff := time.Duration(1<<uint(attempt-1)) * time.Second
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("context cancelled during retry backoff: %w", ctx.Err())
			case <-time.After(backoff):
			}
			log.Printf("[image] retrying API call (attempt %d/%d)", attempt+1, maxRetries+1)
		}

		bodyReader, contentType, err := bodyFactory()
		if err != nil {
			return nil, err
		}
		httpReq, err := http.NewRequestWithContext(ctx, "POST", config.ImageGenBaseURL+urlPath, bodyReader)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		httpReq.Header.Set("Content-Type", contentType)
		httpReq.Header.Set("Authorization", "Bearer "+config.ImageGenAPIKey)

		resp, err = client.Do(httpReq)
		if err != nil {
			if attempt < maxRetries {
				log.Printf("[image] API call error (will retry): %v", err)
				continue
			}
			return nil, fmt.Errorf("failed to call image API: %w", err)
		}

		body, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read response: %w", err)
		}

		// Retry on transient failures
		if isTransientStatus(resp.StatusCode) && attempt < maxRetries {
			log.Printf("[image] API returned %d (will retry)", resp.StatusCode)
			continue
		}

		break
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	// Parse response
	var apiResp struct {
		Data []struct {
			URL           string `json:"url,omitempty"`
			Base64        string `json:"b64_json,omitempty"`
			RevisedPrompt string `json:"revised_prompt,omitempty"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	// Process results
	results := make([]ImageResult, 0, len(apiResp.Data))
	storageFailures := 0
	for i, item := range apiResp.Data {
		result := ImageResult{
			ID:            fmt.Sprintf("img_%d_%d_%s", time.Now().UnixNano(), i, randomID()),
			RevisedPrompt: item.RevisedPrompt,
		}
		storedOK := false

		// Store image and get URLs
		if item.URL != "" {
			// Download and store image
			stored, err := h.storageService.StoreFromURL(ctx, item.URL, fmt.Sprintf("generated/%s", result.ID))
			if err == nil && stored != nil {
				result.URL = stored.PublicURL
				result.PreviewURL = stored.PreviewURL
				result.ThumbnailURL = stored.ThumbnailURL
				result.StoragePath = stored.StoragePath
				result.PreviewPath = stored.PreviewPath
				result.ThumbnailPath = stored.ThumbnailPath
				result.Width = stored.Width
				result.Height = stored.Height
				result.Bytes = stored.Bytes
				storedOK = true
			} else {
				// Keep the fallback to the original URL, but surface the storage failure.
				if err != nil {
					log.Printf("[image] storage failed for %s: %v", item.URL, err)
				} else {
					log.Printf("[image] storage returned nil for %s", item.URL)
				}
				result.URL = item.URL // Fallback to original URL
				result.PreviewURL = item.URL
			}
		} else if item.Base64 != "" {
			// Decode base64 and store
			decoded, err := base64.StdEncoding.DecodeString(item.Base64)
			if err == nil {
				stored, err := h.storageService.StoreFromBuffer(ctx, decoded, imageMime, fmt.Sprintf("generated/%s", result.ID))
				if err == nil && stored != nil {
					result.URL = stored.PublicURL
					result.PreviewURL = stored.PreviewURL
					result.ThumbnailURL = stored.ThumbnailURL
					result.StoragePath = stored.StoragePath
					result.PreviewPath = stored.PreviewPath
					result.ThumbnailPath = stored.ThumbnailPath
					result.Width = stored.Width
					result.Height = stored.Height
					result.Bytes = stored.Bytes
					storedOK = true
				} else {
					if err != nil {
						log.Printf("[image] storage failed for base64 image %s: %v", result.ID, err)
					} else {
						log.Printf("[image] storage returned nil for base64 image %s", result.ID)
					}
					// Fallback: return as data URL so the frontend can still display the image
					result.DataURL = "data:" + imageMime + ";base64," + item.Base64
					result.URL = result.DataURL
					result.PreviewURL = result.DataURL
				}
			} else {
				log.Printf("[image] base64 decode failed for %s: %v", result.ID, err)
			}
		}

		if !storedOK {
			storageFailures++
		}
		results = append(results, result)
	}

	if len(results) > 0 && storageFailures == len(results) {
		log.Printf("[image] warning: all %d image(s) failed storage, falling back to source URLs", storageFailures)
	}

	// Truncate to requested count if provider returned more.
	// Guard count > 0 to prevent slice panic on malformed requests.
	if count > 0 && len(results) > count {
		log.Printf("[image] provider returned %d image(s); keeping %d", len(results), count)
		results = results[:count]
	}

	return results, nil
}

func (h *ImageHandler) imageEditBody(ctx context.Context, fields map[string]any, references []ImageGenReference) (io.Reader, string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	for key, value := range fields {
		if err := writer.WriteField(key, fmt.Sprint(value)); err != nil {
			return nil, "", err
		}
	}

	for index, reference := range references {
		data, mime, err := h.referenceImageBytes(ctx, reference)
		if err != nil {
			return nil, "", err
		}
		fileName := reference.FileName
		if fileName == "" {
			fileName = fmt.Sprintf("reference_%d.%s", index+1, extensionForMime(mime))
		}
		part, err := writer.CreateFormFile("image[]", fileName)
		if err != nil {
			return nil, "", err
		}
		if _, err := part.Write(data); err != nil {
			return nil, "", err
		}
	}

	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return bytes.NewReader(body.Bytes()), writer.FormDataContentType(), nil
}

func (h *ImageHandler) referenceImageBytes(ctx context.Context, reference ImageGenReference) ([]byte, string, error) {
	if reference.StoragePath != "" {
		if h.storageService == nil {
			return nil, "", fmt.Errorf("storage service unavailable")
		}
		image, err := h.storageService.DownloadImage(ctx, reference.StoragePath)
		if err != nil {
			return nil, "", err
		}
		if image == nil || len(image.Data) == 0 {
			return nil, "", fmt.Errorf("reference image not found")
		}
		return image.Data, firstNonEmpty(image.Mime, mimeFromPath(reference.StoragePath)), nil
	}
	if reference.DataUrl != "" {
		data, mime, err := dataURLBytes(reference.DataUrl)
		if err != nil {
			return nil, "", err
		}
		return data, mime, nil
	}
	return nil, "", fmt.Errorf("reference image is missing image data")
}

// ImageHistoryListResponse represents the image history list response
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

// Helper functions

func normalizeImageCount(count int) int {
	switch count {
	case 2, 4, 8:
		return count
	default:
		return 1
	}
}

func normalizeAspectRatio(ratio string) string {
	switch ratio {
	case "1:1", "3:2", "2:3", "16:9", "9:16":
		return ratio
	default:
		return "1:1"
	}
}

func normalizeResolution(res string) string {
	switch res {
	case "1k", "2k", "4k":
		return res
	default:
		return "1k"
	}
}

func normalizeQuality(q string) string {
	switch q {
	case "low", "medium", "high":
		return q
	default:
		return "medium"
	}
}

func mapQualityToAPI(q string) string {
	switch q {
	case "low":
		return "standard"
	case "high":
		return "hd"
	default:
		return "standard"
	}
}

func determineSize(resolution, aspectRatio string) string {
	sizes := map[string]map[string]string{
		"1k": {
			"auto": "1024x1024",
			"1:1":  "1024x1024",
			"3:2":  "1536x1024",
			"2:3":  "1024x1536",
			"16:9": "1536x864",
			"9:16": "864x1536",
		},
		"2k": {
			"auto": "2048x2048",
			"1:1":  "2048x2048",
			"3:2":  "2160x1440",
			"2:3":  "1440x2160",
			"16:9": "2048x1152",
			"9:16": "1152x2048",
		},
		"4k": {
			"auto": "3840x2160",
			"1:1":  "2880x2880",
			"3:2":  "3520x2336",
			"2:3":  "2336x3520",
			"16:9": "3840x2160",
			"9:16": "2160x3840",
		},
	}

	if sizes, ok := sizes[resolution]; ok {
		if size, ok := sizes[aspectRatio]; ok {
			return size
		}
	}
	return "1024x1024"
}

func roundToTwoDecimals(val float64) float64 {
	return math.Round(val*100) / 100
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

func historyReferences(references []ImageGenReference) []service.ImageHistoryReference {
	result := make([]service.ImageHistoryReference, 0, len(references))
	for index, reference := range references {
		if reference.DataUrl == "" && reference.StoragePath == "" && reference.PreviewURL == "" && reference.ThumbnailURL == "" {
			continue
		}
		id := reference.ID
		if id == "" {
			id = fmt.Sprintf("reference_%d", index+1)
		}
		title := reference.Title
		if title == "" {
			title = fmt.Sprintf("参考图%d", index+1)
		}
		result = append(result, service.ImageHistoryReference{
			ID:            id,
			Title:         title,
			StoragePath:   reference.StoragePath,
			PreviewURL:    reference.PreviewURL,
			PreviewPath:   reference.PreviewPath,
			ThumbnailURL:  reference.ThumbnailURL,
			ThumbnailPath: reference.ThumbnailPath,
			Content:       reference.Content,
			FileName:      reference.FileName,
		})
	}
	return result
}

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

func dataURLBytes(value string) ([]byte, string, error) {
	if !strings.HasPrefix(value, "data:") {
		return nil, "", fmt.Errorf("invalid data url")
	}
	parts := strings.SplitN(value, ",", 2)
	if len(parts) != 2 {
		return nil, "", fmt.Errorf("invalid data url")
	}
	meta := strings.TrimPrefix(parts[0], "data:")
	mime := "image/png"
	if meta != "" {
		mime = strings.Split(meta, ";")[0]
	}
	if !isAllowedReferenceMime(mime) {
		return nil, "", fmt.Errorf("unsupported reference image MIME type: %s", mime)
	}
	if strings.Contains(meta, ";base64") {
		data, err := base64.StdEncoding.DecodeString(parts[1])
		return data, mime, err
	}
	decoded, err := url.QueryUnescape(parts[1])
	if err != nil {
		return nil, "", err
	}
	return []byte(decoded), mime, nil
}

// isTransientStatus returns true for HTTP status codes that indicate a transient
// failure worth retrying (request timeout, rate limit, server errors).
func isTransientStatus(code int) bool {
	switch code {
	case 408, 429, 502, 503, 504:
		return true
	}
	return false
}
