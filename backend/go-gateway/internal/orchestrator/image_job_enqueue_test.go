package orchestrator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"go-gateway/internal/middleware"
	"go-gateway/internal/repository"
	"go-gateway/internal/service"
)

type enqueueCallLog struct {
	mu     sync.Mutex
	events []string
}

func (l *enqueueCallLog) add(event string) {
	l.mu.Lock()
	l.events = append(l.events, event)
	l.mu.Unlock()
}

func (l *enqueueCallLog) snapshot() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.events...)
}

type enqueueStorageService struct {
	*testStorageService
	log         *enqueueCallLog
	stageURL    func(context.Context, string, string) (*service.StagedImage, error)
	stageBuffer func(context.Context, []byte, string, string) (*service.StagedImage, error)
}

type enqueueCreditService struct {
	mu           sync.Mutex
	refundCalls  int
	refundAmount float64
}

func (s *enqueueCreditService) ReserveCredits(context.Context, string, int) (string, float64, float64, float64, error) {
	return "tx-enqueue", 99, 1, 1, nil
}

func (s *enqueueCreditService) RefundCredits(_ context.Context, _ string, _ string, amount float64, _ string) (float64, error) {
	s.mu.Lock()
	s.refundCalls++
	s.refundAmount += amount
	s.mu.Unlock()
	return 100, nil
}

func (s *enqueueCreditService) GetCreditCost(_ context.Context, count int) (float64, float64) {
	return 1, float64(count)
}

func (s *enqueueCreditService) refunds() (int, float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.refundCalls, s.refundAmount
}

func (s *testStorageService) StageFromURL(ctx context.Context, sourceURL, storagePath string) (*service.StagedImage, error) {
	return &service.StagedImage{StoragePath: storagePath, Mime: "image/png", Bytes: 10, SHA256: "test-sha"}, nil
}

func (s *testStorageService) StageFromBuffer(ctx context.Context, data []byte, mime, storagePath string) (*service.StagedImage, error) {
	return &service.StagedImage{StoragePath: storagePath, Mime: mime, Bytes: len(data), SHA256: "test-sha"}, nil
}

func (s *testStorageService) DeleteObjects(ctx context.Context, paths ...string) error {
	return nil
}

func (s *testStorageService) DeleteImageHistoryByID(ctx context.Context, id string) error {
	return nil
}

func (s *enqueueStorageService) StageFromURL(ctx context.Context, sourceURL, storagePath string) (*service.StagedImage, error) {
	if s.log != nil {
		s.log.add("stage-url:" + storagePath)
	}
	if s.stageURL != nil {
		return s.stageURL(ctx, sourceURL, storagePath)
	}
	return &service.StagedImage{StoragePath: storagePath, Mime: "image/png", Bytes: 10, SHA256: "url-sha"}, nil
}

func (s *enqueueStorageService) StageFromBuffer(ctx context.Context, data []byte, mime, storagePath string) (*service.StagedImage, error) {
	if s.log != nil {
		s.log.add("stage-buffer:" + storagePath)
	}
	if s.stageBuffer != nil {
		return s.stageBuffer(ctx, data, mime, storagePath)
	}
	return &service.StagedImage{StoragePath: storagePath, Mime: mime, Bytes: len(data), SHA256: "buffer-sha"}, nil
}

func (s *enqueueStorageService) DeleteObjects(ctx context.Context, paths ...string) error {
	return nil
}

func (s *enqueueStorageService) DeleteImageHistoryByID(ctx context.Context, id string) error {
	return nil
}

type enqueueJobStore struct {
	log             *enqueueCallLog
	mu              sync.Mutex
	input           repository.CreateImageGenerationJob
	job             *repository.ImageGenerationJob
	manifests       []json.RawMessage
	compensations   []string
	stagingRefunds  []float64
	createErrs      []error
	createErr       error
	startErrs       []error
	recoveredStart  *repository.ImageGenerationJobStart
	recoverErr      error
	recoverCalls    int
	saveErr         error
	activateErr     error
	queueErr        error
	activateEnter   chan struct{}
	activateRelease <-chan struct{}
	activateOnce    sync.Once
}

