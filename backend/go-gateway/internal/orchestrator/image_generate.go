package orchestrator

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
	"reflect"
	"strings"
	"time"

	"go-gateway/internal/config"
	"go-gateway/internal/middleware"
	"go-gateway/internal/repository"
	"go-gateway/internal/saga"
	"go-gateway/internal/service"
)

// ImageOrchestrator 编排图片生成管线：额度预留 → 调 AI API → 异步持久化（含补偿）。
//
// 它不持有任何 HTTP 概念，只通过资源接口操作外部副作用。
// 所有多点回滚逻辑通过 saga 显式建模，集中在 persistAsyncSaga 里。
type ImageOrchestrator struct {
	credit      CreditService
	storage     StorageService
	idempotency IdempotencyService
	provider    ProviderSettingsService
	httpClient  *http.Client
	logger      *log.Logger
}

// NewImageOrchestrator 创建编排器。idempotency / provider 可为 nil（表示禁用）。
func NewImageOrchestrator(
	credit CreditService,
	storage StorageService,
	idempotency IdempotencyService,
) *ImageOrchestrator {
	return &ImageOrchestrator{
		credit:      normalizeCreditService(credit),
		storage:     normalizeStorageService(storage),
		idempotency: normalizeIdempotencyService(idempotency),
		httpClient:  &http.Client{Timeout: 360 * time.Second},
		logger:      log.Default(),
	}
}

// WithProviderSettings 注入图片 Provider 配置源。返回自身以支持链式调用。
func (o *ImageOrchestrator) WithProviderSettings(provider ProviderSettingsService) *ImageOrchestrator {
	o.provider = normalizeProviderSettingsService(provider)
	return o
}

func normalizeCreditService(service CreditService) CreditService {
	if resourceIsNil(service) {
		return nil
	}
	return service
}

func normalizeStorageService(service StorageService) StorageService {
	if resourceIsNil(service) {
		return nil
	}
	return service
}

func normalizeIdempotencyService(service IdempotencyService) IdempotencyService {
	if resourceIsNil(service) {
		return nil
	}
	return service
}

func normalizeProviderSettingsService(service ProviderSettingsService) ProviderSettingsService {
	if resourceIsNil(service) {
		return nil
	}
	return service
}

