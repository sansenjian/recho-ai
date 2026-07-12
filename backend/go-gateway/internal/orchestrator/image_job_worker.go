package orchestrator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"go-gateway/internal/repository"
)

const (
	defaultImageJobPollInterval      = 2 * time.Second
	defaultImageJobHeartbeatInterval = 20 * time.Second
	defaultImageJobTimeout           = 10 * time.Minute
	maxImageJobRetryDelay            = 5 * time.Minute
)

// ImageJobWorkerOptions contains all timing knobs so RunOnce remains
// deterministic in tests and startup can provide environment-backed values.
type ImageJobWorkerOptions struct {
	WorkerID          string
	PollInterval      time.Duration
	LeaseDuration     time.Duration
	HeartbeatInterval time.Duration
	JobTimeout        time.Duration
}

// ImageJobWorker claims durable jobs, drives resumable processing, and owns
// the lease-fenced retry/terminal transitions. It intentionally has one
// in-flight job; horizontal worker processes provide concurrency.
type ImageJobWorker struct {
	jobs      ImageJobStore
	processor *ImageJobProcessor
	credit    CreditService
	options   ImageJobWorkerOptions
	logger    *log.Logger
}

// NewImageJobWorker constructs a worker around an already configured
// processor. Keeping processor construction separate makes dependency seams
// explicit and lets tests inject a blocking processor/storage operation.
func NewImageJobWorker(
	jobs ImageJobStore,
	processor *ImageJobProcessor,
	credit CreditService,
	options ImageJobWorkerOptions,
) *ImageJobWorker {
	options = normalizeImageJobWorkerOptions(options)
	return &ImageJobWorker{jobs: jobs, processor: processor, credit: credit, options: options, logger: log.Default()}
}

// NewImageJobWorkerWithServices is a convenience constructor for application
// wiring that has not separately built an ImageJobProcessor.
func NewImageJobWorkerWithServices(
	jobs ImageJobStore,
	storage StorageService,
	idempotency IdempotencyService,
	credit CreditService,
	options ImageJobWorkerOptions,
) *ImageJobWorker {
	options = normalizeImageJobWorkerOptions(options)
	processor := NewImageJobProcessor(storage, idempotency, jobs, ImageJobProcessorOptions{LeaseDuration: options.LeaseDuration})
	return NewImageJobWorker(jobs, processor, credit, options)
}

// WithLogger replaces the default logger. It is useful for embedding the
// worker in a service that already has structured logging.
func (w *ImageJobWorker) WithLogger(logger *log.Logger) *ImageJobWorker {
	if w != nil && logger != nil {
		w.logger = logger
		if w.processor != nil {
			w.processor.logger = logger
		}
	}
	return w
}

func normalizeImageJobWorkerOptions(options ImageJobWorkerOptions) ImageJobWorkerOptions {
	if strings.TrimSpace(options.WorkerID) == "" {
		options.WorkerID = "image-job-worker-" + randomID()
	}
	if options.PollInterval <= 0 {
		options.PollInterval = defaultImageJobPollInterval
	}
	if options.LeaseDuration <= 0 {
		options.LeaseDuration = time.Minute
	}
	if options.HeartbeatInterval <= 0 || options.HeartbeatInterval >= options.LeaseDuration {
		options.HeartbeatInterval = options.LeaseDuration / 3
		if options.HeartbeatInterval <= 0 {
			options.HeartbeatInterval = defaultImageJobHeartbeatInterval
		}
	}
	if options.JobTimeout <= 0 {
		options.JobTimeout = defaultImageJobTimeout
	}
	return options
}

