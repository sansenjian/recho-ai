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

// ImageOrchestrator 编排图片生成管线：额度预留 → 调 AI API → durable staging
// enqueue（或兼容的异步 saga）→ 持久化补偿。
//
// 它不持有任何 HTTP 概念，只通过资源接口操作外部副作用。
// Durable jobs own recoverable compensation; persistAsyncSaga remains only as
// the temporary compatibility path while worker wiring rolls out.
type ImageOrchestrator struct {
	credit      CreditService
	storage     StorageService
	idempotency IdempotencyService
	jobStore    ImageJobEnqueuer
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

// WithImageJobStore configures the durable staging-job repository. When it is
// absent, Generate keeps the legacy asynchronous saga for compatibility until
// durable worker wiring is enabled in the main process.
func (o *ImageOrchestrator) WithImageJobStore(store ImageJobEnqueuer) *ImageOrchestrator {
	o.jobStore = normalizeImageJobStore(store)
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

func normalizeImageJobStore(store ImageJobEnqueuer) ImageJobEnqueuer {
	if resourceIsNil(store) {
		return nil
	}
	return store
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
	User      *middleware.User
	RawBody   []byte
	IdemKey   string
	RequestID string
	Request   GenRequest
}

// Generate 执行图片生成编排。
//
// 返回值：
//   - *GenResponse: 成功时的响应（staging job 激活后返回；兼容路径触发异步持久化）
//   - *StatusError: 业务错误，携带 HTTP 状态码供 handler 直接使用
//
// 关键行为（与原 handler.Generate 保持一致）：
//  1. 幂等检查：replay 命中时直接返回缓存；conflict 返回 409
//  2. 预留额度：失败返回 402（不足）或 503（服务不可用）
//  3. 调 AI API：失败全量退款 + 标记幂等失败，返回 500
//  4. 部分退款：返回图少于请求时按比例退款
//  5. 持久化：优先创建并激活 durable staging job；未配置 job store 时保留 saga 兼容路径
func (o *ImageOrchestrator) Generate(ctx context.Context, params GenerateParams) (*GenResponse, *StatusError) {
	user := params.User
	req := params.Request
	idemKey := params.IdemKey
	requestID := ensureRequestID(params.RequestID)

	// 存储服务可用性
	if o.storage == nil {
		return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeStorageUnavailable, "图片存储服务暂时不可用。")
	}

	// --- 幂等检查 ---
	// 已登录用户使用额度生成时必须携带幂等键
	if user != nil && user.ID != "" && o.credit != nil && strings.TrimSpace(idemKey) == "" {
		return nil, domainStatusError(http.StatusBadRequest, ErrorCodeIdempotencyKeyRequired, "缺少 Idempotency-Key，请刷新后重试。")
	}
	if idemKey != "" && user != nil && user.ID != "" {
		if o.idempotency == nil {
			return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeIdempotencyUnavailable, "幂等服务暂时不可用，请稍后重试。")
		}
		outcome, err := o.idempotency.Acquire(ctx, user.ID, idemKey, "image_generate", params.RawBody)
		if err != nil {
			o.logger.Printf("[idempotency] acquire error: %v", err)
			return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeIdempotencyUnavailable, "服务暂时不可用，请稍后重试")
		}
		if outcome != nil {
			if outcome.Conflict {
				return nil, domainStatusError(http.StatusConflict, ErrorCodeIdempotencyConflict, "请求正在处理中或使用相同的幂等键发送了不同的请求。")
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
		return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeProviderUnavailable, "图片 Provider 配置暂时不可用。")
	}
	if providerCfg.APIKey == "" || providerCfg.BaseURL == "" {
		o.failIdempotency(user, idemKey)
		return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeProviderUnavailable, "图片 Provider 尚未配置，请联系管理员。")
	}

	// --- 构建初始任务 metadata ---
	references := historyReferences(req.References)
	visibility := "public"
	fundingSource := "free"
	creditCost := 0.0
	var userID string
	if user != nil {
		userID = user.ID
	}
	usesCredits := userID != "" && o.credit != nil && totalCost > 0
	if usesCredits {
		visibility = "private"
		fundingSource = "credit"
		creditCost = costPerImage
	}

	batchID := "batch_" + randomID()
	metadata := imageGenerationMetadata{
		BatchID:        batchID,
		UserID:         userID,
		DisplayPrompt:  displayPrompt,
		SystemPrompt:   req.SystemPrompt,
		ModelPrompt:    modelPrompt,
		Size:           size,
		AspectRatio:    aspectRatio,
		Resolution:     resolution,
		Quality:        quality,
		ImageModel:     imageModelForRequest(providerCfg, len(req.References) > 0),
		References:     references,
		ReferenceCount: len(references),
		Visibility:     visibility,
		FundingSource:  fundingSource,
		CreditCost:     creditCost,
		TotalCost:      totalCost,
	}

	// --- 原子预留额度并创建 staging job ---
	var reservation *service.CreditReservation
	var stagingJob *repository.ImageGenerationJob
	if usesCredits && o.jobStore != nil {
		started, startErr := o.startCreditImageJob(ctx, metadata, user, idemKey, params.RawBody, requestID, count, totalCost, costPerImage)
		if startErr != nil {
			return nil, startErr
		}
		stagingJob = started.Job
		reservation = &service.CreditReservation{
			TransactionID: started.TransactionID,
			Amount:        totalCost,
			Balance:       started.Balance,
		}
		metadata.CreditTransactionID = started.TransactionID
	} else if usesCredits {
		txID, newBalance, reservedCostPerImage, cost, err := o.credit.ReserveCredits(ctx, user.ID, count)
		if err != nil {
			if errors.Is(err, repository.ErrInsufficientCredits) {
				o.failIdempotency(user, idemKey)
				return nil, domainStatusError(http.StatusPaymentRequired, ErrorCodeInsufficientCredits, "额度不足。")
			}
			o.logger.Printf("[image] 503: failed to reserve credits: %v", err)
			o.failIdempotency(user, idemKey)
			return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeCreditUnavailable, "额度服务暂时不可用，请稍后重试。")
		}
		reservation = &service.CreditReservation{
			TransactionID: txID,
			Amount:        cost,
			Balance:       newBalance,
		}
		totalCost = cost
		costPerImage = reservedCostPerImage
		metadata.CreditCost = costPerImage
		metadata.CreditTransactionID = txID
		metadata.TotalCost = totalCost
	}

	if o.jobStore != nil && stagingJob == nil {
		var startErr *StatusError
		stagingJob, startErr = o.createInitialImageJob(ctx, metadata, user, idemKey, params.RawBody, requestID, count, reservation)
		if startErr != nil {
			return nil, startErr
		}
	}
	o.logImageLifecycle(imageLifecycleEvent{
		Event: "provider_started", RequestID: requestID, GenerationID: metadata.BatchID,
		CreditTransactionID: metadata.CreditTransactionID, Provider: imageProviderName(providerCfg.BaseURL),
		RequestedCount: count,
	})

	// --- 调 AI API（不可逆步骤，无补偿）---
	images, ierr := o.callImageAPI(ctx, req, count, aspectRatio, resolution, quality, providerCfg)
	if ierr != nil {
		o.logger.Printf("[image] generation failed: %v", ierr)
		o.logImageLifecycle(imageLifecycleEvent{
			Event: "provider_failed", RequestID: requestID, GenerationID: metadata.BatchID,
			CreditTransactionID: metadata.CreditTransactionID, Provider: imageProviderName(providerCfg.BaseURL),
			ErrorCode: ErrorCodeProviderBadResponse, RequestedCount: count,
		})
		if stagingJob != nil {
			manifestJSON := imageJobManifestJSON(imageJobManifestFor(nil, metadata))
			o.handleStagingFailure(stagingJob, false, manifestJSON, requestID, reservation, user, idemKey, "provider_failed", ierr.Error())
		} else {
			o.handleImmediateCompensation(reservation, user, idemKey, "image_generation_failed")
		}
		return nil, domainStatusError(http.StatusInternalServerError, ErrorCodeProviderBadResponse, "图片生成失败，请稍后重试。")
	}
	o.logImageLifecycle(imageLifecycleEvent{
		Event: "provider_succeeded", RequestID: requestID, GenerationID: metadata.BatchID,
		CreditTransactionID: metadata.CreditTransactionID, Provider: imageProviderName(providerCfg.BaseURL),
		RequestedCount: count, ReturnedCount: len(images),
	})

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
				if stagingJob != nil {
					manifestJSON := imageJobManifestJSON(imageJobManifestFor(nil, metadata))
					return nil, o.handleStagingFailure(stagingJob, false, manifestJSON, requestID, reservation, user, idemKey, "partial_refund_failed", refundErr.Error())
				}
			} else {
				totalCost = roundToTwoDecimals(totalCost - refundAmount)
				reservation.Balance = newBalance
				reservation.Amount = totalCost
				metadata.TotalCost = totalCost
				if stagingJob != nil {
					recorder, ok := o.jobStore.(ImageJobStagingRefundRecorder)
					if !ok || resourceIsNil(recorder) {
						err := errors.New("image job store does not support staging refund records")
						manifestJSON := imageJobManifestJSON(imageJobManifestFor(nil, metadata))
						return nil, o.handleStagingFailure(stagingJob, false, manifestJSON, requestID, reservation, user, idemKey, "partial_refund_record_unavailable", err.Error())
					}
					leaseToken := imageJobLeaseToken(stagingJob)
					if err := recorder.RecordStagingRefund(ctx, stagingJob.ID, requestID, leaseToken, refundAmount, len(images), stagingJobLeaseDuration); err != nil {
						manifestJSON := imageJobManifestJSON(imageJobManifestFor(nil, metadata))
						return nil, o.handleStagingFailure(stagingJob, false, manifestJSON, requestID, reservation, user, idemKey, "partial_refund_record_failed", err.Error())
					}
				}
			}
		}
	}

	// --- 构建 metadata + 预备响应 ---
	if reservation != nil {
		metadata.CreditTransactionID = reservation.TransactionID
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
		balance := reservation.Balance
		metadata.CreditBalance = &balance
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
		if o.jobStore != nil {
			if statusErr := o.enqueueImageJob(ctx, stagingJob, preparedImages, metadata, reservation, user, idemKey, params.RawBody, requestID, count); statusErr != nil {
				return nil, statusErr
			}
			o.logImageLifecycle(imageLifecycleEvent{
				Event: "persistence_queued", RequestID: requestID, GenerationID: metadata.BatchID,
				CreditTransactionID: metadata.CreditTransactionID, Provider: imageProviderName(providerCfg.BaseURL),
				RequestedCount: count, ReturnedCount: len(preparedImages),
			})
		} else {
			// Durable worker wiring removes this compatibility path once every
			// orchestrator instance has the persistence worker configured.
			o.persistAsyncSaga(preparedImages, metadata, reservation, userID, user, idemKey, resp, txID)
		}
	} else {
		if stagingJob != nil {
			manifestJSON := imageJobManifestJSON(imageJobManifestFor(nil, metadata))
			o.handleStagingFailure(stagingJob, false, manifestJSON, requestID, reservation, user, idemKey, "provider_empty_result", "provider returned no usable images")
			return nil, domainStatusError(http.StatusInternalServerError, ErrorCodeProviderBadResponse, "图片生成失败，请稍后重试。")
		}
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
	if err := o.idempotency.Fail(ctx, user.ID, idemKey, "image_generate"); err != nil {
		o.logger.Printf("[idempotency] failed to mark request failed: %v", err)
	}
}

