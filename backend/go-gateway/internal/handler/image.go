package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/config"
	"go-gateway/internal/middleware"
	"go-gateway/internal/pkg/response"
	"go-gateway/internal/service"
)

// ImageHandler handles image-related endpoints
type ImageHandler struct {
	creditService *service.CreditService
	storageService *service.StorageService
}

// NewImageHandler creates a new image handler
func NewImageHandler(creditService *service.CreditService, storageService *service.StorageService) *ImageHandler {
	return &ImageHandler{
		creditService: creditService,
		storageService: storageService,
	}
}

// ImageGenRequest represents the image generation request
type ImageGenRequest struct {
	Prompt      string              `json:"prompt"`
	DisplayPrompt string            `json:"displayPrompt,omitempty"`
	UserPrompt  string              `json:"userPrompt,omitempty"`
	SystemPrompt string             `json:"systemPrompt,omitempty"`
	ModelPrompt string              `json:"modelPrompt,omitempty"`
	Size        string              `json:"size,omitempty"`
	AspectRatio string              `json:"aspectRatio,omitempty"`
	Resolution  string              `json:"resolution,omitempty"`
	Quality     string              `json:"quality,omitempty"`
	Count       int                 `json:"count,omitempty"`
	References  []ImageGenReference `json:"references,omitempty"`
}