func (s *enqueueJobStore) CreateStaging(ctx context.Context, input repository.CreateImageGenerationJob) (*repository.ImageGenerationJob, error) {
	if s.log != nil {
		s.log.add("create")
	}
	s.mu.Lock()
	s.input = input
	s.mu.Unlock()
	if len(s.createErrs) > 0 {
		err := s.createErrs[0]
		s.createErrs = s.createErrs[1:]
		return nil, err
	}
	if s.createErr != nil {
		return nil, s.createErr
	}
	if s.job == nil {
		s.job = &repository.ImageGenerationJob{
			ID:         "job-test-1",
			LeaseToken: enqueueStringPointer("lease-test-1"),
		}
	}
	return s.job, nil
}

func (s *enqueueJobStore) StartWithCredit(ctx context.Context, input repository.StartImageGenerationJobInput) (*repository.ImageGenerationJobStart, error) {
	if s.log != nil {
		s.log.add("start-credit")
	}
	if len(s.startErrs) > 0 {
		err := s.startErrs[0]
		s.startErrs = s.startErrs[1:]
		return nil, err
	}
	job, err := s.CreateStaging(ctx, repository.CreateImageGenerationJob{
		GenerationBatchID:   input.GenerationBatchID,
		RequestID:           input.RequestID,
		UserID:              enqueueStringPointer(input.UserID),
		IdempotencyKey:      enqueueStringPointer(input.IdempotencyKey),
		RequestHash:         enqueueStringPointer(input.RequestHash),
		CreditTransactionID: enqueueStringPointer("tx-atomic-start"),
		ReservedAmount:      input.ReservedAmount,
		RequestedCount:      input.RequestedCount,
		ReturnedCount:       0,
		MaxAttempts:         5,
		ResultManifest:      input.ResultManifest,
		LockOwner:           input.LockOwner,
		LeaseDuration:       input.LeaseDuration,
	})
	if err != nil {
		return nil, err
	}
	return &repository.ImageGenerationJobStart{
		Job:           job,
		Balance:       99,
		TransactionID: "tx-atomic-start",
	}, nil
}

func (s *enqueueJobStore) FindStartByIdentity(
	context.Context,
	string,
	string,
	string,
	string,
) (*repository.ImageGenerationJobStart, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recoverCalls++
	return s.recoveredStart, s.recoverErr
}

func (s *enqueueJobStore) SaveStagingManifest(ctx context.Context, jobID, ownerID, leaseToken string, manifest json.RawMessage, lease time.Duration) error {
	if s.log != nil {
		s.log.add(fmt.Sprintf("save-%d", len(s.manifests)+1))
	}
	s.mu.Lock()
	s.manifests = append(s.manifests, append(json.RawMessage(nil), manifest...))
	s.mu.Unlock()
	return s.saveErr
}

func (s *enqueueJobStore) Activate(ctx context.Context, jobID, ownerID, leaseToken string) error {
	if s.log != nil {
		s.log.add("activate")
	}
	if s.activateEnter != nil {
		s.activateOnce.Do(func() { close(s.activateEnter) })
	}
	if s.activateRelease != nil {
		select {
		case <-s.activateRelease:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return s.activateErr
}

func (s *enqueueJobStore) QueueCompensation(ctx context.Context, jobID, ownerID, leaseToken string, manifest json.RawMessage, code, detail string) error {
	if s.log != nil {
		s.log.add("compensate")
	}
	s.mu.Lock()
	s.compensations = append(s.compensations, strings.Join([]string{jobID, ownerID, leaseToken, string(manifest), code, detail}, "|"))
	s.mu.Unlock()
	return s.queueErr
}

func (s *enqueueJobStore) RecordStagingRefund(ctx context.Context, jobID, ownerID, leaseToken string, amount float64, returnedCount int, lease time.Duration) error {
	if s.log != nil {
		s.log.add("record-partial-refund")
	}
	s.mu.Lock()
	s.stagingRefunds = append(s.stagingRefunds, amount)
	s.mu.Unlock()
	return nil
}

func (s *enqueueJobStore) lastManifest() json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.manifests) == 0 {
		return nil
	}
	return append(json.RawMessage(nil), s.manifests[len(s.manifests)-1]...)
}