// RunOnce claims and processes at most one job. The bool reports whether a
// job was claimed; a nil job is not an error and is used by polling tests.
func (w *ImageJobWorker) RunOnce(ctx context.Context) (bool, error) {
	if w == nil || w.jobs == nil {
		return false, errors.New("image job worker is not configured")
	}
	if err := ctx.Err(); err != nil {
		return false, nil
	}
	job, err := w.jobs.ClaimNext(ctx, w.options.WorkerID, w.options.LeaseDuration)
	if err != nil {
		return false, err
	}
	if job == nil {
		return false, nil
	}
	leaseToken := pointerValue(job.LeaseToken)
	if leaseToken == "" {
		return true, errors.New("claimed image job has no lease token")
	}
	workerID := strings.TrimSpace(w.options.WorkerID)

	// Keep the lease context separate from the per-job timeout. A timed-out
	// provider/storage operation should be retryable while the worker still
	// owns the row lease; a heartbeat failure, in contrast, must cancel both
	// processing and every subsequent refund/terminal transition.
	leaseCtx, leaseCancel := context.WithCancel(ctx)
	defer leaseCancel()
	jobCtx := leaseCtx
	var timeoutCancel context.CancelFunc
	if w.options.JobTimeout > 0 {
		jobCtx, timeoutCancel = context.WithTimeout(leaseCtx, w.options.JobTimeout)
	} else {
		jobCtx, timeoutCancel = context.WithCancel(leaseCtx)
	}
	defer timeoutCancel()
	heartbeatErr, heartbeatDone, stopHeartbeat := w.startHeartbeat(leaseCtx, leaseCancel, job.ID, workerID, leaseToken)

	result, processErr := w.processClaimedJob(jobCtx, job, workerID, leaseToken)
	transitionErr := error(nil)
	// Keep heartbeat active while external compensation and fenced terminal
	// writes run. If the lease is lost during this block, leaseCtx is canceled
	// and the transition methods must not proceed with stale ownership.
	if ctx.Err() == nil && leaseCtx.Err() == nil && !errors.Is(processErr, repository.ErrJobLeaseLost) {
		switch job.Status {
		case "staging":
			transitionErr = w.finishStaging(leaseCtx, job, workerID, leaseToken, processErr)
		case "persistence_processing", "persistence_pending":
			if processErr == nil {
				if result == nil {
					transitionErr = errors.New("image job processor returned no result")
					break
				}
				if err := leaseCtx.Err(); err != nil {
					transitionErr = err
					break
				}
				if err := w.jobs.MarkCompleted(leaseCtx, job.ID, workerID, leaseToken, result.Manifest, result.Response); err != nil {
					transitionErr = err
					break
				}
				w.cleanupAfterCompletion(result.Manifest)
			} else {
				transitionErr = w.handlePersistenceFailure(leaseCtx, job, workerID, leaseToken, processErr)
			}
		case "refund_pending":
			transitionErr = w.handleCompensation(leaseCtx, job, workerID, leaseToken, processErr)
		default:
			// ClaimNext should only return active states. Treat an unexpected
			// terminal state as a no-op so a stale schema row cannot be mutated.
			transitionErr = processErr
		}
	}

	// Stop renewal only after all lease-fenced work has completed. This also
	// prevents a slow refund from running without a valid lease.
	stopHeartbeat()
	<-heartbeatDone
	leaseErr := heartbeatErr()
	if ctx.Err() != nil || leaseErr != nil || errors.Is(processErr, repository.ErrJobLeaseLost) {
		return true, nil
	}
	if transitionErr != nil {
		if errors.Is(transitionErr, repository.ErrJobLeaseLost) || errors.Is(transitionErr, context.Canceled) || errors.Is(transitionErr, context.DeadlineExceeded) {
			return true, nil
		}
		return true, transitionErr
	}
	return true, nil
}

// Run polls until cancellation. A canceled application context is a normal
// shutdown and returns nil; transient claim/process errors are logged and the
// next poll can recover the lease after its expiry.
func (w *ImageJobWorker) Run(ctx context.Context) error {
	if w == nil {
		return errors.New("image job worker is not configured")
	}
	for {
		if ctx.Err() != nil {
			return nil
		}
		processed, err := w.RunOnce(ctx)
		if err != nil && w.logger != nil {
			w.logger.Printf("[image-job] worker run failed: %v", err)
		}
		if ctx.Err() != nil {
			return nil
		}
		wait := w.options.PollInterval
		if processed && err == nil {
			// Yield briefly after a claimed job, then drain another ready job.
			wait = time.Millisecond
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil
		case <-timer.C:
		}
	}
}

