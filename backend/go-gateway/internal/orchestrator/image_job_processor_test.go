package orchestrator

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"go-gateway/internal/repository"
	"go-gateway/internal/service"
)

type processorJobStore struct {
	mu                 sync.Mutex
	manifests          []json.RawMessage
	saveErr            error
	saveErrAt          int
	renewErr           error
	renewBlock         bool
	renewStarted       chan struct{}
	renewStartOnce     sync.Once
	claimJobs          []*repository.ImageGenerationJob
	claimErr           error
	retryCalls         []retryCall
	compensationCalls  []compensationCall
	refundRetryCalls   []retryCall
	completedCalls     []completedCall
	failedCalls        []terminalCall
	refundedCalls      []refundedCall
	recordedRefunds    []float64
	recordRefundErr    error
	activateCalls      int
	queueCompensation  error
	markCompletedError error
	leaseLost          error
}

type retryCall struct {
	jobID, workerID, leaseToken, code, detail string
	next                                      time.Time
}

type compensationCall struct {
	jobID, ownerID, leaseToken, code, detail string
}

type completedCall struct {
	jobID, workerID, leaseToken string
	manifest, response          json.RawMessage
}

type terminalCall struct {
	jobID, workerID, leaseToken, code, detail string
}

type refundedCall struct {
	jobID, workerID, leaseToken string
	amount                      float64
}

func (s *processorJobStore) CreateStaging(context.Context, repository.CreateImageGenerationJob) (*repository.ImageGenerationJob, error) {
	return nil, errors.New("not used")
}

func (s *processorJobStore) SaveStagingManifest(context.Context, string, string, string, json.RawMessage, time.Duration) error {
	return errors.New("not used")
}

func (s *processorJobStore) Activate(context.Context, string, string, string) error {
	s.mu.Lock()
	s.activateCalls++
	s.mu.Unlock()
	return nil
}

func (s *processorJobStore) QueueCompensation(_ context.Context, jobID, ownerID, leaseToken string, manifest json.RawMessage, code, detail string) error {
	s.mu.Lock()
	s.compensationCalls = append(s.compensationCalls, compensationCall{jobID: jobID, ownerID: ownerID, leaseToken: leaseToken, code: code, detail: detail})
	err := s.queueCompensation
	s.mu.Unlock()
	return err
}

func (s *processorJobStore) ClaimNext(context.Context, string, time.Duration) (*repository.ImageGenerationJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.claimErr != nil {
		return nil, s.claimErr
	}
	if len(s.claimJobs) == 0 {
		return nil, nil
	}
	job := s.claimJobs[0]
	s.claimJobs = s.claimJobs[1:]
	return job, nil
}

func (s *processorJobStore) RenewLease(ctx context.Context, jobID, workerID, leaseToken string, _ time.Duration) error {
	s.mu.Lock()
	err := s.renewErr
	if s.leaseLost != nil {
		err = s.leaseLost
	}
	block := s.renewBlock
	started := s.renewStarted
	s.mu.Unlock()
	if block {
		if started != nil {
			s.renewStartOnce.Do(func() { close(started) })
		}
		<-ctx.Done()
		return ctx.Err()
	}
	if err != nil {
		return err
	}
	if jobID == "" || workerID == "" || leaseToken == "" {
		return errors.New("missing lease identity")
	}
	return nil
}