func (s *enqueueJobStore) compensationCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.compensations)
}

func (s *enqueueJobStore) recordedStagingRefunds() []float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]float64(nil), s.stagingRefunds...)
}

func enqueueStringPointer(value string) *string {
	return &value
}

func newEnqueueOrchestrator(t *testing.T, storage StorageService, jobs ImageJobEnqueuer, responseBody string) (*ImageOrchestrator, *testIdempotencyService, func()) {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(responseBody))
	}))
	idem := &testIdempotencyService{}
	o := NewImageOrchestrator(&testCreditService{}, storage, idem).
		WithProviderSettings(testProviderSettingsService{cfg: service.ImageProviderConfig{
			BaseURL:    upstream.URL,
			APIKey:     "provider-key",
			ImageModel: "image-model",
			RetryCount: 0,
		}}).
		WithImageJobStore(jobs)
	return o, idem, upstream.Close
}

func TestStartCreditImageJobRecoversCommittedResultAfterAmbiguousErrors(t *testing.T) {
	lease := "lease-recovered"
	recovered := &repository.ImageGenerationJobStart{
		Job: &repository.ImageGenerationJob{
			ID: "job-recovered", GenerationBatchID: "batch-recovered", LeaseToken: &lease,
		},
		Balance:       42,
		TransactionID: "tx-recovered",
	}
	jobs := &enqueueJobStore{
		startErrs:      []error{errors.New("connection reset"), errors.New("connection reset")},
		recoveredStart: recovered,
	}
	idem := &testIdempotencyService{}
	o := NewImageOrchestrator(&testCreditService{}, &testStorageService{}, idem).WithImageJobStore(jobs)

	started, statusErr := o.startCreditImageJob(
		context.Background(),
		imageGenerationMetadata{BatchID: "batch-recovered"},
		&middleware.User{ID: "user-recovered"},
		"idem-recovered",
		[]byte(`{"prompt":"recover"}`),
		"request-recovered",
		1,
		1,
		1,
	)
	if statusErr != nil {
		t.Fatalf("startCreditImageJob() status error = %v", statusErr)
	}
	if started != recovered {
		t.Fatalf("startCreditImageJob() = %#v, want recovered durable start", started)
	}
	if jobs.recoverCalls != 1 {
		t.Fatalf("durable recovery calls = %d, want 1", jobs.recoverCalls)
	}
	if len(idem.fails) != 0 {
		t.Fatalf("committed atomic start released idempotency: %#v", idem.fails)
	}
}

func TestStartCreditImageJobKeepsIdempotencyProcessingWhenRecoveryIsUncertain(t *testing.T) {
	jobs := &enqueueJobStore{
		startErrs:  []error{errors.New("connection reset"), errors.New("connection reset")},
		recoverErr: errors.New("database lookup unavailable"),
	}
	idem := &testIdempotencyService{}
	o := NewImageOrchestrator(&testCreditService{}, &testStorageService{}, idem).WithImageJobStore(jobs)

	started, statusErr := o.startCreditImageJob(
		context.Background(),
		imageGenerationMetadata{BatchID: "batch-uncertain"},
		&middleware.User{ID: "user-uncertain"},
		"idem-uncertain",
		[]byte(`{"prompt":"uncertain"}`),
		"request-uncertain",
		1,
		1,
		1,
	)
	if started != nil || statusErr == nil || statusErr.Code != http.StatusServiceUnavailable {
		t.Fatalf("startCreditImageJob() = %#v, %#v; want temporary unavailable", started, statusErr)
	}
	if jobs.recoverCalls != 1 {
		t.Fatalf("durable recovery calls = %d, want 1", jobs.recoverCalls)
	}
	if len(idem.fails) != 0 {
		t.Fatalf("uncertain atomic start released idempotency: %#v", idem.fails)
	}
}

func enqueueParams(count int) GenerateParams {
	return GenerateParams{
		User:      &middleware.User{ID: "user_enqueue"},
		RawBody:   []byte(`{"prompt":"enqueue test"}`),
		IdemKey:   "idem-enqueue-test",
		RequestID: "request-enqueue-test",
		Request:   GenRequest{Prompt: "enqueue test", Count: count},
	}
}

