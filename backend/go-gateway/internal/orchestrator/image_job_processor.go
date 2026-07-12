package orchestrator

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"go-gateway/internal/repository"
	"go-gateway/internal/service"
)

const (
	imageJobPhaseAwaitingStage = "awaiting_stage"
	imageJobPhaseStaged        = "staged"
	imageJobPhaseStored        = "stored"
	imageJobPhaseHistorySaved  = "history_saved"
	defaultImageJobLease       = 2 * time.Minute
)

// ImageJobStore is the fenced persistence-job contract used by the worker.
// The request path only needs the ImageJobEnqueuer subset; the worker needs
// claim, lease, phase, retry, and terminal transitions as well.
type ImageJobStore interface {
	ImageJobEnqueuer
	ClaimNext(context.Context, string, time.Duration) (*repository.ImageGenerationJob, error)
	RenewLease(context.Context, string, string, string, time.Duration) error
	SaveProcessingManifest(context.Context, string, string, string, json.RawMessage, time.Duration) error
	SchedulePersistenceRetry(context.Context, string, string, string, time.Time, string, string) error
	ScheduleCompensationRetry(context.Context, string, string, string, time.Time, string, string) error
	RecordRefund(context.Context, string, string, string, float64) error
	MarkCompleted(context.Context, string, string, string, json.RawMessage, json.RawMessage) error
	MarkFailed(context.Context, string, string, string, string, string) error
	MarkRefunded(context.Context, string, string, string, float64) error
}

// ImageJobProcessorOptions controls phase persistence. The worker owns the
// lease duration in normal operation; the option is useful for direct tests
// and callers that process a job without constructing a worker.
type ImageJobProcessorOptions struct {
	LeaseDuration time.Duration
	Logger        *log.Logger
}

// ImageJobProcessResult contains the durable manifest and permanent response
// produced after all history rows are upserted and idempotency is completed.
type ImageJobProcessResult struct {
	Manifest json.RawMessage
	Response json.RawMessage
}

// ImageJobProcessor resumes one claimed persistence job from its durable
// manifest. It performs no terminal job transition; the worker does that only
// after the heartbeat has stopped and the lease is still owned.
type ImageJobProcessor struct {
	storage     StorageService
	idempotency IdempotencyService
	jobs        ImageJobStore
	lease       time.Duration
	logger      *log.Logger
}

// NewImageJobProcessor creates a resumable processor. The variadic options
// keep the common three-dependency construction concise while allowing tests
// and startup wiring to inject a lease duration and logger.
func NewImageJobProcessor(
	storage StorageService,
	idempotency IdempotencyService,
	jobs ImageJobStore,
	options ...ImageJobProcessorOptions,
) *ImageJobProcessor {
	option := ImageJobProcessorOptions{LeaseDuration: defaultImageJobLease, Logger: log.Default()}
	if len(options) > 0 {
		if options[0].LeaseDuration > 0 {
			option.LeaseDuration = options[0].LeaseDuration
		}
		if options[0].Logger != nil {
			option.Logger = options[0].Logger
		}
	}
	return &ImageJobProcessor{
		storage:     storage,
		idempotency: idempotency,
		jobs:        jobs,
		lease:       option.LeaseDuration,
		logger:      option.Logger,
	}
}

