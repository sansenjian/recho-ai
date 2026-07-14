package orchestrator

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"go-gateway/internal/middleware"
	"go-gateway/internal/service"
)

type imageRoundTripFunc func(*http.Request) (*http.Response, error)

func (f imageRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type testCreditService struct {
	reserveErr error
	refundCh   chan struct{}
}

func (s *testCreditService) ReserveCredits(ctx context.Context, userID string, imageCount int) (string, float64, float64, float64, error) {
	if s.reserveErr != nil {
		return "", 0, 0, 0, s.reserveErr
	}
	return "tx_image_test", 99, 1, float64(imageCount), nil
}

func (s *testCreditService) RefundCredits(ctx context.Context, userID string, transactionID string, refundAmount float64, reason string) (float64, error) {
	if s.refundCh != nil {
		s.refundCh <- struct{}{}
	}
	return 99, nil
}

func (s *testCreditService) GetCreditCost(ctx context.Context, imageCount int) (float64, float64) {
	return 1, float64(imageCount)
}

type testStorageService struct {
	mu          sync.Mutex
	saveCh      chan service.ImageHistoryItem
	storeURL    func(context.Context, string, string) (*service.StoredImage, error)
	storeBuffer func(context.Context, []byte, string, string) (*service.StoredImage, error)
	deleted     []string
}

func (s *testStorageService) StoreFromURL(ctx context.Context, url, pathHint string) (*service.StoredImage, error) {
	if s.storeURL != nil {
		return s.storeURL(ctx, url, pathHint)
	}
	return storedImageForHint(pathHint), nil
}

func (s *testStorageService) StoreFromBuffer(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error) {
	if s.storeBuffer != nil {
		return s.storeBuffer(ctx, data, mime, hint)
	}
	return storedImageForHint(hint), nil
}

func (s *testStorageService) StoreFromBufferAtPath(ctx context.Context, data []byte, mime, storagePath string) (*service.StoredImage, error) {
	return storedImageForHint(storagePath), nil
}

func (s *testStorageService) DownloadImage(ctx context.Context, storagePath string) (*service.DownloadedImage, error) {
	return nil, nil
}

func (s *testStorageService) SaveImageHistory(ctx context.Context, item *service.ImageHistoryItem, userID string) error {
	if s.saveCh != nil && item != nil {
		s.saveCh <- *item
	}
	return nil
}

func (s *testStorageService) ListImageHistory(ctx context.Context, userID, scope string, limit, offset int) (*service.ImageHistory, error) {
	return &service.ImageHistory{}, nil
}

func (s *testStorageService) GetImageHistory(ctx context.Context, id, userID, scope string) (*service.ImageHistoryItem, error) {
	return nil, nil
}

func (s *testStorageService) GetImageVisibilityByPath(ctx context.Context, storagePath string) (string, string, error) {
	return "", "", nil
}

func (s *testStorageService) DeleteImageHistory(ctx context.Context, id, userID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleted = append(s.deleted, id)
	return true, nil
}

func (s *testStorageService) ClearImageHistory(ctx context.Context, userID string) (int64, error) {
	return 0, nil
}

func (s *testStorageService) CleanupObjects(paths ...string) {}

func (s *testStorageService) deletedCounts() map[string]int {
	s.mu.Lock()
	defer s.mu.Unlock()
	counts := make(map[string]int, len(s.deleted))
	for _, id := range s.deleted {
		counts[id]++
	}
	return counts
}

type testIdempotencyService struct {
	mu         sync.Mutex
	failCh     chan string
	completeCh chan string
	fails      []string
	completes  []string
}

func (s *testIdempotencyService) Acquire(ctx context.Context, userID, idemKey, scope string, body []byte) (*service.IdempotencyOutcome, error) {
	return &service.IdempotencyOutcome{Proceed: true}, nil
}

func (s *testIdempotencyService) Fail(ctx context.Context, userID, idemKey, scope string) error {
	s.mu.Lock()
	s.fails = append(s.fails, scope)
	s.mu.Unlock()
	if s.failCh != nil {
		s.failCh <- scope
	}
	return nil
}

func (s *testIdempotencyService) Complete(ctx context.Context, userID, idemKey, scope string, responseCode int16, responseBody any, transactionID string) error {
	s.mu.Lock()
	s.completes = append(s.completes, scope)
	s.mu.Unlock()
	if s.completeCh != nil {
		s.completeCh <- scope
	}
	return nil
}

func (s *testIdempotencyService) completeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.completes)
}

type testProviderSettingsService struct {
	cfg service.ImageProviderConfig
}