func (w *ImageJobWorker) startHeartbeat(
	ctx context.Context,
	cancel context.CancelFunc,
	jobID, workerID, leaseToken string,
) (func() error, <-chan struct{}, func()) {
	var mu sync.Mutex
	var firstErr error
	controlledStop := false
	done := make(chan struct{})
	recordErr := func(err error) {
		if err == nil {
			return
		}
		mu.Lock()
		if firstErr == nil {
			firstErr = err
		}
		mu.Unlock()
	}
	getErr := func() error {
		mu.Lock()
		defer mu.Unlock()
		return firstErr
	}
	stop := func() {
		mu.Lock()
		controlledStop = true
		mu.Unlock()
		cancel()
	}
	go func() {
		defer close(done)
		ticker := time.NewTicker(w.options.HeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				err := w.jobs.RenewLease(ctx, jobID, workerID, leaseToken, w.options.LeaseDuration)
				if err != nil {
					mu.Lock()
					stopping := controlledStop
					mu.Unlock()
					// A renewal call can be in flight when normal processing
					// finishes. Cancellation requested by the owner (or by the
					// parent application context) is not lease loss.
					if stopping || (ctx.Err() != nil && errors.Is(err, context.Canceled)) {
						return
					}
					recordErr(err)
					cancel()
					return
				}
			}
		}
	}()
	return getErr, done, stop
}

func (w *ImageJobWorker) processClaimedJob(
	ctx context.Context,
	job *repository.ImageGenerationJob,
	workerID, leaseToken string,
) (*ImageJobProcessResult, error) {
	switch job.Status {
	case "persistence_processing", "persistence_pending":
		if w.processor == nil {
			return nil, errors.New("image job processor is not configured")
		}
		return w.processor.Process(ctx, job, workerID, leaseToken)
	case "staging":
		return nil, w.validateAbandonedStaging(job)
	case "refund_pending":
		return nil, nil
	default:
		return nil, nil
	}
}

func (w *ImageJobWorker) validateAbandonedStaging(job *repository.ImageGenerationJob) error {
	manifest, err := decodeJobManifest(job.ResultManifest)
	if err != nil {
		return fmt.Errorf("decode abandoned staging manifest: %w", err)
	}
	if len(manifest.Images) == 0 {
		return errors.New("abandoned staging manifest has no images")
	}
	for _, image := range manifest.Images {
		if image.Phase != imageJobPhaseStaged && image.Phase != imageJobPhaseStored && image.Phase != imageJobPhaseHistorySaved {
			return errors.New("abandoned staging manifest is incomplete")
		}
	}
	return nil
}

func (w *ImageJobWorker) finishStaging(ctx context.Context, job *repository.ImageGenerationJob, workerID, leaseToken string, processErr error) error {
	manifest, decodeErr := decodeJobManifest(job.ResultManifest)
	if decodeErr == nil && processErr == nil {
		if err := ctx.Err(); err != nil {
			return nil
		}
		if err := w.jobs.Activate(ctx, job.ID, workerID, leaseToken); err != nil {
			if errors.Is(err, repository.ErrJobLeaseLost) {
				return nil
			}
			return err
		}
		return nil
	}
	code, detail := "staging_abandoned", errorDetail(processErr, decodeErr)
	if err := ctx.Err(); err != nil {
		return nil
	}
	if err := w.jobs.QueueCompensation(ctx, job.ID, workerID, leaseToken, job.ResultManifest, code, detail); err != nil {
		if errors.Is(err, repository.ErrJobLeaseLost) {
			return nil
		}
		return err
	}
	_ = manifest
	return nil
}

func (w *ImageJobWorker) handlePersistenceFailure(ctx context.Context, job *repository.ImageGenerationJob, workerID, leaseToken string, processErr error) error {
	if ctx.Err() != nil || errors.Is(processErr, context.Canceled) || errors.Is(processErr, repository.ErrJobLeaseLost) {
		return nil
	}
	code, detail := "persistence_failed", errorDetail(processErr, nil)
	if job.RetryCount < job.MaxAttempts {
		next := time.Now().Add(imageJobRetryDelay(job.RetryCount))
		if err := w.jobs.SchedulePersistenceRetry(ctx, job.ID, workerID, leaseToken, next, code, detail); err != nil {
			if errors.Is(err, repository.ErrJobLeaseLost) {
				return nil
			}
			return err
		}
		return nil
	}
	if err := w.jobs.QueueCompensation(ctx, job.ID, workerID, leaseToken, job.ResultManifest, code, detail); err != nil {
		if errors.Is(err, repository.ErrJobLeaseLost) {
			return nil
		}
		return err
	}
	return nil
}