func (s *processorJobStore) SaveProcessingManifest(_ context.Context, _ string, _ string, _ string, manifest json.RawMessage, _ time.Duration) error {
	var waitForRenew <-chan struct{}
	s.mu.Lock()
	if s.saveErr != nil && (s.saveErrAt <= 0 || len(s.manifests)+1 >= s.saveErrAt) {
		s.mu.Unlock()
		return s.saveErr
	}
	if s.renewBlock && len(s.manifests) == 0 {
		waitForRenew = s.renewStarted
	}
	s.mu.Unlock()
	if waitForRenew != nil {
		<-waitForRenew
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.manifests = append(s.manifests, append(json.RawMessage(nil), manifest...))
	return nil
}

func (s *processorJobStore) SchedulePersistenceRetry(_ context.Context, jobID, workerID, leaseToken string, next time.Time, code, detail string) error {
	s.mu.Lock()
	s.retryCalls = append(s.retryCalls, retryCall{jobID: jobID, workerID: workerID, leaseToken: leaseToken, next: next, code: code, detail: detail})
	s.mu.Unlock()
	return nil
}

func (s *processorJobStore) ScheduleCompensationRetry(_ context.Context, jobID, workerID, leaseToken string, next time.Time, code, detail string) error {
	s.mu.Lock()
	s.refundRetryCalls = append(s.refundRetryCalls, retryCall{jobID: jobID, workerID: workerID, leaseToken: leaseToken, next: next, code: code, detail: detail})
	s.mu.Unlock()
	return nil
}

func (s *processorJobStore) RecordRefund(_ context.Context, _ string, _ string, _ string, amount float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recordedRefunds = append(s.recordedRefunds, amount)
	return s.recordRefundErr
}

func (s *processorJobStore) MarkCompleted(_ context.Context, jobID, workerID, leaseToken string, manifest, response json.RawMessage) error {
	s.mu.Lock()
	s.completedCalls = append(s.completedCalls, completedCall{jobID: jobID, workerID: workerID, leaseToken: leaseToken, manifest: append(json.RawMessage(nil), manifest...), response: append(json.RawMessage(nil), response...)})
	err := s.markCompletedError
	s.mu.Unlock()
	return err
}

func (s *processorJobStore) MarkFailed(_ context.Context, jobID, workerID, leaseToken, code, detail string) error {
	s.mu.Lock()
	s.failedCalls = append(s.failedCalls, terminalCall{jobID: jobID, workerID: workerID, leaseToken: leaseToken, code: code, detail: detail})
	s.mu.Unlock()
	return nil
}

func (s *processorJobStore) MarkRefunded(_ context.Context, jobID, workerID, leaseToken string, amount float64) error {
	s.mu.Lock()
	s.refundedCalls = append(s.refundedCalls, refundedCall{jobID: jobID, workerID: workerID, leaseToken: leaseToken, amount: amount})
	s.mu.Unlock()
	return nil
}

type processorStorage struct {
	downloaded  *service.DownloadedImage
	downloadErr error
	stored      *service.StoredImage
	storeErr    error
	history     []service.ImageHistoryItem
	historyErr  error
	deleted     []string
	objects     []string
	deleteErr   error
	mu          sync.Mutex
}

func (s *processorStorage) StoreFromURL(context.Context, string, string) (*service.StoredImage, error) {
	return nil, errors.New("unexpected URL store")
}
func (s *processorStorage) StoreFromBuffer(context.Context, []byte, string, string) (*service.StoredImage, error) {
	return nil, errors.New("unexpected buffer store")
}
func (s *processorStorage) StoreFromBufferAtPath(_ context.Context, _ []byte, _ string, _ string) (*service.StoredImage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.storeErr != nil {
		return nil, s.storeErr
	}
	return s.stored, nil
}
func (s *processorStorage) StageFromURL(context.Context, string, string) (*service.StagedImage, error) {
	return nil, errors.New("unexpected URL stage")
}
func (s *processorStorage) StageFromBuffer(context.Context, []byte, string, string) (*service.StagedImage, error) {
	return nil, errors.New("unexpected buffer stage")
}
func (s *processorStorage) DeleteObjects(_ context.Context, paths ...string) error {
	s.mu.Lock()
	s.objects = append(s.objects, paths...)
	err := s.deleteErr
	s.mu.Unlock()
	return err
}
func (s *processorStorage) DeleteImageHistoryByID(_ context.Context, id string) error {
	s.mu.Lock()
	s.deleted = append(s.deleted, id)
	err := s.deleteErr
	s.mu.Unlock()
	return err
}
func (s *processorStorage) DownloadImage(_ context.Context, _ string) (*service.DownloadedImage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.downloadErr != nil {
		return nil, s.downloadErr
	}
	return s.downloaded, nil
}
func (s *processorStorage) SaveImageHistory(_ context.Context, item *service.ImageHistoryItem, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.historyErr != nil {
		return s.historyErr
	}
	if item != nil {
		s.history = append(s.history, *item)
	}
	return nil
}
func (s *processorStorage) ListImageHistory(context.Context, string, string, int, int) (*service.ImageHistory, error) {
	return &service.ImageHistory{}, nil
}
func (s *processorStorage) GetImageHistory(context.Context, string, string, string) (*service.ImageHistoryItem, error) {
	return nil, nil
}
func (s *processorStorage) GetImageVisibilityByPath(context.Context, string) (string, string, error) {
	return "", "", nil
}
func (s *processorStorage) DeleteImageHistory(context.Context, string, string) (bool, error) {
	return true, nil
}
func (s *processorStorage) ClearImageHistory(context.Context, string) (int64, error) { return 0, nil }
func (s *processorStorage) CleanupObjects(paths ...string) {
	s.mu.Lock()
	s.objects = append(s.objects, paths...)
	s.mu.Unlock()
}

type processorIdempotency struct {
	completeErr error
	failErr     error
	complete    int
	fail        int
	lastBody    any
	mu          sync.Mutex
}

func (s *processorIdempotency) Acquire(context.Context, string, string, string, []byte) (*service.IdempotencyOutcome, error) {
	return &service.IdempotencyOutcome{Proceed: true}, nil
}
func (s *processorIdempotency) Fail(context.Context, string, string, string) error {
	s.mu.Lock()
	s.fail++
	err := s.failErr
	s.mu.Unlock()
	return err
}
func (s *processorIdempotency) Complete(_ context.Context, _ string, _ string, _ string, _ int16, body any, _ string) error {
	s.mu.Lock()
	s.complete++
	s.lastBody = body
	err := s.completeErr
	s.mu.Unlock()
	return err
}

func processorLeaseToken(job *repository.ImageGenerationJob) string {
	if job == nil || job.LeaseToken == nil {
		return "lease-1"
	}
	return *job.LeaseToken
}

func processorJobWithManifest(t *testing.T, manifest imageJobManifest) *repository.ImageGenerationJob {
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
		Status:              "persistence_processing",
		UserID:              &userID,
		IdempotencyKey:      &idem,
		CreditTransactionID: &tx,
		ReservedAmount:      1,
		RequestedCount:      len(manifest.Images),
		ReturnedCount:       len(manifest.Images),
		MaxAttempts:         3,
		ResultManifest:      body,
		LeaseToken:          &lease,
		LockedBy:            strPtr("worker-1"),
	}
}

