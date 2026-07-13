package orchestrator

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"go-gateway/internal/repository"
	"go-gateway/internal/service"
)

type workerCreditService struct {
	refundErr   error
	refundCalls int
	refundAmt   float64
}

func (s *workerCreditService) ReserveCredits(context.Context, string, int) (string, float64, float64, float64, error) {
	return "", 0, 0, 0, errors.New("not used")
}
func (s *workerCreditService) RefundCredits(_ context.Context, _ string, _ string, amount float64, _ string) (float64, error) {
	s.refundCalls++
	s.refundAmt += amount
	if s.refundErr != nil {
		return 0, s.refundErr
	}
	return 10, nil
}
func (s *workerCreditService) GetCreditCost(context.Context, int) (float64, float64) { return 1, 1 }

func workerJob(t *testing.T, status string, manifest imageJobManifest) *repository.ImageGenerationJob {
	t.Helper()
	body, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	userID := "user-1"
	idem := "idem-1"
	tx := "tx-1"
	lease := "lease-1"
	return &repository.ImageGenerationJob{
		ID:                  "job-1",
		GenerationBatchID:   manifest.Metadata.BatchID,
		RequestID:           "request-1",
		Status:              status,
		UserID:              &userID,
		IdempotencyKey:      &idem,
		CreditTransactionID: &tx,
		ReservedAmount:      1,
		RequestedCount:      len(manifest.Images),
		ReturnedCount:       len(manifest.Images),
		RetryCount:          1,
		MaxAttempts:         3,
		ResultManifest:      body,
		LeaseToken:          &lease,
		LockedBy:            strPtr("worker-1"),
	}
}

func newWorkerForTest(jobs *processorJobStore, storage StorageService, credit CreditService, idem IdempotencyService, options ImageJobWorkerOptions) *ImageJobWorker {
	processor := NewImageJobProcessor(storage, idem, jobs, ImageJobProcessorOptions{LeaseDuration: options.LeaseDuration})
	return NewImageJobWorker(jobs, processor, credit, options)
}

func TestImageJobWorkerRunOnceReturnsFalseWhenNoJob(t *testing.T) {
	jobs := &processorJobStore{}
	manifest, _ := stagedManifest()
	worker := newWorkerForTest(jobs, &processorStorage{}, &workerCreditService{}, &processorIdempotency{}, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     time.Second,
		HeartbeatInterval: time.Hour,
		JobTimeout:        time.Second,
	})
	processed, err := worker.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if processed {
		t.Fatal("RunOnce() = true, want false when no job is claimed")
	}
	_ = manifest
}

func TestImageJobWorkerSchedulesRetryBeforeMaxAttempts(t *testing.T) {
	manifest, _ := stagedManifest()
	storage := &processorStorage{downloadErr: errors.New("temporary storage outage")}
	jobs := &processorJobStore{claimJobs: []*repository.ImageGenerationJob{workerJob(t, "persistence_processing", manifest)}}
	worker := newWorkerForTest(jobs, storage, &workerCreditService{}, &processorIdempotency{}, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     time.Second,
		HeartbeatInterval: time.Hour,
		JobTimeout:        time.Second,
	})
	processed, err := worker.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if !processed {
		t.Fatal("RunOnce() = false, want claimed job")
	}
	if len(jobs.retryCalls) != 1 {
		t.Fatalf("persistence retries = %d, want 1", len(jobs.retryCalls))
	}
	if len(jobs.compensationCalls) != 0 {
		t.Fatalf("unexpected compensation calls: %#v", jobs.compensationCalls)
	}
}