func TestGenerateCreatesStagingJobBeforeUploadingSources(t *testing.T) {
	log := &enqueueCallLog{}
	storage := &enqueueStorageService{testStorageService: &testStorageService{}, log: log}
	jobs := &enqueueJobStore{log: log}
	o, idem, closeUpstream := newEnqueueOrchestrator(t, storage, jobs, `{"data":[{"url":"https://provider.example/one.png"},{"url":"https://provider.example/two.png"}]}`)
	defer closeUpstream()

	resp, statusErr := o.Generate(context.Background(), enqueueParams(2))
	if statusErr != nil {
		t.Fatalf("Generate returned status error: %v", statusErr)
	}
	if resp == nil || len(resp.Images) != 2 {
		t.Fatalf("expected two generated images, got %#v", resp)
	}
	if jobs.input.RequestID != "request-enqueue-test" || jobs.input.LockOwner != "request-enqueue-test" {
		t.Fatalf("expected request ID to fence staging job, got %#v", jobs.input)
	}
	if jobs.input.RequestedCount != 2 || jobs.input.ReturnedCount != 0 || jobs.input.MaxAttempts != 5 {
		t.Fatalf("unexpected staging counts/config: %#v", jobs.input)
	}
	if jobs.input.LeaseDuration <= 0 {
		t.Fatalf("expected non-empty staging lease, got %s", jobs.input.LeaseDuration)
	}

	events := log.snapshot()
	if len(events) < 7 || events[0] != "start-credit" || events[1] != "create" {
		t.Fatalf("expected atomic start before staging events, got %#v", events)
	}
	for i, image := range resp.Images {
		path := "staging/image-jobs/" + jobs.input.GenerationBatchID + "/" + image.ID + ".source"
		stageEvent := "stage-url:" + path
		saveEvent := fmt.Sprintf("save-%d", i+1)
		stageIndex := enqueueIndexOfEvent(events, stageEvent)
		saveIndex := enqueueIndexOfEvent(events, saveEvent)
		if stageIndex < 0 || saveIndex < 0 || stageIndex > saveIndex {
			t.Fatalf("expected stage then manifest save for image %d, events=%#v", i, events)
		}
	}
	if enqueueIndexOfEvent(events, "activate") < 0 || enqueueIndexOfEvent(events, "activate") < enqueueIndexOfEvent(events, fmt.Sprintf("save-%d", len(resp.Images))) {
		t.Fatalf("expected activation after every manifest save, events=%#v", events)
	}
	if idem.completeCount() != 0 {
		t.Fatalf("worker-owned idempotency completion must not happen during enqueue, got %d", idem.completeCount())
	}
}

func TestGenerateStartsCreditJobBeforeCallingProvider(t *testing.T) {
	log := &enqueueCallLog{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.add("provider")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://provider.example/one.png"}]}`))
	}))
	defer upstream.Close()

	storage := &enqueueStorageService{testStorageService: &testStorageService{}, log: log}
	jobs := &enqueueJobStore{log: log}
	o := NewImageOrchestrator(&testCreditService{}, storage, &testIdempotencyService{}).
		WithProviderSettings(testProviderSettingsService{cfg: service.ImageProviderConfig{
			BaseURL:    upstream.URL,
			APIKey:     "provider-key",
			ImageModel: "image-model",
			RetryCount: 0,
		}}).
		WithImageJobStore(jobs)

	resp, statusErr := o.Generate(context.Background(), enqueueParams(1))
	if statusErr != nil || resp == nil {
		t.Fatalf("Generate returned response=%#v error=%v", resp, statusErr)
	}
	events := log.snapshot()
	startIndex := enqueueIndexOfEvent(events, "start-credit")
	providerIndex := enqueueIndexOfEvent(events, "provider")
	if startIndex < 0 || providerIndex < 0 || startIndex > providerIndex {
		t.Fatalf("expected atomic job start before provider call, events=%#v", events)
	}
}