func strPtr(value string) *string { return &value }

func stagedManifest() (imageJobManifest, []byte) {
	data := []byte("image-bytes")
	sum := sha256.Sum256(data)
	manifest := imageJobManifest{
		Version: 1,
		Metadata: imageJobMetadata{
			BatchID:             "batch-1",
			UserID:              "user-1",
			DisplayPrompt:       "a prompt",
			ModelPrompt:         "a prompt",
			Size:                "1024x1024",
			Visibility:          "private",
			FundingSource:       "credit",
			CreditCost:          1,
			CreditTransactionID: "tx-1",
			TotalCost:           1,
		},
		Images: []imageJobManifestImage{{
			Result:       ImageResult{ID: "img-1", Prompt: "a prompt", Timestamp: time.Now().UTC().Format(time.RFC3339)},
			StagedPath:   "staging/image-jobs/batch-1/img-1.source",
			StagedMime:   "image/png",
			StagedBytes:  len(data),
			StagedSHA256: hex.EncodeToString(sum[:]),
			Phase:        "staged",
		}},
	}
	return manifest, data
}

func TestImageJobProcessorPersistsStoredAndHistoryPhases(t *testing.T) {
	manifest, data := stagedManifest()
	jobs := &processorJobStore{}
	storage := &processorStorage{
		downloaded: &service.DownloadedImage{Data: data, Mime: "image/png"},
		stored: &service.StoredImage{
			PublicURL: "https://cdn.example/img-1.png", StoragePath: "generated/img-1.png",
			PreviewURL: "https://cdn.example/img-1.preview.webp", PreviewPath: "generated/img-1.preview.webp",
			ThumbnailURL: "https://cdn.example/img-1.thumb.webp", ThumbnailPath: "generated/img-1.thumb.webp",
			Width: 512, Height: 512, Bytes: len(data), Mime: "image/png",
		},
	}
	idem := &processorIdempotency{}
	processor := NewImageJobProcessor(storage, idem, jobs, ImageJobProcessorOptions{LeaseDuration: time.Minute})
	result, err := processor.Process(context.Background(), processorJobWithManifest(t, manifest), "worker-1", "lease-1")
	if err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if result == nil || len(result.Manifest) == 0 || len(result.Response) == 0 {
		t.Fatalf("Process() result = %#v, want manifest and response", result)
	}
	if len(jobs.manifests) != 2 {
		t.Fatalf("manifest writes = %d, want stored and history_saved", len(jobs.manifests))
	}
	var final imageJobManifest
	if err := json.Unmarshal(jobs.manifests[len(jobs.manifests)-1], &final); err != nil {
		t.Fatal(err)
	}
	if got := final.Images[0].Phase; got != "history_saved" {
		t.Fatalf("final phase = %q, want history_saved", got)
	}
	if got := final.Images[0].Result.URL; got != "https://cdn.example/img-1.png" {
		t.Fatalf("permanent URL = %q", got)
	}
	if final.Images[0].Result.TemporaryURL != "" || final.Images[0].Result.DataURL != "" {
		t.Fatal("temporary fields leaked into permanent result")
	}
	if idem.complete != 1 {
		t.Fatalf("Complete calls = %d, want 1", idem.complete)
	}
	if len(storage.history) != 1 || storage.history[0].StoragePath != "generated/img-1.png" {
		t.Fatalf("history = %#v", storage.history)
	}
	var response GenResponse
	if err := json.Unmarshal(result.Response, &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Images) != 1 || response.Images[0].StoragePath != "generated/img-1.png" {
		t.Fatalf("response = %#v", response)
	}
}