func (s testProviderSettingsService) ImageProvider(ctx context.Context) (service.ImageProviderConfig, error) {
	return s.cfg, nil
}

func storedImageForHint(hint string) *service.StoredImage {
	return &service.StoredImage{
		PublicURL:     "https://cdn.example.test/" + hint + ".png",
		PreviewURL:    "https://cdn.example.test/" + hint + ".preview.webp",
		ThumbnailURL:  "https://cdn.example.test/" + hint + ".thumb.webp",
		StoragePath:   hint + ".png",
		PreviewPath:   hint + ".preview.webp",
		ThumbnailPath: hint + ".thumb.webp",
		Width:         1024,
		Height:        1024,
		Bytes:         1234,
	}
}

func TestCallImageAPILucenUsesMinimalPayloadAndParsesBase64(t *testing.T) {
	var payload map[string]any
	o := NewImageOrchestrator(nil, nil, nil)
	o.httpClient = &http.Client{Transport: imageRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != "https://lucen.plus/v1/images/generations" {
			t.Fatalf("unexpected request URL: %s", req.URL)
		}
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"created":1783955103,"data":[{"b64_json":"aGVsbG8="}]}`)),
		}, nil
	})}

	images, err := o.callImageAPI(
		context.Background(),
		GenRequest{Prompt: "test prompt"},
		1,
		"1:1",
		"1K",
		"standard",
		service.ImageProviderConfig{BaseURL: "https://lucen.plus/v1", APIKey: "provider-key", ImageModel: "gpt-image-2"},
	)
	if err != nil {
		t.Fatalf("callImageAPI returned error: %v", err)
	}
	if len(payload) != 2 || payload["model"] != "gpt-image-2" || payload["prompt"] != "test prompt" {
		t.Fatalf("expected minimal Lucen payload, got %#v", payload)
	}
	for _, field := range []string{"n", "size", "quality", "response_format"} {
		if _, ok := payload[field]; ok {
			t.Fatalf("Lucen payload must omit %q: %#v", field, payload)
		}
	}
	if len(images) != 1 || images[0].source.Base64 != "aGVsbG8=" || images[0].result.DataURL != "data:image/png;base64,aGVsbG8=" {
		t.Fatalf("unexpected Base64 image result: %#v", images)
	}
}

func TestIsLucenImageProvider(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    bool
	}{
		{name: "root host", baseURL: "https://lucen.plus/v1", want: true},
		{name: "subdomain", baseURL: "https://images.lucen.plus/v1", want: true},
		{name: "mixed case", baseURL: "https://LUCEN.PLUS/v1", want: true},
		{name: "lookalike", baseURL: "https://lucen.plus.example/v1", want: false},
		{name: "other provider", baseURL: "https://provider.example/v1", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isLucenImageProvider(tt.baseURL); got != tt.want {
				t.Fatalf("isLucenImageProvider(%q) = %v, want %v", tt.baseURL, got, tt.want)
			}
		})
	}
}

func TestUsesLucenImageCompatibility(t *testing.T) {
	tests := []struct {
		name     string
		provider service.ImageProviderConfig
		want     bool
	}{
		{
			name:     "auto detects Lucen host",
			provider: service.ImageProviderConfig{BaseURL: "https://lucen.plus/v1", CompatibilityMode: service.ImageProviderCompatibilityAuto},
			want:     true,
		},
		{
			name:     "auto keeps other hosts standard",
			provider: service.ImageProviderConfig{BaseURL: "https://provider.example/v1", CompatibilityMode: service.ImageProviderCompatibilityAuto},
			want:     false,
		},
		{
			name:     "Lucen preset overrides custom host",
			provider: service.ImageProviderConfig{BaseURL: "https://custom.example/v1", CompatibilityMode: service.ImageProviderCompatibilityLucen},
			want:     true,
		},
		{
			name:     "OpenAI preset overrides Lucen host",
			provider: service.ImageProviderConfig{BaseURL: "https://lucen.plus/v1", CompatibilityMode: service.ImageProviderCompatibilityOpenAI},
			want:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := usesLucenImageCompatibility(tt.provider); got != tt.want {
				t.Fatalf("usesLucenImageCompatibility(%#v) = %v, want %v", tt.provider, got, tt.want)
			}
		})
	}
}

func TestCallImageAPILucenRunsMultipleRequestsConcurrently(t *testing.T) {
	const count = 2
	started := make(chan map[string]any, count)
	release := make(chan struct{})
	o := NewImageOrchestrator(nil, nil, nil)
	o.httpClient = &http.Client{Transport: imageRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		var payload map[string]any
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			return nil, err
		}
		started <- payload
		select {
		case <-release:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"data":[{"b64_json":"aGVsbG8="}]}`)),
		}, nil
	})}

	type callResult struct {
		images []generatedImageRecord
		err    error
	}
	done := make(chan callResult, 1)
	go func() {
		images, err := o.callImageAPI(
			context.Background(),
			GenRequest{Prompt: "two images"},
			count,
			"1:1",
			"1k",
			"medium",
			service.ImageProviderConfig{BaseURL: "https://lucen.plus/v1", APIKey: "provider-key", ImageModel: "gpt-image-2"},
		)
		done <- callResult{images: images, err: err}
	}()

	for index := 0; index < count; index++ {
		select {
		case payload := <-started:
			if len(payload) != 2 || payload["model"] != "gpt-image-2" || payload["prompt"] != "two images" {
				t.Fatalf("unexpected concurrent Lucen payload: %#v", payload)
			}
		case <-time.After(time.Second):
			t.Fatal("expected all Lucen requests to start before any response was released")
		}
	}
	close(release)

	select {
	case result := <-done:
		if result.err != nil {
			t.Fatalf("callImageAPI returned error: %v", result.err)
		}
		if len(result.images) != count {
			t.Fatalf("expected %d images, got %#v", count, result.images)
		}
		for _, image := range result.images {
			if image.source.Base64 != "aGVsbG8=" {
				t.Fatalf("unexpected concurrent image source: %#v", image)
			}
		}
	case <-time.After(time.Second):
		t.Fatal("concurrent Lucen requests did not complete")
	}
}