const stagingJobLeaseDuration = 10 * time.Minute

func ensureRequestID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "request-local-" + randomID()
	}
	return value
}

func optionalStringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func imageJobManifestJSON(manifest imageJobManifest) json.RawMessage {
	data, err := json.Marshal(manifest)
	if err != nil {
		return json.RawMessage(`{"version":1,"metadata":{},"images":[]}`)
	}
	return data
}

func imageJobLeaseToken(job *repository.ImageGenerationJob) string {
	if job == nil || job.LeaseToken == nil {
		return ""
	}
	return strings.TrimSpace(*job.LeaseToken)
}

func (o *ImageOrchestrator) startCreditImageJob(
	ctx context.Context,
	metadata imageGenerationMetadata,
	user *middleware.User,
	idempotencyKey string,
	rawBody []byte,
	requestID string,
	requestedCount int,
	reservedAmount float64,
	costPerImage float64,
) (*repository.ImageGenerationJobStart, *StatusError) {
	starter, ok := o.jobStore.(ImageJobCreditStarter)
	if !ok || resourceIsNil(starter) {
		o.failIdempotency(user, idempotencyKey)
		return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeImageJobUnavailable, "图片任务服务暂不支持原子扣费，请稍后重试。")
	}
	manifest := imageJobManifestJSON(imageJobManifestFor(nil, metadata))
	input := repository.StartImageGenerationJobInput{
		UserID:            user.ID,
		IdempotencyKey:    idempotencyKey,
		RequestHash:       service.HashBody(rawBody),
		GenerationBatchID: metadata.BatchID,
		RequestID:         requestID,
		RequestedCount:    requestedCount,
		ReservedAmount:    reservedAmount,
		CreditMetadata: map[string]any{
			"count":              requestedCount,
			"creditCostPerImage": costPerImage,
			"totalCost":          reservedAmount,
		},
		ResultManifest: manifest,
		LockOwner:      requestID,
		LeaseDuration:  stagingJobLeaseDuration,
	}
	started, err := starter.StartWithCredit(ctx, input)
	if err != nil && ctx.Err() == nil {
		retryCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		started, err = starter.StartWithCredit(retryCtx, input)
		cancel()
	}
	if err != nil {
		if errors.Is(err, repository.ErrInsufficientCredits) {
			o.failIdempotency(user, idempotencyKey)
			return nil, domainStatusError(http.StatusPaymentRequired, ErrorCodeInsufficientCredits, "额度不足。")
		}
		o.logger.Printf("[image] failed to atomically start image job: %v", err)
		o.failIdempotency(user, idempotencyKey)
		return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeCreditUnavailable, "额度服务暂时不可用，请稍后重试。")
	}
	if started == nil || started.Job == nil || strings.TrimSpace(started.Job.ID) == "" || imageJobLeaseToken(started.Job) == "" {
		o.failIdempotency(user, idempotencyKey)
		return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeImageJobUnavailable, "图片任务初始化失败，请稍后重试。")
	}
	return started, nil
}