// Process resumes all per-image phases and returns the final response body.
// Every externally visible phase is persisted before the next phase begins,
// making a retry safe after a process crash.
func (p *ImageJobProcessor) Process(
	ctx context.Context,
	job *repository.ImageGenerationJob,
	workerID string,
	leaseToken string,
) (*ImageJobProcessResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if job == nil {
		return nil, errors.New("image generation job is nil")
	}
	if strings.TrimSpace(job.ID) == "" || strings.TrimSpace(workerID) == "" || strings.TrimSpace(leaseToken) == "" {
		return nil, errors.New("image generation job lease identity is incomplete")
	}
	if p == nil || p.storage == nil {
		return nil, errors.New("image storage service is unavailable")
	}
	if p.jobs == nil {
		return nil, errors.New("image job store is unavailable")
	}
	if len(job.ResultManifest) == 0 {
		return nil, errors.New("image generation job manifest is empty")
	}

	var manifest imageJobManifest
	if err := json.Unmarshal(job.ResultManifest, &manifest); err != nil {
		return nil, fmt.Errorf("decode image generation job manifest: %w", err)
	}
	if manifest.Version == 0 {
		manifest.Version = 1
	}
	if manifest.Version != 1 {
		return nil, fmt.Errorf("unsupported image generation job manifest version %d", manifest.Version)
	}
	if len(manifest.Images) == 0 {
		return nil, errors.New("image generation job manifest has no images")
	}

	for index := range manifest.Images {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		image := &manifest.Images[index]
		switch image.Phase {
		case imageJobPhaseStaged:
			if err := p.processStagedImage(ctx, image); err != nil {
				return nil, fmt.Errorf("process staged image %s: %w", image.Result.ID, err)
			}
			image.Phase = imageJobPhaseStored
			if err := p.saveManifest(ctx, job.ID, workerID, leaseToken, manifest); err != nil {
				return nil, err
			}
			fallthrough
		case imageJobPhaseStored:
			if err := p.saveHistory(ctx, image, manifest.Metadata); err != nil {
				return nil, fmt.Errorf("save history for image %s: %w", image.Result.ID, err)
			}
			image.Phase = imageJobPhaseHistorySaved
			if err := p.saveManifest(ctx, job.ID, workerID, leaseToken, manifest); err != nil {
				return nil, err
			}
		case imageJobPhaseHistorySaved:
			// Idempotent replay: the history row is already durable.
		case imageJobPhaseAwaitingStage:
			return nil, fmt.Errorf("image %s has not been staged", image.Result.ID)
		default:
			return nil, fmt.Errorf("image %s has unknown phase %q", image.Result.ID, image.Phase)
		}
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}
	response := permanentResponse(manifest)
	responseJSON, err := json.Marshal(response)
	if err != nil {
		return nil, fmt.Errorf("encode permanent image response: %w", err)
	}
	if userID, idemKey := jobIdempotencyIdentity(job, manifest); userID != "" || idemKey != "" {
		if userID == "" || idemKey == "" {
			return nil, errors.New("image job idempotency identity is incomplete")
		}
		if p.idempotency == nil {
			return nil, errors.New("idempotency service is unavailable")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		transactionID := firstNonEmpty(pointerValue(job.CreditTransactionID), manifest.Metadata.CreditTransactionID)
		if err := p.idempotency.Complete(ctx, userID, idemKey, "image_generate", http.StatusOK, response, transactionID); err != nil {
			return nil, fmt.Errorf("complete image idempotency: %w", err)
		}
	}

	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		return nil, fmt.Errorf("encode final image manifest: %w", err)
	}
	return &ImageJobProcessResult{Manifest: manifestJSON, Response: responseJSON}, nil
}

// ProcessJob is a descriptive alias for callers that prefer an explicit job
// name in their worker code.
func (p *ImageJobProcessor) ProcessJob(ctx context.Context, job *repository.ImageGenerationJob, workerID, leaseToken string) (*ImageJobProcessResult, error) {
	return p.Process(ctx, job, workerID, leaseToken)
}

func (p *ImageJobProcessor) saveManifest(
	ctx context.Context,
	jobID, workerID, leaseToken string,
	manifest imageJobManifest,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	body, err := json.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("encode processing manifest: %w", err)
	}
	if err := p.jobs.SaveProcessingManifest(ctx, jobID, workerID, leaseToken, body, p.lease); err != nil {
		return fmt.Errorf("save processing manifest: %w", err)
	}
	return nil
}