func resourceIsNil(value any) bool {
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

// WithLogger 覆盖默认 logger。
func (o *ImageOrchestrator) WithLogger(logger *log.Logger) *ImageOrchestrator {
	if logger != nil {
		o.logger = logger
	}
	return o
}

// GenerateParams 封装单次 Generate 调用的全部入参。
type GenerateParams struct {
	User    *middleware.User
	RawBody []byte
	IdemKey string
	Request GenRequest
}

// Generate 执行图片生成编排。
//
// 返回值：
//   - *GenResponse: 成功时的响应（已被 idempotency 缓存，并触发异步持久化）
//   - *StatusError: 业务错误，携带 HTTP 状态码供 handler 直接使用
//
// 关键行为（与原 handler.Generate 保持一致）：
//  1. 幂等检查：replay 命中时直接返回缓存；conflict 返回 409
//  2. 预留额度：失败返回 402（不足）或 503（服务不可用）
//  3. 调 AI API：失败全量退款 + 标记幂等失败，返回 500
//  4. 部分退款：返回图少于请求时按比例退款
//  5. 异步持久化：goroutine 内用 saga 执行 持久化→存历史；失败反向补偿
func (o *ImageOrchestrator) Generate(ctx context.Context, params GenerateParams) (*GenResponse, *StatusError) {
	user := params.User
	req := params.Request
	idemKey := params.IdemKey

	// 存储服务可用性
	if o.storage == nil {
		return nil, &StatusError{Code: http.StatusServiceUnavailable, Message: "图片存储服务暂时不可用。"}
	}

	// --- 幂等检查 ---
	// 已登录用户使用额度生成时必须携带幂等键
	if user != nil && user.ID != "" && o.credit != nil && strings.TrimSpace(idemKey) == "" {
		return nil, &StatusError{Code: http.StatusBadRequest, Message: "缺少 Idempotency-Key，请刷新后重试。"}
	}
	if idemKey != "" && user != nil && user.ID != "" {
		if o.idempotency == nil {
			return nil, &StatusError{Code: http.StatusServiceUnavailable, Message: "幂等服务暂时不可用，请稍后重试。"}
		}
		outcome, err := o.idempotency.Acquire(ctx, user.ID, idemKey, "image_generate", params.RawBody)
		if err != nil {
			o.logger.Printf("[idempotency] acquire error: %v", err)
			return nil, &StatusError{Code: http.StatusServiceUnavailable, Message: "服务暂时不可用，请稍后重试"}
		}
		if outcome != nil {
			if outcome.Conflict {
				return nil, &StatusError{Code: http.StatusConflict, Message: "请求正在处理中或使用相同的幂等键发送了不同的请求。"}
			}
			if !outcome.Proceed && outcome.ReplayBody != nil {
				// 幂等重放：直接返回缓存的响应字节
				return nil, &StatusError{
					Code:    int(outcome.ReplayCode),
					Headers: map[string]string{"X-Idempotent-Replay": "true", "Content-Type": "application/json"},
					Body:    outcome.ReplayBody,
				}
			}
		}
	}

	// --- 参数归一化 ---
	count := normalizeImageCount(req.Count)
	aspectRatio := normalizeAspectRatio(req.AspectRatio)
	resolution := normalizeResolution(req.Resolution)
	quality := normalizeQuality(req.Quality)
	size := determineSize(resolution, aspectRatio)
	displayPrompt := firstNonEmpty(strings.TrimSpace(req.UserPrompt), strings.TrimSpace(req.DisplayPrompt), strings.TrimSpace(req.Prompt))
	modelPrompt := firstNonEmpty(strings.TrimSpace(req.ModelPrompt), strings.TrimSpace(req.Prompt))

	// --- 计算额度 ---
	costPerImage := config.ImageCreditCostPerImage
	totalCost := roundToTwoDecimals(float64(count) * costPerImage)
	if o.credit != nil {
		costPerImage, totalCost = o.credit.GetCreditCost(ctx, count)
	}

	// --- 解析 Provider 配置 ---
	providerCfg, perr := o.resolveImageProvider(ctx)
	if perr != nil {
		o.logger.Printf("[image] provider config unavailable: %v", perr)
		o.failIdempotency(user, idemKey)
		return nil, &StatusError{Code: http.StatusServiceUnavailable, Message: "图片 Provider 配置暂时不可用。"}
	}
	if providerCfg.APIKey == "" || providerCfg.BaseURL == "" {
		o.failIdempotency(user, idemKey)
		return nil, &StatusError{Code: http.StatusServiceUnavailable, Message: "图片 Provider 尚未配置，请联系管理员。"}
	}

	// --- 预留额度 ---
	var reservation *service.CreditReservation
	if user != nil && user.ID != "" && o.credit != nil {
		txID, newBalance, reservedCostPerImage, cost, err := o.credit.ReserveCredits(ctx, user.ID, count)
		if err != nil {
			if errors.Is(err, repository.ErrInsufficientCredits) {
				o.failIdempotency(user, idemKey)
				return nil, &StatusError{Code: http.StatusPaymentRequired, Message: "额度不足。"}
			}
			o.logger.Printf("[image] 503: failed to reserve credits: %v", err)
			o.failIdempotency(user, idemKey)
			return nil, &StatusError{Code: http.StatusServiceUnavailable, Message: "额度服务暂时不可用，请稍后重试。"}
		}
		reservation = &service.CreditReservation{
			TransactionID: txID,
			Amount:        cost,
			Balance:       newBalance,
		}
		totalCost = cost
		costPerImage = reservedCostPerImage
	}

	// --- 调 AI API（不可逆步骤，无补偿）---
	images, ierr := o.callImageAPI(ctx, req, count, aspectRatio, resolution, quality, providerCfg)
	if ierr != nil {
		o.logger.Printf("[image] generation failed: %v", ierr)
		// 全额退款
		if reservation != nil {
			refundCtx, refundCancel := withRefundContext()
			_, refundErr := o.credit.RefundCredits(refundCtx, user.ID, reservation.TransactionID, reservation.Amount, "image_generation_failed")
			refundCancel()
			if refundErr != nil {
				o.logger.Printf("[image] failed to refund credits after generation failure: %v", refundErr)
			}
		}
		o.failIdempotency(user, idemKey)
		return nil, &StatusError{Code: http.StatusInternalServerError, Message: "图片生成失败，请稍后重试。"}
	}

	// --- 部分退款：返回图少于请求 ---
	if reservation != nil && len(images) < count && count > 0 {
		missingCount := count - len(images)
		refundAmount := roundToTwoDecimals(float64(missingCount) * costPerImage)
		if refundAmount > 0 {
			refundCtx, refundCancel := withRefundContext()
			newBalance, refundErr := o.credit.RefundCredits(refundCtx, user.ID, reservation.TransactionID, refundAmount, "partial_generation")
			refundCancel()
			if refundErr != nil {
				o.logger.Printf("[image] failed to refund credits for partial generation (%d/%d): %v", len(images), count, refundErr)
			} else {
				totalCost = roundToTwoDecimals(totalCost - refundAmount)
				reservation.Balance = newBalance
				reservation.Amount = totalCost
			}
		}
	}

	// --- 构建 metadata + 预备响应 ---
	references := historyReferences(req.References)
	visibility := "public"
	fundingSource := "free"
	creditCost := 0.0
	var userID string
	var creditTransactionID string
	if user != nil {
		userID = user.ID
	}
	if reservation != nil {
		visibility = "private"
		fundingSource = "credit"
		creditCost = costPerImage
		creditTransactionID = reservation.TransactionID
	}

	batchID := "batch_" + randomID()
	imageModel := imageModelForRequest(providerCfg, len(req.References) > 0)
	metadata := imageGenerationMetadata{
		BatchID:             batchID,
		UserID:              userID,
		DisplayPrompt:       displayPrompt,
		SystemPrompt:        req.SystemPrompt,
		ModelPrompt:         modelPrompt,
		Size:                size,
		AspectRatio:         aspectRatio,
		Resolution:          resolution,
		Quality:             quality,
		ImageModel:          imageModel,
		References:          references,
		ReferenceCount:      len(references),
		Visibility:          visibility,
		FundingSource:       fundingSource,
		CreditCost:          creditCost,
		CreditTransactionID: creditTransactionID,
	}
	preparedImages := o.prepareGeneratedImages(images, metadata)

	responseImages := make([]ImageResult, 0, len(preparedImages))
	for _, image := range preparedImages {
		responseImages = append(responseImages, image.result)
	}
	resp := &GenResponse{
		Images:     responseImages,
		CreditCost: costPerImage,
		TotalCost:  totalCost,
	}
	if reservation != nil {
		resp.CreditBalance = &struct {
			Balance float64 `json:"balance"`
		}{Balance: reservation.Balance}
	}

	// --- 异步持久化（saga）—— 不阻塞响应 ---
	txID := ""
	if reservation != nil {
		txID = reservation.TransactionID
	}
	if len(preparedImages) > 0 {
		o.persistAsyncSaga(preparedImages, metadata, reservation, userID, user, idemKey, resp, txID)
	} else {
		o.completeIdempotency(ctx, user, idemKey, resp, txID)
	}

	return resp, nil
}

// failIdempotency 标记幂等失败（若启用）。使用脱离 request 的上下文。
func (o *ImageOrchestrator) failIdempotency(user *middleware.User, idemKey string) {
	if idemKey == "" || user == nil || user.ID == "" || o.idempotency == nil {
		return
	}
	ctx, cancel := withRefundContext()
	defer cancel()
	o.idempotency.Fail(ctx, user.ID, idemKey, "image_generate")
}

// completeIdempotency stores the replay response only after all required side
// effects for a successful request have completed.
func (o *ImageOrchestrator) completeIdempotency(ctx context.Context, user *middleware.User, idemKey string, resp *GenResponse, transactionID string) {
	if idemKey == "" || user == nil || user.ID == "" || o.idempotency == nil {
		return
	}
	o.idempotency.Complete(ctx, user.ID, idemKey, "image_generate", http.StatusOK, resp, transactionID)
}

// resolveImageProvider 解析图片 Provider 配置。
func (o *ImageOrchestrator) resolveImageProvider(ctx context.Context) (service.ImageProviderConfig, error) {
	if o.provider == nil {
		return service.DefaultImageProviderConfig(), nil
	}
	return o.provider.ImageProvider(ctx)
}

// persistAsyncSaga 在 goroutine 中用 saga 执行异步持久化。
//
// Saga 步骤（按每张图，顺序执行）：
//  1. persist-image-N：持久化单张图（转码+上传三份）— 补偿：清理该图已上传对象
//  2. save-history-N：保存历史记录 — 补偿：删除已保存的历史记录
//
// 整个 saga 失败后：退款 + 标记幂等失败。
// saga 内部 context 脱离 request context，防止客户端断开导致补偿失败。
func (o *ImageOrchestrator) persistAsyncSaga(
	images []generatedImageRecord,
	metadata imageGenerationMetadata,
	reservation *service.CreditReservation,
	userID string,
	user *middleware.User,
	idempotencyKey string,
	response *GenResponse,
	transactionID string,
) {
	if o.storage == nil || len(images) == 0 {
		return
	}

	// 复制 images 切片，避免与调用方共享底层数组
	imagesCopy := make([]generatedImageRecord, len(images))
	copy(imagesCopy, images)

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		runner := saga.NewRunner(o.logger)
		// 每张图记录已上传的对象路径，供补偿使用
		uploadedPathsByImage := make([][]string, len(imagesCopy))

		for i := range imagesCopy {
			idx := i

			// 步骤 1：持久化单张图 —— 补偿：清理该图已上传对象
			runner.Add(saga.Step{
				Name: fmt.Sprintf("persist-image-%d", idx),
				Do: func(ctx context.Context) error {
					persisted, err := o.persistGeneratedImage(ctx, imagesCopy[idx])
					if err != nil {
						return fmt.Errorf("persist image %s: %w", imagesCopy[idx].result.ID, err)
					}
					imagesCopy[idx].result = persisted
					uploadedPathsByImage[idx] = []string{persisted.StoragePath, persisted.PreviewPath, persisted.ThumbnailPath}
					return nil
				},
				Compensate: func(ctx context.Context) error {
					if paths := uploadedPathsByImage[idx]; len(paths) > 0 {
						o.storage.CleanupObjects(paths...)
					}
					return nil
				},
			})

			// 步骤 2：保存历史记录 —— 补偿：删除该历史记录
			historyID := imagesCopy[idx].result.ID
			runner.Add(saga.Step{
				Name: fmt.Sprintf("save-history-%d", idx),
				Do: func(ctx context.Context) error {
					historyItem := o.historyItemForGeneratedImage(imagesCopy[idx].result, metadata)
					if err := o.storage.SaveImageHistory(ctx, &historyItem, userID); err != nil {
						return fmt.Errorf("save history %s: %w", historyID, err)
					}
					return nil
				},
				Compensate: func(ctx context.Context) error {
					if _, err := o.storage.DeleteImageHistory(ctx, historyID, userID); err != nil {
						o.logger.Printf("[image] failed to clean up saved history record %s during rollback: %v", historyID, err)
					}
					return nil
				},
			})
		}

		if err := runner.Run(ctx); err != nil {
			o.logger.Printf("[image] async persistence saga failed: %v", err)
			o.handleAsyncPersistenceFailure(reservation, user, idempotencyKey)
			return
		}
		o.completeIdempotency(ctx, user, idempotencyKey, response, transactionID)
		o.logger.Printf("[image] async persistence saga completed: %d image(s)", len(imagesCopy))
	}()
}