func (w *ImageJobWorker) handleCompensation(ctx context.Context, job *repository.ImageGenerationJob, workerID, leaseToken string, processErr error) error {
	if ctx.Err() != nil || errors.Is(processErr, context.Canceled) || errors.Is(processErr, repository.ErrJobLeaseLost) {
		return nil
	}
	refundedTotal := job.RefundedAmount
	remaining := job.ReservedAmount - job.RefundedAmount
	if remaining < 0 {
		remaining = 0
	}
	if remaining > 0 {
		userID := pointerValue(job.UserID)
		transactionID := pointerValue(job.CreditTransactionID)
		if w.credit == nil || userID == "" || transactionID == "" {
			return w.scheduleCompensationRetry(ctx, job, workerID, leaseToken, "refund_unavailable", "credit refund identity is incomplete")
		}
		if _, err := w.credit.RefundCredits(ctx, userID, transactionID, remaining, "image_persistence_failed"); err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, repository.ErrJobLeaseLost) || ctx.Err() != nil {
				return nil
			}
			return w.scheduleCompensationRetry(ctx, job, workerID, leaseToken, "refund_failed", err.Error())
		}
		if ctx.Err() != nil {
			return nil
		}
		if err := w.jobs.RecordRefund(ctx, job.ID, workerID, leaseToken, remaining); err != nil {
			if errors.Is(err, repository.ErrJobLeaseLost) || ctx.Err() != nil {
				return nil
			}
			return w.scheduleCompensationRetry(ctx, job, workerID, leaseToken, "refund_record_failed", err.Error())
		}
		refundedTotal += remaining
		job.RefundedAmount = refundedTotal
	}

	if key := pointerValue(job.IdempotencyKey); key != "" {
		userID := pointerValue(job.UserID)
		if w.processor == nil || w.processor.idempotency == nil || userID == "" {
			return w.scheduleCompensationRetry(ctx, job, workerID, leaseToken, "idempotency_fail_unavailable", "idempotency failure identity is incomplete")
		}
		if err := w.processor.idempotency.Fail(ctx, userID, key, "image_generate"); err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, repository.ErrJobLeaseLost) || ctx.Err() != nil {
				return nil
			}
			return w.scheduleCompensationRetry(ctx, job, workerID, leaseToken, "idempotency_fail_failed", err.Error())
		}
	}

	if ctx.Err() != nil {
		return nil
	}
	var terminalErr error
	if refundedTotal > 0 {
		terminalErr = w.jobs.MarkRefunded(ctx, job.ID, workerID, leaseToken, refundedTotal)
	} else {
		terminalErr = w.jobs.MarkFailed(ctx, job.ID, workerID, leaseToken, "image_persistence_failed", "no credit refund required")
	}
	if terminalErr != nil {
		if errors.Is(terminalErr, repository.ErrJobLeaseLost) {
			return nil
		}
		return terminalErr
	}
	manifest, err := decodeJobManifest(job.ResultManifest)
	if err == nil {
		w.cleanupAfterCompensation(manifest)
	}
	return nil
}

func (w *ImageJobWorker) scheduleCompensationRetry(ctx context.Context, job *repository.ImageGenerationJob, workerID, leaseToken, code, detail string) error {
	if ctx.Err() != nil {
		return nil
	}
	next := time.Now().Add(imageJobRetryDelay(job.RetryCount))
	if err := w.jobs.ScheduleCompensationRetry(ctx, job.ID, workerID, leaseToken, next, code, detail); err != nil {
		if errors.Is(err, repository.ErrJobLeaseLost) {
			return nil
		}
		return err
	}
	return nil
}

func (w *ImageJobWorker) cleanupAfterCompletion(manifestJSON json.RawMessage) {
	manifest, err := decodeJobManifest(manifestJSON)
	if err != nil || w.processor == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	w.processor.cleanupStagingObjects(ctx, manifest)
}

func (w *ImageJobWorker) cleanupAfterCompensation(manifest imageJobManifest) {
	if w.processor == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	w.processor.cleanupCompensation(ctx, manifest)
}

func decodeJobManifest(body json.RawMessage) (imageJobManifest, error) {
	if len(body) == 0 {
		return imageJobManifest{}, errors.New("image generation job manifest is empty")
	}
	var manifest imageJobManifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return imageJobManifest{}, err
	}
	return manifest, nil
}

func errorDetail(primary, fallback error) string {
	if primary != nil {
		return primary.Error()
	}
	if fallback != nil {
		return fallback.Error()
	}
	return "image job processing failed"
}

func imageJobRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := time.Second
	for i := 1; i < attempt && delay < maxImageJobRetryDelay; i++ {
		delay *= 2
	}
	if delay > maxImageJobRetryDelay {
		return maxImageJobRetryDelay
	}
	return delay
}