func TestImageJobWorkerMovesRefundFailureToRefundPending(t *testing.T) {
	manifest, _ := stagedManifest()
	jobs := &processorJobStore{claimJobs: []*repository.ImageGenerationJob{workerJob(t, "refund_pending", manifest)}}
	credit := &workerCreditService{refundErr: errors.New("credit service unavailable")}
	worker := newWorkerForTest(jobs, &processorStorage{}, credit, &processorIdempotency{}, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     time.Second,
		HeartbeatInterval: time.Hour,
		JobTimeout:        time.Second,
	})
	processed, err := worker.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if !processed || credit.refundCalls != 1 {
		t.Fatalf("processed=%v refundCalls=%d", processed, credit.refundCalls)
	}
	if len(jobs.refundRetryCalls) != 1 {
		t.Fatalf("refund retries = %d, want 1", len(jobs.refundRetryCalls))
	}
	if len(jobs.refundedCalls) != 0 || len(jobs.failedCalls) != 0 {
		t.Fatalf("refund failure reached terminal state: refunded=%#v failed=%#v", jobs.refundedCalls, jobs.failedCalls)
	}
}

func TestImageJobWorkerRetriesRefundPendingUntilRefunded(t *testing.T) {
	manifest, _ := stagedManifest()
	jobs := &processorJobStore{claimJobs: []*repository.ImageGenerationJob{workerJob(t, "refund_pending", manifest)}}
	credit := &workerCreditService{}
	idem := &processorIdempotency{}
	storage := &processorStorage{}
	worker := newWorkerForTest(jobs, storage, credit, idem, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     time.Second,
		HeartbeatInterval: time.Hour,
		JobTimeout:        time.Second,
	})
	processed, err := worker.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if !processed || len(jobs.refundedCalls) != 1 {
		t.Fatalf("processed=%v refunded=%#v", processed, jobs.refundedCalls)
	}
	if len(jobs.recordedRefunds) != 1 || jobs.recordedRefunds[0] != 1 {
		t.Fatalf("recorded refunds = %#v, want [1]", jobs.recordedRefunds)
	}
	if idem.fail != 1 {
		t.Fatalf("idempotency Fail calls = %d, want 1", idem.fail)
	}
	if len(storage.deleted) != 1 || len(storage.objects) == 0 {
		t.Fatalf("expected anonymous/history and object cleanup, deleted=%#v objects=%#v", storage.deleted, storage.objects)
	}
}

func TestImageJobWorkerDoesNotRepeatRecordedRefundWhenIdempotencyRetryFails(t *testing.T) {
	manifest, _ := stagedManifest()
	job := workerJob(t, "refund_pending", manifest)
	jobs := &processorJobStore{claimJobs: []*repository.ImageGenerationJob{job}}
	credit := &workerCreditService{}
	idem := &processorIdempotency{failErr: errors.New("idempotency unavailable")}
	worker := newWorkerForTest(jobs, &processorStorage{}, credit, idem, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     time.Second,
		HeartbeatInterval: time.Hour,
		JobTimeout:        time.Second,
	})

	if _, err := worker.RunOnce(context.Background()); err != nil {
		t.Fatalf("first RunOnce() error = %v", err)
	}
	if credit.refundCalls != 1 || len(jobs.recordedRefunds) != 1 || len(jobs.refundRetryCalls) != 1 {
		t.Fatalf("first attempt refund state: calls=%d recorded=%#v retries=%#v", credit.refundCalls, jobs.recordedRefunds, jobs.refundRetryCalls)
	}

	idem.failErr = nil
	jobs.mu.Lock()
	jobs.claimJobs = append(jobs.claimJobs, job)
	jobs.mu.Unlock()
	if _, err := worker.RunOnce(context.Background()); err != nil {
		t.Fatalf("second RunOnce() error = %v", err)
	}
	if credit.refundCalls != 1 {
		t.Fatalf("recorded refund was repeated: calls=%d", credit.refundCalls)
	}
	if len(jobs.refundedCalls) != 1 || jobs.refundedCalls[0].amount != 1 {
		t.Fatalf("terminal refund state = %#v, want one refunded amount", jobs.refundedCalls)
	}
}