func TestCallImageAPIOtherProvidersKeepImageControls(t *testing.T) {
	var payload map[string]any
	o := NewImageOrchestrator(nil, nil, nil)
	o.httpClient = &http.Client{Transport: imageRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != "https://provider.example/v1/images/generations" {
			t.Fatalf("unexpected request URL: %s", req.URL)
		}
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"data":[{"url":"https://provider.example/one.png"},{"url":"https://provider.example/two.png"}]}`)),
		}, nil
	})}

	images, err := o.callImageAPI(
		context.Background(),
		GenRequest{Prompt: "test prompt"},
		2,
		"16:9",
		"2k",
		"high",
		service.ImageProviderConfig{BaseURL: "https://provider.example/v1", APIKey: "provider-key", ImageModel: "image-model"},
	)
	if err != nil {
		t.Fatalf("callImageAPI returned error: %v", err)
	}
	if payload["n"] != float64(2) || payload["size"] != "2048x1152" || payload["quality"] != "hd" {
		t.Fatalf("expected non-Lucene controls to be preserved, got %#v", payload)
	}
	if len(images) != 2 || images[0].source.URL != "https://provider.example/one.png" || images[1].source.URL != "https://provider.example/two.png" {
		t.Fatalf("unexpected non-Lucene image results: %#v", images)
	}
}

func TestGenerateFailsIdempotencyWhenCreditReserveReturnsServiceError(t *testing.T) {
	idem := &testIdempotencyService{failCh: make(chan string, 1)}
	o := NewImageOrchestrator(
		&testCreditService{reserveErr: errors.New("database unavailable")},
		&testStorageService{},
		idem,
	).WithProviderSettings(testProviderSettingsService{cfg: service.ImageProviderConfig{
		BaseURL:    "https://provider.example.test",
		APIKey:     "provider-key",
		ImageModel: "image-model",
	}})

	_, statusErr := o.Generate(context.Background(), GenerateParams{
		User:    &middleware.User{ID: "user_123"},
		RawBody: []byte(`{"prompt":"test"}`),
		IdemKey: "idem-reserve-error",
		Request: GenRequest{Prompt: "test", Count: 1},
	})

	if statusErr == nil || statusErr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 reserve error, got %#v", statusErr)
	}
	select {
	case scope := <-idem.failCh:
		if scope != "image_generate" {
			t.Fatalf("expected image_generate idempotency failure, got %q", scope)
		}
	default:
		t.Fatal("expected idempotency failure when reserve returns a service error")
	}
}

func TestGenerateTreatsTypedNilResourcesAsUnavailable(t *testing.T) {
	var creditSvc *service.CreditService
	var storageSvc *service.StorageService
	var idemSvc *service.IdempotencyService

	o := NewImageOrchestrator(creditSvc, storageSvc, idemSvc)
	_, statusErr := o.Generate(context.Background(), GenerateParams{
		User:    &middleware.User{ID: "user_123"},
		RawBody: []byte(`{"prompt":"test"}`),
		IdemKey: "idem-typed-nil",
		Request: GenRequest{Prompt: "test", Count: 1},
	})

	if statusErr == nil || statusErr.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected typed-nil storage to return 503, got %#v", statusErr)
	}
	if statusErr.Message != "图片存储服务暂时不可用。" {
		t.Fatalf("unexpected error message: %q", statusErr.Message)
	}
}

func TestGenerateCompletesIdempotencyAfterAsyncPersistenceSucceeds(t *testing.T) {
	releaseStorage := make(chan struct{})
	storage := &testStorageService{
		saveCh: make(chan service.ImageHistoryItem, 1),
		storeURL: func(ctx context.Context, url, pathHint string) (*service.StoredImage, error) {
			select {
			case <-releaseStorage:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			return storedImageForHint(pathHint), nil
		},
	}
	idem := &testIdempotencyService{completeCh: make(chan string, 1)}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://provider.example.test/image.png"}]}`))
	}))
	defer upstream.Close()

	o := NewImageOrchestrator(&testCreditService{}, storage, idem).
		WithProviderSettings(testProviderSettingsService{cfg: service.ImageProviderConfig{
			BaseURL:    upstream.URL,
			APIKey:     "provider-key",
			ImageModel: "image-model",
			RetryCount: 0,
		}})

	resp, statusErr := o.Generate(context.Background(), GenerateParams{
		User:    &middleware.User{ID: "user_123"},
		RawBody: []byte(`{"prompt":"test"}`),
		IdemKey: "idem-async-success",
		Request: GenRequest{Prompt: "test", Count: 1},
	})
	if statusErr != nil {
		t.Fatalf("Generate returned status error: %v", statusErr)
	}
	if resp == nil || len(resp.Images) != 1 {
		t.Fatalf("expected one generated image, got %#v", resp)
	}

	select {
	case scope := <-idem.completeCh:
		t.Fatalf("idempotency completed before persistence succeeded: %s", scope)
	default:
	}

	close(releaseStorage)
	select {
	case <-storage.saveCh:
	case <-time.After(time.Second):
		t.Fatal("expected async history save")
	}
	select {
	case scope := <-idem.completeCh:
		if scope != "image_generate" {
			t.Fatalf("expected image_generate complete, got %q", scope)
		}
	case <-time.After(time.Second):
		t.Fatal("expected idempotency complete after async persistence succeeds")
	}
	if idem.completeCount() != 1 {
		t.Fatalf("expected exactly one idempotency complete, got %d", idem.completeCount())
	}
}