func TestGenerateProviderFailureQueuesDurableCompensation(t *testing.T) {
	log := &enqueueCallLog{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.add("provider")
		http.Error(w, "provider failed", http.StatusInternalServerError)
	}))
	defer upstream.Close()

	credit := &enqueueCreditService{}
	jobs := &enqueueJobStore{log: log}
	o := NewImageOrchestrator(credit, &enqueueStorageService{testStorageService: &testStorageService{}, log: log}, &testIdempotencyService{}).
		WithProviderSettings(testProviderSettingsService{cfg: service.ImageProviderConfig{
			BaseURL: upstream.URL, APIKey: "provider-key", ImageModel: "image-model", RetryCount: 0,
		}}).
		WithImageJobStore(jobs)

	resp, statusErr := o.Generate(context.Background(), enqueueParams(1))
	if resp != nil || statusErr == nil || statusErr.Code != http.StatusInternalServerError {
		t.Fatalf("expected provider failure, got response=%#v error=%#v", resp, statusErr)
	}
	if jobs.compensationCount() != 1 {
		t.Fatalf("expected durable compensation, got %d", jobs.compensationCount())
	}
	if calls, amount := credit.refunds(); calls != 0 || amount != 0 {
		t.Fatalf("request path refunded durable job directly: calls=%d amount=%v", calls, amount)
	}
	events := log.snapshot()
	if enqueueIndexOfEvent(events, "start-credit") > enqueueIndexOfEvent(events, "provider") || enqueueIndexOfEvent(events, "compensate") < enqueueIndexOfEvent(events, "provider") {
		t.Fatalf("unexpected durable failure ordering: %#v", events)
	}
}

func TestGenerateRecordsPartialRefundBeforeActivatingJob(t *testing.T) {
	log := &enqueueCallLog{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.add("provider")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://provider.example/one.png"}]}`))
	}))
	defer upstream.Close()

	credit := &enqueueCreditService{}
	jobs := &enqueueJobStore{log: log}
	o := NewImageOrchestrator(credit, &enqueueStorageService{testStorageService: &testStorageService{}, log: log}, &testIdempotencyService{}).
		WithProviderSettings(testProviderSettingsService{cfg: service.ImageProviderConfig{
			BaseURL: upstream.URL, APIKey: "provider-key", ImageModel: "image-model", RetryCount: 0,
		}}).
		WithImageJobStore(jobs)

	resp, statusErr := o.Generate(context.Background(), enqueueParams(2))
	if statusErr != nil || resp == nil || len(resp.Images) != 1 || resp.TotalCost != 1 {
		t.Fatalf("unexpected partial result response=%#v error=%#v", resp, statusErr)
	}
	if refunds := jobs.recordedStagingRefunds(); len(refunds) != 1 || refunds[0] != 1 {
		t.Fatalf("recorded staging refunds = %#v, want [1]", refunds)
	}
	events := log.snapshot()
	refundIndex := enqueueIndexOfEvent(events, "record-partial-refund")
	stageIndex := enqueueIndexOfEvent(events, "stage-url:"+"staging/image-jobs/"+jobs.input.GenerationBatchID+"/"+resp.Images[0].ID+".source")
	activateIndex := enqueueIndexOfEvent(events, "activate")
	if refundIndex < 0 || stageIndex < 0 || activateIndex < 0 || refundIndex > stageIndex || refundIndex > activateIndex {
		t.Fatalf("partial refund was not recorded before staging activation: %#v", events)
	}
}

func TestGenerateRetriesAmbiguousStagingCreateBeforeCompensating(t *testing.T) {
	log := &enqueueCallLog{}
	storage := &enqueueStorageService{testStorageService: &testStorageService{}, log: log}
	jobs := &enqueueJobStore{log: log, createErrs: []error{errors.New("connection reset after commit")}}
	o, idem, closeUpstream := newEnqueueOrchestrator(t, storage, jobs, `{"data":[{"url":"https://provider.example/one.png"}]}`)
	defer closeUpstream()

	resp, statusErr := o.Generate(context.Background(), enqueueParams(1))
	if statusErr != nil || resp == nil {
		t.Fatalf("Generate returned response=%#v error=%v", resp, statusErr)
	}
	if jobs.compensationCount() != 0 || idem.completeCount() != 0 {
		t.Fatalf("request path should only enqueue; compensation=%d complete=%d", jobs.compensationCount(), idem.completeCount())
	}
	events := log.snapshot()
	createCount := 0
	for _, event := range events {
		if event == "create" {
			createCount++
		}
	}
	if createCount != 2 {
		t.Fatalf("expected one retry after ambiguous create error, events=%#v", events)
	}
}