func TestImageJobWorkerCompensationDeletesPermanentPathsAfterHistoryDelete(t *testing.T) {
	manifest, _ := stagedManifest()
	manifest.Images[0].Phase = imageJobPhaseHistorySaved
	manifest.Images[0].Result.StoragePath = "generated/img-1.png"
	manifest.Images[0].Result.PreviewPath = "generated/img-1.preview.webp"
	manifest.Images[0].Result.ThumbnailPath = "generated/img-1.thumb.webp"
	jobs := &processorJobStore{claimJobs: []*repository.ImageGenerationJob{workerJob(t, "refund_pending", manifest)}}
	storage := &processorStorage{}
	worker := newWorkerForTest(jobs, storage, &workerCreditService{}, &processorIdempotency{}, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     time.Second,
		HeartbeatInterval: time.Hour,
		JobTimeout:        time.Second,
	})
	if _, err := worker.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if len(storage.deleted) != 1 || storage.deleted[0] != "img-1" {
		t.Fatalf("history cleanup = %#v", storage.deleted)
	}
	for _, want := range []string{"staging/image-jobs/batch-1/img-1.source", "generated/img-1.png", "generated/img-1.preview.webp", "generated/img-1.thumb.webp"} {
		found := false
		for _, got := range storage.objects {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("cleanup objects = %#v, missing %q", storage.objects, want)
		}
	}
}

func TestImageJobWorkerCancelsProcessingWhenLeaseRenewalFails(t *testing.T) {
	manifest, _ := stagedManifest()
	entered := make(chan struct{})
	storage := &processorStorage{}
	// Block the external download until the heartbeat reports lease loss.
	storage.downloadErr = nil
	storageWithBlockingDownload := &blockingProcessorStorage{processorStorage: storage, entered: entered}
	jobs := &processorJobStore{
		claimJobs: []*repository.ImageGenerationJob{workerJob(t, "persistence_processing", manifest)},
		leaseLost: repository.ErrJobLeaseLost,
	}
	worker := newWorkerForTest(jobs, storageWithBlockingDownload, &workerCreditService{}, &processorIdempotency{}, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     40 * time.Millisecond,
		HeartbeatInterval: 5 * time.Millisecond,
		JobTimeout:        time.Second,
	})
	done := make(chan error, 1)
	go func() {
		_, err := worker.RunOnce(context.Background())
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("processor did not begin external work")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("RunOnce() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("RunOnce() did not stop after lease loss")
	}
	if len(jobs.retryCalls) != 0 || len(jobs.compensationCalls) != 0 || len(jobs.completedCalls) != 0 {
		t.Fatalf("stale worker performed fenced transitions: retry=%#v compensation=%#v complete=%#v", jobs.retryCalls, jobs.compensationCalls, jobs.completedCalls)
	}
}

type blockingWorkerCreditService struct {
	entered chan struct{}
	once    sync.Once
}

func (s *blockingWorkerCreditService) ReserveCredits(context.Context, string, int) (string, float64, float64, float64, error) {
	return "", 0, 0, 0, errors.New("not used")
}

func (s *blockingWorkerCreditService) RefundCredits(ctx context.Context, _ string, _ string, _ float64, _ string) (float64, error) {
	if s.entered != nil {
		s.once.Do(func() { close(s.entered) })
	}
	<-ctx.Done()
	return 0, ctx.Err()
}

func (s *blockingWorkerCreditService) GetCreditCost(context.Context, int) (float64, float64) {
	return 1, 1
}