func (p *ImageJobProcessor) processStagedImage(ctx context.Context, image *imageJobManifestImage) error {
	if image == nil {
		return errors.New("manifest image is nil")
	}
	if strings.TrimSpace(image.StagedPath) == "" {
		return errors.New("staged path is empty")
	}
	if strings.TrimSpace(image.Result.ID) == "" {
		return errors.New("image id is empty")
	}
	if strings.ContainsAny(image.Result.ID, `/\\`) || strings.Contains(image.Result.ID, "..") {
		return errors.New("image id contains an unsafe path")
	}
	downloaded, err := p.storage.DownloadImage(ctx, image.StagedPath)
	if err != nil {
		return fmt.Errorf("download staged object: %w", err)
	}
	if downloaded == nil || len(downloaded.Data) == 0 {
		return errors.New("staged object is empty")
	}
	if image.StagedBytes > 0 && len(downloaded.Data) != image.StagedBytes {
		return fmt.Errorf("staged byte count mismatch: got %d want %d", len(downloaded.Data), image.StagedBytes)
	}
	sum := sha256.Sum256(downloaded.Data)
	actualSHA := hex.EncodeToString(sum[:])
	if strings.TrimSpace(image.StagedSHA256) == "" || !strings.EqualFold(actualSHA, image.StagedSHA256) {
		return fmt.Errorf("staged checksum mismatch: got %s want %s", actualSHA, image.StagedSHA256)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// The staging key intentionally has a generic `.source` suffix, so a
	// public-URL fallback may report a misleading MIME from the path. Prefer
	// the MIME captured at upload time, then use the downloaded metadata.
	mime := firstNonEmpty(image.StagedMime, downloaded.Mime, "image/png")
	stored, err := p.storage.StoreFromBufferAtPath(ctx, downloaded.Data, mime, "generated/"+image.Result.ID)
	if err != nil {
		return fmt.Errorf("store permanent image: %w", err)
	}
	if stored == nil || strings.TrimSpace(stored.StoragePath) == "" {
		return errors.New("storage returned empty permanent image")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	result := image.Result
	result.URL = stored.PublicURL
	result.TemporaryURL = ""
	result.DataURL = ""
	result.PreviewURL = stored.PreviewURL
	result.PreviewPath = stored.PreviewPath
	result.ThumbnailURL = stored.ThumbnailURL
	result.ThumbnailPath = stored.ThumbnailPath
	result.StoragePath = stored.StoragePath
	result.Width = stored.Width
	result.Height = stored.Height
	result.Bytes = stored.Bytes
	result.PersistenceStatus = "persisted"
	image.Result = result
	return nil
}

func (p *ImageJobProcessor) saveHistory(ctx context.Context, image *imageJobManifestImage, metadata imageJobMetadata) error {
	if image == nil {
		return errors.New("manifest image is nil")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	result := resultWithMetadata(image.Result, metadata)
	image.Result = result
	item := historyItemForManifest(result, metadata)
	if err := p.storage.SaveImageHistory(ctx, &item, metadata.UserID); err != nil {
		return err
	}
	return nil
}

func resultWithMetadata(result ImageResult, metadata imageJobMetadata) ImageResult {
	if result.UserID == "" {
		result.UserID = metadata.UserID
	}
	if result.GenerationBatchID == "" {
		result.GenerationBatchID = metadata.BatchID
	}
	if result.Prompt == "" {
		result.Prompt = metadata.DisplayPrompt
	}
	if result.UserPrompt == "" {
		result.UserPrompt = metadata.DisplayPrompt
	}
	if result.SystemPrompt == "" {
		result.SystemPrompt = metadata.SystemPrompt
	}
	if result.ModelPrompt == "" {
		result.ModelPrompt = metadata.ModelPrompt
	}
	if len(result.References) == 0 {
		result.References = metadata.References
	}
	if result.ReferenceCount == 0 {
		result.ReferenceCount = metadata.ReferenceCount
	}
	if result.Visibility == "" {
		result.Visibility = metadata.Visibility
	}
	if result.FundingSource == "" {
		result.FundingSource = metadata.FundingSource
	}
	if result.CreditCost == 0 {
		result.CreditCost = metadata.CreditCost
	}
	if result.Size == "" {
		result.Size = metadata.Size
	}
	if result.AspectRatio == "" {
		result.AspectRatio = metadata.AspectRatio
	}
	if result.Resolution == "" {
		result.Resolution = metadata.Resolution
	}
	if result.Quality == "" {
		result.Quality = metadata.Quality
	}
	return result
}

func historyItemForManifest(result ImageResult, metadata imageJobMetadata) service.ImageHistoryItem {
	result = resultWithMetadata(result, metadata)
	generatedAt := time.Now().UTC()
	if parsed, err := time.Parse(time.RFC3339, result.Timestamp); err == nil {
		generatedAt = parsed
	}
	return service.ImageHistoryItem{
		ID:                  result.ID,
		UserID:              metadata.UserID,
		GenerationBatchID:   metadata.BatchID,
		Prompt:              firstNonEmpty(metadata.DisplayPrompt, result.Prompt),
		UserPrompt:          firstNonEmpty(result.UserPrompt, metadata.DisplayPrompt),
		SystemPrompt:        firstNonEmpty(result.SystemPrompt, metadata.SystemPrompt),
		ModelPrompt:         firstNonEmpty(result.ModelPrompt, metadata.ModelPrompt),
		StoragePath:         result.StoragePath,
		URL:                 result.URL,
		PreviewURL:          result.PreviewURL,
		PreviewPath:         result.PreviewPath,
		ThumbnailURL:        result.ThumbnailURL,
		ThumbnailPath:       result.ThumbnailPath,
		Size:                firstNonEmpty(result.Size, metadata.Size),
		AspectRatio:         firstNonEmpty(result.AspectRatio, metadata.AspectRatio),
		Resolution:          firstNonEmpty(result.Resolution, metadata.Resolution),
		Quality:             firstNonEmpty(result.Quality, metadata.Quality),
		ImageModel:          metadata.ImageModel,
		RevisedPrompt:       result.RevisedPrompt,
		Width:               result.Width,
		Height:              result.Height,
		Bytes:               result.Bytes,
		Timestamp:           generatedAt,
		References:          metadata.References,
		ReferenceCount:      metadata.ReferenceCount,
		Visibility:          firstNonEmpty(result.Visibility, metadata.Visibility),
		FundingSource:       firstNonEmpty(result.FundingSource, metadata.FundingSource),
		CreditCost:          firstNonZero(result.CreditCost, metadata.CreditCost),
		CreditTransactionID: metadata.CreditTransactionID,
	}
}

func permanentResponse(manifest imageJobManifest) GenResponse {
	images := make([]ImageResult, len(manifest.Images))
	for index, image := range manifest.Images {
		result := resultWithMetadata(image.Result, manifest.Metadata)
		result.TemporaryURL = ""
		result.DataURL = ""
		result.PersistenceStatus = "persisted"
		images[index] = result
	}
	response := GenResponse{
		Images:     images,
		CreditCost: manifest.Metadata.CreditCost,
		TotalCost:  manifest.Metadata.TotalCost,
	}
	if manifest.Metadata.CreditBalance != nil {
		response.CreditBalance = &struct {
			Balance float64 `json:"balance"`
		}{Balance: *manifest.Metadata.CreditBalance}
	}
	return response
}

func jobIdempotencyIdentity(job *repository.ImageGenerationJob, manifest imageJobManifest) (string, string) {
	userID := pointerValue(job.UserID)
	idemKey := pointerValue(job.IdempotencyKey)
	if userID == "" {
		userID = strings.TrimSpace(manifest.Metadata.UserID)
	}
	return userID, idemKey
}

func pointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func firstNonZero(values ...float64) float64 {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

// cleanupStagingObjects removes only the raw staging objects. It is called
// after a successful terminal transition, never while a lease is uncertain.
func (p *ImageJobProcessor) cleanupStagingObjects(ctx context.Context, manifest imageJobManifest) {
	if p == nil || p.storage == nil {
		return
	}
	paths := make([]string, 0, len(manifest.Images))
	for _, image := range manifest.Images {
		if image.StagedPath != "" {
			paths = append(paths, image.StagedPath)
		}
	}
	if len(paths) == 0 {
		return
	}
	if err := p.storage.DeleteObjects(ctx, paths...); err != nil && p.logger != nil {
		p.logger.Printf("[image-job] failed to clean staging objects: %v", err)
	}
}

// cleanupCompensation removes known history rows and object paths after a
// refund/failed terminal transition. Cleanup is deliberately best effort;
// the durable terminal state remains authoritative for later reconciliation.
func (p *ImageJobProcessor) cleanupCompensation(ctx context.Context, manifest imageJobManifest) {
	if p == nil || p.storage == nil {
		return
	}
	for _, image := range manifest.Images {
		if image.Result.ID != "" {
			if err := p.storage.DeleteImageHistoryByID(ctx, image.Result.ID); err != nil && p.logger != nil {
				p.logger.Printf("[image-job] failed to clean history %s: %v", image.Result.ID, err)
			}
		}
		// Always pass the durable permanent paths explicitly. DeleteImageHistoryByID
		// removes the row before object deletion, so relying on the history row
		// alone would lose the paths when that cleanup partially fails.
		paths := []string{
			image.StagedPath,
			image.Result.StoragePath,
			image.Result.PreviewPath,
			image.Result.ThumbnailPath,
		}
		if err := p.storage.DeleteObjects(ctx, paths...); err != nil && p.logger != nil {
			p.logger.Printf("[image-job] failed to clean compensation objects for %s: %v", image.Result.ID, err)
		}
	}
}