// handleAsyncPersistenceFailure 在 saga 整体失败后执行最终补偿：退款 + 幂等失败。
// 对象清理和历史删除已在 saga 补偿中完成。
func (o *ImageOrchestrator) handleAsyncPersistenceFailure(
	reservation *service.CreditReservation,
	user *middleware.User,
	idempotencyKey string,
) {
	ctx, cancel := withRefundContext()
	defer cancel()

	if reservation != nil && o.credit != nil && user != nil && user.ID != "" {
		if _, refundErr := o.credit.RefundCredits(ctx, user.ID, reservation.TransactionID, reservation.Amount, "async_history_save_failed"); refundErr != nil {
			o.logger.Printf("[image] failed to refund credits after async persistence failure: %v", refundErr)
		}
	}
	if idempotencyKey != "" && user != nil && user.ID != "" && o.idempotency != nil {
		o.idempotency.Fail(ctx, user.ID, idempotencyKey, "image_generate")
	}
}

// persistGeneratedImage 持久化单张图：下载/解码 → 转码 → 上传三份。
func (o *ImageOrchestrator) persistGeneratedImage(ctx context.Context, image generatedImageRecord) (ImageResult, error) {
	persisted := image.result
	var stored *service.StoredImage
	var err error

	if image.source.URL != "" {
		stored, err = o.storage.StoreFromURL(ctx, image.source.URL, fmt.Sprintf("generated/%s", image.result.ID))
	} else if image.source.Base64 != "" {
		decoded, decodeErr := base64.StdEncoding.DecodeString(image.source.Base64)
		if decodeErr != nil {
			return persisted, fmt.Errorf("base64 decode failed: %w", decodeErr)
		}
		stored, err = o.storage.StoreFromBuffer(ctx, decoded, firstNonEmpty(image.source.Mime, "image/png"), fmt.Sprintf("generated/%s", image.result.ID))
	} else {
		return persisted, fmt.Errorf("missing provider image source")
	}
	if err != nil {
		return persisted, err
	}
	if stored == nil || stored.StoragePath == "" {
		return persisted, fmt.Errorf("storage returned empty result")
	}

	persisted.URL = stored.PublicURL
	persisted.DataURL = ""
	persisted.TemporaryURL = image.source.URL
	persisted.PersistenceStatus = "persisted"
	persisted.PreviewURL = stored.PreviewURL
	persisted.ThumbnailURL = stored.ThumbnailURL
	persisted.StoragePath = stored.StoragePath
	persisted.PreviewPath = stored.PreviewPath
	persisted.ThumbnailPath = stored.ThumbnailPath
	persisted.Width = stored.Width
	persisted.Height = stored.Height
	persisted.Bytes = stored.Bytes
	return persisted, nil
}