func TestImageJobProcessorResumesStoredPhaseWithoutReprocessing(t *testing.T) {
	manifest, _ := stagedManifest()
	manifest.Images[0].Phase = "stored"
	manifest.Images[0].Result.URL = "https://cdn.example/img-1.png"
	manifest.Images[0].Result.StoragePath = "generated/img-1.png"
	manifest.Images[0].Result.PersistenceStatus = "persisted"
	jobs := &processorJobStore{}
	storage := &processorStorage{stored: &service.StoredImage{}}
	idem := &processorIdempotency{}
	processor := NewImageJobProcessor(storage, idem, jobs, ImageJobProcessorOptions{LeaseDuration: time.Minute})
	result, err := processor.Process(context.Background(), processorJobWithManifest(t, manifest), "worker-1", "lease-1")
	if err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if len(jobs.manifests) != 1 {
		t.Fatalf("manifest writes = %d, want one history_saved write", len(jobs.manifests))
	}
	if len(storage.history) != 1 || idem.complete != 1 || result == nil {
		t.Fatalf("resume side effects: history=%d complete=%d result=%#v", len(storage.history), idem.complete, result)
	}
}

func TestImageJobProcessorRejectsStagedChecksumMismatch(t *testing.T) {
	manifest, data := stagedManifest()
	manifest.Images[0].StagedSHA256 = "deadbeef"
	jobs := &processorJobStore{}
	storage := &processorStorage{downloaded: &service.DownloadedImage{Data: data, Mime: "image/png"}}
	idem := &processorIdempotency{}
	processor := NewImageJobProcessor(storage, idem, jobs)
	_, err := processor.Process(context.Background(), processorJobWithManifest(t, manifest), "worker-1", "lease-1")
	if err == nil || !containsErrorText(err, "checksum") {
		t.Fatalf("Process() error = %v, want checksum failure", err)
	}
	if idem.complete != 0 || len(jobs.manifests) != 0 {
		t.Fatalf("checksum failure wrote terminal state: complete=%d manifests=%d", idem.complete, len(jobs.manifests))
	}
}

func TestImageJobProcessorRequiresIdempotencyCompletion(t *testing.T) {
	manifest, data := stagedManifest()
	jobs := &processorJobStore{}
	storage := &processorStorage{
		downloaded: &service.DownloadedImage{Data: data, Mime: "image/png"},
		stored:     &service.StoredImage{PublicURL: "https://cdn.example/img-1.png", StoragePath: "generated/img-1.png"},
	}
	idem := &processorIdempotency{completeErr: errors.New("idempotency unavailable")}
	processor := NewImageJobProcessor(storage, idem, jobs)
	_, err := processor.Process(context.Background(), processorJobWithManifest(t, manifest), "worker-1", "lease-1")
	if err == nil || !containsErrorText(err, "idempotency") {
		t.Fatalf("Process() error = %v, want idempotency failure", err)
	}
	if len(jobs.manifests) != 2 {
		t.Fatalf("expected phase writes before Complete, got %d", len(jobs.manifests))
	}
}

func TestImageJobProcessorSkipsIdempotencyCompletionForAnonymousKey(t *testing.T) {
	manifest, data := stagedManifest()
	manifest.Metadata.UserID = ""
	jobs := &processorJobStore{}
	storage := &processorStorage{
		downloaded: &service.DownloadedImage{Data: data, Mime: "image/png"},
		stored:     &service.StoredImage{PublicURL: "https://cdn.example/img-1.png", StoragePath: "generated/img-1.png"},
	}
	idem := &processorIdempotency{}
	processor := NewImageJobProcessor(storage, idem, jobs)
	job := processorJobWithManifest(t, manifest)
	job.UserID = nil
	anonymousKey := "anonymous-idempotency-key"
	job.IdempotencyKey = &anonymousKey

	result, err := processor.Process(context.Background(), job, "worker-1", "lease-1")
	if err != nil {
		t.Fatalf("Process() error = %v", err)
	}
	if result == nil {
		t.Fatal("Process() returned nil result")
	}
	if idem.complete != 0 {
		t.Fatalf("anonymous job completed authenticated idempotency %d times", idem.complete)
	}
}

func containsErrorText(err error, want string) bool {
	return err != nil && (fmt.Sprint(err) == want || len(err.Error()) >= len(want) && containsFold(err.Error(), want))
}

func containsFold(value, want string) bool {
	for i := 0; i+len(want) <= len(value); i++ {
		if equalFoldASCII(value[i:i+len(want)], want) {
			return true
		}
	}
	return false
}

func equalFoldASCII(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