func (o *ImageOrchestrator) createInitialImageJob(
	ctx context.Context,
	metadata imageGenerationMetadata,
	user *middleware.User,
	idempotencyKey string,
	rawBody []byte,
	requestID string,
	requestedCount int,
	reservation *service.CreditReservation,
) (*repository.ImageGenerationJob, *StatusError) {
	manifest := imageJobManifestJSON(imageJobManifestFor(nil, metadata))
	var idempotencyPtr *string
	var requestHashPtr *string
	if strings.TrimSpace(idempotencyKey) != "" {
		idempotencyPtr = optionalStringPointer(idempotencyKey)
		requestHashPtr = optionalStringPointer(service.HashBody(rawBody))
	}
	input := repository.CreateImageGenerationJob{
		GenerationBatchID: metadata.BatchID,
		RequestID:         requestID,
		UserID:            optionalStringPointer(metadata.UserID),
		IdempotencyKey:    idempotencyPtr,
		RequestHash:       requestHashPtr,
		ReservedAmount:    0,
		RequestedCount:    requestedCount,
		ReturnedCount:     0,
		MaxAttempts:       5,
		ResultManifest:    manifest,
		LockOwner:         requestID,
		LeaseDuration:     stagingJobLeaseDuration,
	}
	if reservation != nil {
		input.CreditTransactionID = optionalStringPointer(reservation.TransactionID)
		input.ReservedAmount = reservation.Amount
	}
	job, err := o.jobStore.CreateStaging(ctx, input)
	if err != nil && ctx.Err() == nil {
		retryCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		job, err = o.jobStore.CreateStaging(retryCtx, input)
		cancel()
	}
	if err != nil {
		o.logger.Printf("[image] failed to create initial staging job: %v", err)
		o.handleImmediateCompensation(reservation, user, idempotencyKey, "staging_job_failed")
		return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodePersistenceQueueFailed, "图片持久化任务排队失败，请稍后重试。")
	}
	if job == nil || strings.TrimSpace(job.ID) == "" || imageJobLeaseToken(job) == "" {
		o.handleImmediateCompensation(reservation, user, idempotencyKey, "staging_job_failed")
		return nil, domainStatusError(http.StatusServiceUnavailable, ErrorCodeImageJobUnavailable, "图片任务初始化失败，请稍后重试。")
	}
	return job, nil
}