// ImageGenReference represents a reference image
type ImageGenReference struct {
	ID           string `json:"id,omitempty"`
	Title        string `json:"title,omitempty"`
	DataUrl      string `json:"dataUrl,omitempty"`
	StoragePath  string `json:"storagePath,omitempty"`
	PreviewURL   string `json:"previewUrl,omitempty"`
	PreviewPath  string `json:"previewPath,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	ThumbnailPath string `json:"thumbnailPath,omitempty"`
	Content      string `json:"content,omitempty"`
	FileName     string `json:"fileName,omitempty"`
}

// ImageGenResponse represents the image generation response
type ImageGenResponse struct {
	Images       []ImageResult `json:"images"`
	CreditCost   float64       `json:"creditCost,omitempty"`
	TotalCost    float64       `json:"totalCost,omitempty"`
	CreditBalance *float64     `json:"creditBalance,omitempty"`
}

// ImageResult represents a generated image result
type ImageResult struct {
	ID          string  `json:"id"`
	URL         string  `json:"url,omitempty"`
	PreviewURL  string  `json:"previewUrl,omitempty"`
	ThumbnailURL string `json:"thumbnailUrl,omitempty"`
	RevisedPrompt string `json:"revisedPrompt,omitempty"`
	Width       int     `json:"width,omitempty"`
	Height      int     `json:"height,omitempty"`
}

// Generate handles POST /api/image/generate
func (h *ImageHandler) Generate(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	
	// Parse request body
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

	// Normalize parameters
	count := normalizeImageCount(req.Count)
	aspectRatio := normalizeAspectRatio(req.AspectRatio)
	resolution := normalizeResolution(req.Resolution)
	quality := normalizeQuality(req.Quality)

	// Calculate credit cost
	costPerImage, totalCost := h.creditService.GetCreditCost(count)

	// Check and reserve credits if user is authenticated
	var creditReservation *service.CreditReservation
	if user != nil && user.ID != "" {
		txID, newBalance, _, cost, err := h.creditService.ReserveCredits(r.Context(), user.ID, count)
		if err != nil {
			// Credit error - fall back to public generation
			// For now, return error since we don't have the public fallback logic yet
			if strings.Contains(err.Error(), "insufficient") {
				response.Error(w, http.StatusPaymentRequired, "额度不足。")
				return
			}
			// For other errors, try to continue without credits
			// The image will be generated but marked as public
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
		response.Error(w, http.StatusInternalServerError, "图片生成失败，请稍后重试。")
		return
	}

	// Partial refund: if fewer images returned than requested, refund the difference
	if creditReservation != nil && len(images) < count && count > 0 {
		missingCount := count - len(images)
		refundAmount := roundToTwoDecimals(float64(missingCount) * costPerImage)
		if refundAmount > 0 {
			_, refundErr := h.creditService.RefundCredits(r.Context(), user.ID, creditReservation.TransactionID, refundAmount, "partial_generation")
			if refundErr != nil {
				log.Printf("[image] failed to refund credits for partial generation (%d/%d): %v", len(images), count, refundErr)
			}
		}
	}

	// Build response
	resp := ImageGenResponse{
		Images:     images,
		CreditCost: costPerImage,
		TotalCost:  totalCost,
	}

	if creditReservation != nil {
		resp.CreditBalance = &creditReservation.Balance
	}

	response.JSON(w, http.StatusOK, resp)
}

// callImageAPI calls the image generation API
func (h *ImageHandler) callImageAPI(ctx context.Context, req ImageGenRequest, count int, aspectRatio, resolution, quality string) ([]ImageResult, error) {
	// Build API request
	size := determineSize(resolution, aspectRatio)
	
	apiReq := map[string]any{
		"model": config.ImageResponsesImageModel,
		"prompt": req.Prompt,
		"n": count,
		"size": size,
		"quality": mapQualityToAPI(quality),
	}

	// Add references if provided
	if len(req.References) > 0 {
		images := make([]string, 0, len(req.References))
		for _, ref := range req.References {
			if ref.DataUrl != "" {
				// Extract base64 from data URL
				if idx := strings.Index(ref.DataUrl, ","); idx >= 0 {
					images = append(images, ref.DataUrl[idx+1:])
				}
			}
		}
		if len(images) > 0 {
			apiReq["image"] = images
		}
	}

	// Marshal request
	reqBody, err := json.Marshal(apiReq)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	// Create HTTP request
	httpReq, err := http.NewRequest("POST", config.ImageGenBaseURL+"/images/generations", strings.NewReader(string(reqBody)))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+config.ImageGenAPIKey)

	// Set timeout
	client := &http.Client{
		Timeout: 360 * time.Second,
	}

	// Send request
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to call image API: %w", err)
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
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
	for i, item := range apiResp.Data {
		result := ImageResult{
			ID:           fmt.Sprintf("img_%d_%d", time.Now().UnixNano(), i),
			RevisedPrompt: item.RevisedPrompt,
		}

		// Store image and get URLs
		if item.URL != "" {
			// Download and store image
			stored, err := h.storageService.StoreFromURL(ctx, item.URL)
			if err == nil && stored != nil {
				result.URL = stored.PublicURL
				result.PreviewURL = stored.PreviewURL
				result.ThumbnailURL = stored.ThumbnailURL
			} else {
				result.URL = item.URL // Fallback to original URL
			}
		} else if item.Base64 != "" {
			// Decode base64 and store
			decoded, err := base64.StdEncoding.DecodeString(item.Base64)
			if err == nil {
				stored, err := h.storageService.StoreFromBuffer(ctx, decoded, "image/png", result.ID)
				if err == nil && stored != nil {
					result.URL = stored.PublicURL
					result.PreviewURL = stored.PreviewURL
					result.ThumbnailURL = stored.ThumbnailURL
				}
			}
		}

		results = append(results, result)
	}

	return results, nil
}

// ImageHistoryListResponse represents the image history list response
type ImageHistoryListResponse struct {
	Images      []service.ImageHistoryItem `json:"images"`
	Total       int                       `json:"total"`
	Limit       int                       `json:"limit,omitempty"`
	Offset      int                       `json:"offset,omitempty"`
	Persistence bool                      `json:"persistence"`
}

// ListHistory handles GET /api/image/history
func (h *ImageHandler) ListHistory(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	scope := r.URL.Query().Get("scope")
	if scope == "" {
		scope = "public"
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

	history, err := h.storageService.ListImageHistory(r.Context(), userID, scope, limit, offset)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "图片历史加载失败。")
		return
	}

	response.JSON(w, http.StatusOK, ImageHistoryListResponse{
		Images:      history.Images,
		Total:       history.Total,
		Limit:       limit,
		Offset:      offset,
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
	r.Post("/image/generate", h.Generate)
	r.Get("/image/history", h.ListHistory)
	r.Get("/image/history/{id}", h.GetHistoryDetail)
	r.Delete("/image/history/{id}", h.DeleteHistory)
	r.Delete("/image/history", h.ClearHistory)
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