func (o *ImageOrchestrator) historyItemForGeneratedImage(image ImageResult, metadata imageGenerationMetadata) service.ImageHistoryItem {
	generatedAt := time.Now().UTC()
	if parsed, err := time.Parse(time.RFC3339, image.Timestamp); err == nil {
		generatedAt = parsed
	}

	return service.ImageHistoryItem{
		ID:                  image.ID,
		UserID:              metadata.UserID,
		GenerationBatchID:   metadata.BatchID,
		Prompt:              metadata.DisplayPrompt,
		UserPrompt:          metadata.DisplayPrompt,
		SystemPrompt:        metadata.SystemPrompt,
		ModelPrompt:         metadata.ModelPrompt,
		StoragePath:         image.StoragePath,
		URL:                 image.URL,
		PreviewURL:          image.PreviewURL,
		PreviewPath:         image.PreviewPath,
		ThumbnailURL:        image.ThumbnailURL,
		ThumbnailPath:       image.ThumbnailPath,
		Size:                metadata.Size,
		AspectRatio:         metadata.AspectRatio,
		Resolution:          metadata.Resolution,
		Quality:             metadata.Quality,
		ImageModel:          metadata.ImageModel,
		RevisedPrompt:       image.RevisedPrompt,
		Width:               image.Width,
		Height:              image.Height,
		Timestamp:           generatedAt,
		References:          metadata.References,
		ReferenceCount:      metadata.ReferenceCount,
		Visibility:          metadata.Visibility,
		FundingSource:       metadata.FundingSource,
		CreditCost:          metadata.CreditCost,
		CreditTransactionID: metadata.CreditTransactionID,
	}
}