func TestImageJobWorkerCancelsSlowRefundWhenLeaseIsLost(t *testing.T) {
	manifest, _ := stagedManifest()
	jobs := &processorJobStore{
		claimJobs: []*repository.ImageGenerationJob{workerJob(t, "refund_pending", manifest)},
		leaseLost: repository.ErrJobLeaseLost,
	}
	credit := &blockingWorkerCreditService{entered: make(chan struct{})}
	worker := newWorkerForTest(jobs, &processorStorage{}, credit, &processorIdempotency{}, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     40 * time.Millisecond,
		HeartbeatInterval: 5 * time.Millisecond,
		JobTimeout:        time.Second,
	})

	done := make(chan error, 1)
	go func() {
		_, err := worker.RunOnce(context.Background())
		done <- err
	}()
	select {
	case <-credit.entered:
	case <-time.After(time.Second):
		t.Fatal("refund did not begin")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("RunOnce() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("RunOnce() did not stop after refund lease loss")
	}
	if len(jobs.refundRetryCalls) != 0 || len(jobs.refundedCalls) != 0 || len(jobs.failedCalls) != 0 {
		t.Fatalf("stale worker performed compensation transition: retry=%#v refunded=%#v failed=%#v", jobs.refundRetryCalls, jobs.refundedCalls, jobs.failedCalls)
	}
}

func TestImageJobWorkerIgnoresControlledHeartbeatCancellation(t *testing.T) {
	manifest, data := stagedManifest()
	jobs := &processorJobStore{
		claimJobs:    []*repository.ImageGenerationJob{workerJob(t, "persistence_processing", manifest)},
		renewBlock:   true,
		renewStarted: make(chan struct{}),
	}
	storage := &processorStorage{
		downloaded: &service.DownloadedImage{Data: data, Mime: "image/png"},
		stored: &service.StoredImage{
			PublicURL: "https://cdn.example/img-1.png", StoragePath: "generated/img-1.png",
			PreviewPath: "generated/img-1.preview.webp", ThumbnailPath: "generated/img-1.thumb.webp",
		},
	}
	worker := newWorkerForTest(jobs, storage, &workerCreditService{}, &processorIdempotency{}, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     100 * time.Millisecond,
		HeartbeatInterval: time.Millisecond,
		JobTimeout:        time.Second,
	})
	type runResult struct {
		processed bool
		err       error
	}
	done := make(chan runResult, 1)
	go func() {
		processed, err := worker.RunOnce(context.Background())
		done <- runResult{processed: processed, err: err}
	}()
	select {
	case <-jobs.renewStarted:
	case <-time.After(time.Second):
		t.Fatal("heartbeat renewal did not start")
	}
	result := <-done
	processed, err := result.processed, result.err
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if !processed || len(jobs.completedCalls) != 1 {
		t.Fatalf("processed=%v completed=%#v, want one completion", processed, jobs.completedCalls)
	}
	if len(jobs.retryCalls) != 0 || len(jobs.compensationCalls) != 0 {
		t.Fatalf("controlled heartbeat stop triggered retry/compensation: retry=%#v compensation=%#v", jobs.retryCalls, jobs.compensationCalls)
	}
}

type blockingProcessorStorage struct {
	*processorStorage
	entered chan struct{}
}

func (s *blockingProcessorStorage) DownloadImage(ctx context.Context, path string) (*service.DownloadedImage, error) {
	select {
	case s.entered <- struct{}{}:
	default:
	}
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestImageJobWorkerDoesNothingTerminalAfterContextCancellation(t *testing.T) {
	manifest, _ := stagedManifest()
	jobs := &processorJobStore{claimJobs: []*repository.ImageGenerationJob{workerJob(t, "refund_pending", manifest)}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	worker := newWorkerForTest(jobs, &processorStorage{}, &workerCreditService{}, &processorIdempotency{}, ImageJobWorkerOptions{
		WorkerID:          "worker-1",
		LeaseDuration:     time.Second,
		HeartbeatInterval: time.Hour,
		JobTimeout:        time.Second,
	})
	processed, err := worker.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if processed {
		t.Fatal("RunOnce() = true for canceled context")
	}
	if len(jobs.refundedCalls) != 0 || len(jobs.failedCalls) != 0 || len(jobs.refundRetryCalls) != 0 {
		t.Fatal("canceled worker performed terminal work")
	}
}