func TestGenerateWaitsForEveryStageAndActivationBeforeReturning(t *testing.T) {
	log := &enqueueCallLog{}
	stageEntered := make(chan string, 2)
	stageRelease := make(chan struct{})
	storage := &enqueueStorageService{
		testStorageService: &testStorageService{},
		log:                log,
		stageURL: func(ctx context.Context, sourceURL, storagePath string) (*service.StagedImage, error) {
			stageEntered <- storagePath
			select {
			case <-stageRelease:
				return &service.StagedImage{StoragePath: storagePath, Mime: "image/png", Bytes: 10, SHA256: "sha"}, nil
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		},
	}
	activateEntered := make(chan struct{})
	activateRelease := make(chan struct{})
	jobs := &enqueueJobStore{log: log, activateEnter: activateEntered, activateRelease: activateRelease}
	o, _, closeUpstream := newEnqueueOrchestrator(t, storage, jobs, `{"data":[{"url":"https://provider.example/one.png"},{"url":"https://provider.example/two.png"}]}`)
	defer closeUpstream()

	type result struct {
		resp *GenResponse
		err  *StatusError
	}
	done := make(chan result, 1)
	go func() {
		resp, err := o.Generate(context.Background(), enqueueParams(2))
		done <- result{resp: resp, err: err}
	}()

	if first := <-stageEntered; first == "" {
		t.Fatal("expected first stage call")
	}
	select {
	case <-done:
		t.Fatal("Generate returned before the first stage completed")
	default:
	}
	close(stageRelease)
	if second := <-stageEntered; second == "" {
		t.Fatal("expected second stage call")
	}
	select {
	case <-activateEntered:
	case <-time.After(time.Second):
		t.Fatal("expected activation only after every stage completed")
	}
	select {
	case <-done:
		t.Fatal("Generate returned before activation completed")
	default:
	}
	close(activateRelease)

	select {
	case got := <-done:
		if got.err != nil || got.resp == nil || len(got.resp.Images) != 2 {
			t.Fatalf("unexpected Generate result: %#v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("Generate did not return after activation")
	}
}

func TestGenerateJobManifestOmitsProviderURLAndBase64(t *testing.T) {
	log := &enqueueCallLog{}
	storage := &enqueueStorageService{testStorageService: &testStorageService{}, log: log}
	jobs := &enqueueJobStore{log: log}
	providerURL := "https://provider.example/secret-url.png"
	providerBase64 := "aGVsbG8tc2VjcmV0"
	o, _, closeUpstream := newEnqueueOrchestrator(t, storage, jobs, fmt.Sprintf(`{"data":[{"url":%q},{"b64_json":%q}]}`, providerURL, providerBase64))
	defer closeUpstream()

	resp, statusErr := o.Generate(context.Background(), enqueueParams(2))
	if statusErr != nil {
		t.Fatalf("Generate returned status error: %v", statusErr)
	}
	manifest := jobs.lastManifest()
	if len(manifest) == 0 {
		t.Fatal("expected a saved staging manifest")
	}
	if strings.Contains(string(manifest), providerURL) || strings.Contains(string(manifest), providerBase64) {
		t.Fatalf("staging manifest leaked provider source: %s", manifest)
	}
	var decoded struct {
		Version int `json:"version"`
		Images  []struct {
			Result struct {
				ID            string `json:"id"`
				URL           string `json:"url"`
				TemporaryURL  string `json:"temporaryUrl"`
				DataURL       string `json:"dataUrl"`
				PreviewURL    string `json:"previewUrl"`
				PreviewPath   string `json:"previewPath"`
				ThumbnailURL  string `json:"thumbnailUrl"`
				ThumbnailPath string `json:"thumbnailPath"`
				StoragePath   string `json:"storagePath"`
			} `json:"result"`
			StagedPath  string `json:"stagedPath"`
			StagedMime  string `json:"stagedMime"`
			StagedBytes int    `json:"stagedBytes"`
			StagedSHA   string `json:"stagedSha256"`
			Phase       string `json:"phase"`
		} `json:"images"`
	}
	if err := json.Unmarshal(manifest, &decoded); err != nil {
		t.Fatalf("decode staging manifest: %v", err)
	}
	if decoded.Version != 1 || len(decoded.Images) != len(resp.Images) {
		t.Fatalf("unexpected staging manifest shape: %#v", decoded)
	}
	for _, image := range decoded.Images {
		if image.Result.URL != "" || image.Result.TemporaryURL != "" || image.Result.DataURL != "" || image.Result.PreviewURL != "" || image.Result.PreviewPath != "" || image.Result.ThumbnailURL != "" || image.Result.ThumbnailPath != "" || image.Result.StoragePath != "" {
			t.Fatalf("manifest result retained provider/permanent URL fields: %#v", image.Result)
		}
		if image.StagedPath == "" || image.StagedMime == "" || image.StagedBytes <= 0 || image.StagedSHA == "" || image.Phase != "staged" {
			t.Fatalf("manifest image was not staged: %#v", image)
		}
	}
}

func TestGenerateStagingFailureQueuesDurableCompensation(t *testing.T) {
	log := &enqueueCallLog{}
	stageCalls := 0
	storage := &enqueueStorageService{
		testStorageService: &testStorageService{},
		log:                log,
		stageURL: func(ctx context.Context, sourceURL, storagePath string) (*service.StagedImage, error) {
			stageCalls++
			if stageCalls == 2 {
				return nil, errors.New("stage failed")
			}
			return &service.StagedImage{StoragePath: storagePath, Mime: "image/png", Bytes: 10, SHA256: "sha"}, nil
		},
	}
	jobs := &enqueueJobStore{log: log}
	o, idem, closeUpstream := newEnqueueOrchestrator(t, storage, jobs, `{"data":[{"url":"https://provider.example/one.png"},{"url":"https://provider.example/two.png"}]}`)
	defer closeUpstream()

	resp, statusErr := o.Generate(context.Background(), enqueueParams(2))
	if resp != nil || statusErr == nil || (statusErr.Code != http.StatusServiceUnavailable && statusErr.Code != http.StatusInternalServerError) {
		t.Fatalf("expected staging failure status, got response=%#v error=%#v", resp, statusErr)
	}
	if jobs.compensationCount() != 1 {
		t.Fatalf("expected one durable compensation queue call, got %d", jobs.compensationCount())
	}
	if idem.completeCount() != 0 {
		t.Fatalf("staging failure must not complete idempotency, got %d", idem.completeCount())
	}
	if enqueueIndexOfEvent(log.snapshot(), "activate") >= 0 {
		t.Fatalf("failed staging must not activate job, events=%#v", log.snapshot())
	}
}

func TestGenerateActivationFailureDoesNotReturnSuccess(t *testing.T) {
	log := &enqueueCallLog{}
	storage := &enqueueStorageService{testStorageService: &testStorageService{}, log: log}
	jobs := &enqueueJobStore{log: log, activateErr: errors.New("activation failed")}
	o, idem, closeUpstream := newEnqueueOrchestrator(t, storage, jobs, `{"data":[{"url":"https://provider.example/one.png"}]}`)
	defer closeUpstream()

	resp, statusErr := o.Generate(context.Background(), enqueueParams(1))
	if resp != nil || statusErr == nil || (statusErr.Code != http.StatusServiceUnavailable && statusErr.Code != http.StatusInternalServerError) {
		t.Fatalf("expected activation failure status, got response=%#v error=%#v", resp, statusErr)
	}
	if jobs.compensationCount() != 1 {
		t.Fatalf("expected compensation after activation failure, got %d", jobs.compensationCount())
	}
	if idem.completeCount() != 0 {
		t.Fatalf("activation failure must not complete idempotency, got %d", idem.completeCount())
	}
}

func enqueueIndexOfEvent(events []string, want string) int {
	for index, event := range events {
		if event == want {
			return index
		}
	}
	return -1
}