// enqueueImageJob creates and fully stages a durable persistence job before
// returning the temporary provider response. Provider URLs/base64 stay in the
// request-local generatedImageRecord and never enter the durable manifest.
func (o *ImageOrchestrator) enqueueImageJob(
	ctx context.Context,
	job *repository.ImageGenerationJob,
	images []generatedImageRecord,
	metadata imageGenerationMetadata,
	reservation *service.CreditReservation,
	user *middleware.User,
	idempotencyKey string,
	rawBody []byte,
	requestID string,
	requestedCount int,
) *StatusError {
	manifest := imageJobManifestFor(images, metadata)
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		o.logger.Printf("[image] failed to marshal staging manifest: %v", err)
		return o.handleStagingFailure(nil, true, manifestJSON, requestID, reservation, user, idempotencyKey, "manifest_encode_failed", err.Error())
	}

	if job == nil {
		return o.handleStagingFailure(nil, true, manifestJSON, requestID, reservation, user, idempotencyKey, "job_create_failed", "staging job is missing")
	}
	leaseToken := imageJobLeaseToken(job)
	if job == nil || strings.TrimSpace(job.ID) == "" || leaseToken == "" {
		err := errors.New("staging job returned without id or lease token")
		o.logger.Printf("[image] %v", err)
		return o.handleStagingFailure(job, job == nil, manifestJSON, requestID, reservation, user, idempotencyKey, "job_create_invalid", err.Error())
	}

	for index := range images {
		storagePath := fmt.Sprintf("staging/image-jobs/%s/%s.source", metadata.BatchID, images[index].result.ID)
		staged, stageErr := o.stageGeneratedImage(ctx, images[index], storagePath)
		if stageErr != nil {
			o.logger.Printf("[image] failed to stage image %s: %v", images[index].result.ID, stageErr)
			return o.handleStagingFailure(job, false, manifestJSON, requestID, reservation, user, idempotencyKey, "staging_failed", stageErr.Error())
		}
		if staged == nil || strings.TrimSpace(staged.StoragePath) == "" {
			err := errors.New("storage returned empty staged image")
			o.logger.Printf("[image] failed to stage image %s: %v", images[index].result.ID, err)
			return o.handleStagingFailure(job, false, manifestJSON, requestID, reservation, user, idempotencyKey, "staging_failed", err.Error())
		}

		manifest.Images[index].StagedPath = staged.StoragePath
		manifest.Images[index].StagedMime = staged.Mime
		manifest.Images[index].StagedBytes = staged.Bytes
		manifest.Images[index].StagedSHA256 = staged.SHA256
		manifest.Images[index].Phase = "staged"
		manifestJSON, err = json.Marshal(manifest)
		if err != nil {
			o.logger.Printf("[image] failed to marshal staged manifest: %v", err)
			return o.handleStagingFailure(job, false, manifestJSON, requestID, reservation, user, idempotencyKey, "manifest_encode_failed", err.Error())
		}
		if err := o.jobStore.SaveStagingManifest(ctx, job.ID, requestID, leaseToken, manifestJSON, stagingJobLeaseDuration); err != nil {
			o.logger.Printf("[image] failed to save staged manifest: %v", err)
			return o.handleStagingFailure(job, false, manifestJSON, requestID, reservation, user, idempotencyKey, "manifest_save_failed", err.Error())
		}
	}

	if err := o.jobStore.Activate(ctx, job.ID, requestID, leaseToken); err != nil {
		o.logger.Printf("[image] failed to activate staging job %s: %v", job.ID, err)
		return o.handleStagingFailure(job, false, manifestJSON, requestID, reservation, user, idempotencyKey, "activation_failed", err.Error())
	}
	return nil
}