func (o *ImageOrchestrator) prepareGeneratedImages(images []generatedImageRecord, metadata imageGenerationMetadata) []generatedImageRecord {
	now := time.Now().UTC().Format(time.RFC3339)
	prepared := make([]generatedImageRecord, 0, len(images))
	for _, image := range images {
		image.result.UserID = metadata.UserID
		image.result.GenerationBatchID = metadata.BatchID
		image.result.Prompt = metadata.DisplayPrompt
		image.result.UserPrompt = metadata.DisplayPrompt
		image.result.SystemPrompt = metadata.SystemPrompt
		image.result.ModelPrompt = metadata.ModelPrompt
		image.result.References = metadata.References
		image.result.ReferenceCount = metadata.ReferenceCount
		image.result.Visibility = metadata.Visibility
		image.result.FundingSource = metadata.FundingSource
		image.result.CreditCost = metadata.CreditCost
		image.result.Size = metadata.Size
		image.result.AspectRatio = metadata.AspectRatio
		image.result.Resolution = metadata.Resolution
		image.result.Quality = metadata.Quality
		image.result.Timestamp = now
		if image.result.PreviewURL == "" {
			image.result.PreviewURL = image.result.URL
		}
		prepared = append(prepared, image)
	}
	return prepared
}

// callImageAPI 调用上游图片生成 API，带重试。
func (o *ImageOrchestrator) callImageAPI(ctx context.Context, req GenRequest, count int, aspectRatio, resolution, quality string, provider service.ImageProviderConfig) ([]generatedImageRecord, error) {
	size := determineSize(resolution, aspectRatio)
	imageMime := "image/png"
	usesEdits := len(req.References) > 0
	imageModel := imageModelForRequest(provider, usesEdits)

	apiReq := map[string]any{
		"model":   imageModel,
		"prompt":  req.Prompt,
		"n":       count,
		"size":    size,
		"quality": mapQualityToAPI(quality),
	}

	client := o.httpClient
	if client == nil {
		client = &http.Client{Timeout: 360 * time.Second}
	}
	if provider.Timeout > 0 && client.Timeout != provider.Timeout {
		client = &http.Client{Timeout: provider.Timeout}
	}
	maxRetries := provider.RetryCount
	if maxRetries < 0 {
		maxRetries = 0
	}
	if maxRetries > 10 {
		maxRetries = 10
	}
	urlPath := "/images/generations"
	var bodyFactory func() (io.Reader, string, error)
	if usesEdits {
		urlPath = "/images/edits"
		bodyFactory = func() (io.Reader, string, error) {
			return o.imageEditBody(ctx, apiReq, req.References)
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
			backoff := time.Duration(1<<uint(attempt-1)) * time.Second
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("context cancelled during retry backoff: %w", ctx.Err())
			case <-time.After(backoff):
			}
			o.logger.Printf("[image] retrying API call (attempt %d/%d)", attempt+1, maxRetries+1)
		}

		bodyReader, contentType, err := bodyFactory()
		if err != nil {
			return nil, err
		}
		httpReq, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(provider.BaseURL, "/")+urlPath, bodyReader)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		httpReq.Header.Set("Content-Type", contentType)
		httpReq.Header.Set("Authorization", "Bearer "+provider.APIKey)

		resp, err = client.Do(httpReq)
		if err != nil {
			if attempt < maxRetries {
				o.logger.Printf("[image] API call error (will retry): %v", err)
				continue
			}
			return nil, fmt.Errorf("failed to call image API: %w", err)
		}

		body, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read response: %w", err)
		}

		if isTransientStatus(resp.StatusCode) && attempt < maxRetries {
			o.logger.Printf("[image] API returned %d (will retry)", resp.StatusCode)
			continue
		}

		break
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

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

	results := make([]generatedImageRecord, 0, len(apiResp.Data))
	for i, item := range apiResp.Data {
		result := ImageResult{
			ID:            fmt.Sprintf("img_%d_%d_%s", time.Now().UnixNano(), i, randomID()),
			RevisedPrompt: item.RevisedPrompt,
		}

		if item.URL != "" {
			result.URL = item.URL
			result.TemporaryURL = item.URL
			result.PreviewURL = item.URL
			result.PersistenceStatus = "processing"
			results = append(results, generatedImageRecord{
				result: result,
				source: imageSource{
					URL:  item.URL,
					Mime: imageMime,
				},
			})
		} else if item.Base64 != "" {
			result.DataURL = "data:" + imageMime + ";base64," + item.Base64
			result.URL = result.DataURL
			result.PreviewURL = result.DataURL
			result.PersistenceStatus = "processing"
			results = append(results, generatedImageRecord{
				result: result,
				source: imageSource{
					Base64: item.Base64,
					Mime:   imageMime,
				},
			})
		}
	}

	if count > 0 && len(results) > count {
		o.logger.Printf("[image] provider returned %d image(s); keeping %d", len(results), count)
		results = results[:count]
	}

	return results, nil
}