func TestPersistAsyncSagaDeletesEachSavedHistoryRecordOnceOnRollback(t *testing.T) {
	idem := &testIdempotencyService{failCh: make(chan string, 1)}
	storeCalls := 0
	storage := &testStorageService{
		storeBuffer: func(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error) {
			storeCalls++
			if storeCalls == 3 {
				return nil, errors.New("storage failed")
			}
			return storedImageForHint(hint), nil
		},
	}
	o := NewImageOrchestrator(&testCreditService{}, storage, idem)

	images := []generatedImageRecord{
		{result: ImageResult{ID: "img_0"}, source: imageSource{Base64: "aGVsbG8=", Mime: "image/png"}},
		{result: ImageResult{ID: "img_1"}, source: imageSource{Base64: "aGVsbG8=", Mime: "image/png"}},
		{result: ImageResult{ID: "img_2"}, source: imageSource{Base64: "aGVsbG8=", Mime: "image/png"}},
	}
	o.persistAsyncSaga(images, imageGenerationMetadata{}, nil, "user_123", &middleware.User{ID: "user_123"}, "idem-rollback", &GenResponse{}, "")

	select {
	case <-idem.failCh:
	case <-time.After(time.Second):
		t.Fatal("expected async saga failure")
	}

	counts := storage.deletedCounts()
	for _, id := range []string{"img_0", "img_1"} {
		if counts[id] != 1 {
			t.Fatalf("expected history %s to be deleted once, got counts %#v", id, counts)
		}
	}
	if counts["img_2"] != 0 {
		t.Fatalf("did not expect failed image history to be deleted, got counts %#v", counts)
	}
	totalDeletes := 0
	for _, count := range counts {
		totalDeletes += count
	}
	if totalDeletes != 2 {
		t.Fatalf("expected exactly 2 delete calls, got %d (%#v)", totalDeletes, counts)
	}
}