func (o *ImageOrchestrator) stageGeneratedImage(ctx context.Context, image generatedImageRecord, storagePath string) (*service.StagedImage, error) {
	if image.source.URL != "" {
		return o.storage.StageFromURL(ctx, image.source.URL, storagePath)
	}
	if image.source.Base64 != "" {
		decoded, err := base64.StdEncoding.DecodeString(image.source.Base64)
		if err != nil {
			return nil, fmt.Errorf("base64 decode failed: %w", err)
		}
		return o.storage.StageFromBuffer(ctx, decoded, firstNonEmpty(image.source.Mime, "image/png"), storagePath)
	}
	return nil, errors.New("missing provider image source")
}

func imageJobManifestFor(images []generatedImageRecord, metadata imageGenerationMetadata) imageJobManifest {
	manifest := imageJobManifest{
		Version:  1,
		Metadata: imageJobMetadataFor(metadata),
		Images:   make([]imageJobManifestImage, 0, len(images)),
	}
	for _, image := range images {
		result := image.result
		result.URL = ""
		result.TemporaryURL = ""
		result.DataURL = ""
		result.PreviewURL = ""
		result.PreviewPath = ""
		result.ThumbnailURL = ""
		result.ThumbnailPath = ""
		result.StoragePath = ""
		manifest.Images = append(manifest.Images, imageJobManifestImage{
			Result: result,
			Phase:  "awaiting_stage",
		})
	}
	return manifest
}