func (o *ImageOrchestrator) imageEditBody(ctx context.Context, fields map[string]any, references []GenReference) (io.Reader, string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	for key, value := range fields {
		if err := writer.WriteField(key, fmt.Sprint(value)); err != nil {
			return nil, "", err
		}
	}

	for index, reference := range references {
		data, mime, err := o.referenceImageBytes(ctx, reference)
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

func (o *ImageOrchestrator) referenceImageBytes(ctx context.Context, reference GenReference) ([]byte, string, error) {
	if reference.StoragePath != "" {
		if o.storage == nil {
			return nil, "", fmt.Errorf("storage service unavailable")
		}
		image, err := o.storage.DownloadImage(ctx, reference.StoragePath)
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

// --- 纯 helper（业务规则 + 通用工具） ---

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

func imageModelForRequest(provider service.ImageProviderConfig, edits bool) string {
	if edits && strings.TrimSpace(provider.EditModel) != "" {
		return strings.TrimSpace(provider.EditModel)
	}
	if strings.TrimSpace(provider.ImageModel) != "" {
		return strings.TrimSpace(provider.ImageModel)
	}
	return strings.TrimSpace(config.ImageResponsesImageModel)
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

func historyReferences(references []GenReference) []service.ImageHistoryReference {
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

func isTransientStatus(code int) bool {
	switch code {
	case 408, 429, 502, 503, 504:
		return true
	}
	return false
}

// withRefundContext 创建脱离 request context 的上下文，防止客户端断开导致补偿失败。
func withRefundContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
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

func mimeFromPath(storagePath string) string {
	switch strings.ToLower(pathExt(storagePath)) {
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

func pathExt(p string) string {
	for i := len(p) - 1; i >= 0 && p[i] != '/'; i-- {
		if p[i] == '.' {
			return p[i:]
		}
	}
	return ""
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

func isAllowedReferenceMime(mime string) bool {
	switch mime {
	case "image/png", "image/jpeg", "image/webp", "image/gif":
		return true
	default:
		return false
	}
}