func imageJobMetadataFor(metadata imageGenerationMetadata) imageJobMetadata {
	return imageJobMetadata{
		BatchID:             metadata.BatchID,
		UserID:              metadata.UserID,
		DisplayPrompt:       metadata.DisplayPrompt,
		SystemPrompt:        metadata.SystemPrompt,
		ModelPrompt:         metadata.ModelPrompt,
		Size:                metadata.Size,
		AspectRatio:         metadata.AspectRatio,
		Resolution:          metadata.Resolution,
		Quality:             metadata.Quality,
		ImageModel:          metadata.ImageModel,
		References:          metadata.References,
		ReferenceCount:      metadata.ReferenceCount,
		Visibility:          metadata.Visibility,
		FundingSource:       metadata.FundingSource,
		CreditCost:          metadata.CreditCost,
		CreditTransactionID: metadata.CreditTransactionID,
		TotalCost:           metadata.TotalCost,
		CreditBalance:       metadata.CreditBalance,
	}
}

func (o *ImageOrchestrator) handleStagingFailure(
	job *repository.ImageGenerationJob,
	allowImmediateCompensation bool,
	manifest json.RawMessage,
	requestID string,
	reservation *service.CreditReservation,
	user *middleware.User,
	idempotencyKey string,
	code string,
	detail string,
) *StatusError {
	queued := false
	leaseToken := ""
	jobID := ""
	if job != nil {
		jobID = strings.TrimSpace(job.ID)
		if job.LeaseToken != nil {
			leaseToken = strings.TrimSpace(*job.LeaseToken)
		}
	}
	if o.jobStore != nil && jobID != "" && leaseToken != "" {
		compensationCtx, cancel := withRefundContext()
		queueErr := o.jobStore.QueueCompensation(compensationCtx, jobID, requestID, leaseToken, manifest, code, detail)
		cancel()
		if queueErr != nil {
			o.logger.Printf("[image] failed to queue durable staging compensation for %s: %v", jobID, queueErr)
		} else {
			queued = true
		}
	}
	if !queued {
		// For an existing durable row, an error while fencing compensation is
		// ambiguous: the database may have committed the state change even if
		// the request observed an error. Do not issue an immediate refund or
		// release the idempotency key here, because a later worker reclaim could
		// otherwise refund the same reservation twice or allow a duplicate call.
		// When no row was created, the legacy immediate fallback is still the
		// only way to release the provisional reservation.
		if o.jobStore != nil && !allowImmediateCompensation {
			o.logger.Printf("[image] durable compensation unavailable; leaving reservation and idempotency state pending (request_id=%s)", requestID)
		} else {
			o.handleImmediateCompensation(reservation, user, idempotencyKey, "staging_job_failed")
		}
	}
	return domainStatusError(http.StatusServiceUnavailable, ErrorCodePersistenceQueueFailed, "图片持久化任务排队失败，请稍后重试。")
}

func (o *ImageOrchestrator) handleImmediateCompensation(
	reservation *service.CreditReservation,
	user *middleware.User,
	idempotencyKey string,
	reason string,
) {
	ctx, cancel := withRefundContext()
	defer cancel()
	if reservation != nil && o.credit != nil && user != nil && user.ID != "" {
		if _, err := o.credit.RefundCredits(ctx, user.ID, reservation.TransactionID, reservation.Amount, reason); err != nil {
			o.logger.Printf("[image] failed to refund credits after %s: %v", reason, err)
		}
	}
	if idempotencyKey != "" && user != nil && user.ID != "" && o.idempotency != nil {
		if err := o.idempotency.Fail(ctx, user.ID, idempotencyKey, "image_generate"); err != nil {
			o.logger.Printf("[image] failed to mark idempotency failed after %s: %v", reason, err)
		}
	}
}

// completeIdempotency stores the replay response only after all required side
// effects for a successful request have completed.
func (o *ImageOrchestrator) completeIdempotency(ctx context.Context, user *middleware.User, idemKey string, resp *GenResponse, transactionID string) {
	if idemKey == "" || user == nil || user.ID == "" || o.idempotency == nil {
		return
	}
	if err := o.idempotency.Complete(ctx, user.ID, idemKey, "image_generate", http.StatusOK, resp, transactionID); err != nil {
		o.logger.Printf("[idempotency] failed to complete request: %v", err)
	}
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
	o.handleImmediateCompensation(reservation, user, idempotencyKey, "async_history_save_failed")
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
