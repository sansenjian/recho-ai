package handler

import (
	"bytes"
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

	"go-gateway/internal/config"
	"go-gateway/internal/middleware"
	"go-gateway/internal/service"
)

type stubImageCreditService struct {
	reserveCalls []float64
	refundCalls  []float64
	refundCh     chan float64
	balance      float64
	costPerImage float64
}

func (s *stubImageCreditService) ReserveCredits(ctx context.Context, userID string, imageCount int) (string, float64, float64, float64, error) {
	costPerImage := s.costPerImage
	if costPerImage <= 0 {
		costPerImage = 1.0
	}
	cost := float64(imageCount) * costPerImage
	s.reserveCalls = append(s.reserveCalls, float64(imageCount))
	return "tx_image_test", s.balance - cost, costPerImage, cost, nil
}

func (s *stubImageCreditService) RefundCredits(ctx context.Context, userID string, transactionID string, refundAmount float64, reason string) (float64, error) {
	s.refundCalls = append(s.refundCalls, refundAmount)
	if s.refundCh != nil {
		s.refundCh <- refundAmount
	}
	return s.balance, nil
}

func (s *stubImageCreditService) GetCreditCost(ctx context.Context, imageCount int) (float64, float64) {
	costPerImage := s.costPerImage
	if costPerImage <= 0 {
		costPerImage = 1.0
	}
	return costPerImage, float64(imageCount) * costPerImage
}

type stubImageStorageService struct {
	saveErr      error
	saveCh       chan service.ImageHistoryItem
	cleanupCh    chan []string
	downloadFunc func(ctx context.Context, storagePath string) (*service.DownloadedImage, error)
	storeFunc    func(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error)
	visibility   string
	owner        string
	visErr       error
}

func (s *stubImageStorageService) StoreFromURL(ctx context.Context, url, pathHint string) (*service.StoredImage, error) {
	if s.storeFunc != nil {
		return s.storeFunc(ctx, nil, "image/png", pathHint)
	}
	return nil, nil
}

func (s *stubImageStorageService) StoreFromBuffer(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error) {
	if s.storeFunc != nil {
		return s.storeFunc(ctx, data, mime, hint)
	}
	return nil, nil
}

func (s *stubImageStorageService) StoreFromBufferAtPath(ctx context.Context, data []byte, mime, storagePath string) (*service.StoredImage, error) {
	return nil, nil
}

func (s *stubImageStorageService) DownloadImage(ctx context.Context, storagePath string) (*service.DownloadedImage, error) {
	return nil, nil
}

func (s *stubImageStorageService) SaveImageHistory(ctx context.Context, item *service.ImageHistoryItem, userID string) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	if s.saveCh != nil && item != nil {
		select {
		case s.saveCh <- *item:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return s.saveErr
}

func (s *stubImageStorageService) ListImageHistory(ctx context.Context, userID, scope string, limit, offset int) (*service.ImageHistory, error) {
	return &service.ImageHistory{}, nil
}

func (s *stubImageStorageService) GetImageHistory(ctx context.Context, id, userID, scope string) (*service.ImageHistoryItem, error) {
	return nil, nil
}

func (s *stubImageStorageService) DeleteImageHistory(ctx context.Context, id, userID string) (bool, error) {
	return false, nil
}

func (s *stubImageStorageService) ClearImageHistory(ctx context.Context, userID string) (int64, error) {
	return 0, nil
}

func (s *stubImageStorageService) GetImageVisibilityByPath(ctx context.Context, storagePath string) (string, string, error) {
	if s.visErr != nil {
		return "", "", s.visErr
	}
	return s.visibility, s.owner, nil
}

func (s *stubImageStorageService) CleanupObjects(paths ...string) {
	if s.cleanupCh != nil {
		s.cleanupCh <- append([]string(nil), paths...)
	}
}

type stubImageIdempotencyService struct {
	outcome       *service.IdempotencyOutcome
	acquireCalls  int
	failCalls     []string
	failCh        chan string
	completeCalls []string
	completeCh    chan string
}

func (s *stubImageIdempotencyService) Acquire(ctx context.Context, userID, idemKey, scope string, body []byte) (*service.IdempotencyOutcome, error) {
	s.acquireCalls += 1
	if s.outcome != nil {
		return s.outcome, nil
	}
	return &service.IdempotencyOutcome{Proceed: true}, nil
}

func (s *stubImageIdempotencyService) Fail(ctx context.Context, userID, idemKey, scope string) error {
	s.failCalls = append(s.failCalls, scope)
	if s.failCh != nil {
		s.failCh <- scope
	}
	return nil
}

func (s *stubImageIdempotencyService) Complete(ctx context.Context, userID, idemKey, scope string, responseCode int16, responseBody any, transactionID string) error {
	s.completeCalls = append(s.completeCalls, scope)
	if s.completeCh != nil {
		s.completeCh <- scope
	}
	return nil
}

type stubProviderSettingsService struct {
	cfg service.ImageProviderConfig
	err error
}

func (s *stubProviderSettingsService) ImageProvider(ctx context.Context) (service.ImageProviderConfig, error) {
	if s.err != nil {
		return service.DefaultImageProviderConfig(), s.err
	}
	return s.cfg, nil
}

func TestImageGenerateUsesProviderSettings(t *testing.T) {
	creditSvc := &stubImageCreditService{balance: 10}
	storageSvc := &stubImageStorageService{
		storeFunc: func(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error) {
			return &service.StoredImage{
				PublicURL:     "https://cdn.example.test/generated.png",
				PreviewURL:    "https://cdn.example.test/generated.preview.webp",
				ThumbnailURL:  "https://cdn.example.test/generated.thumb.webp",
				StoragePath:   "generated/test.png",
				PreviewPath:   "generated/test.preview.webp",
				ThumbnailPath: "generated/test.thumb.webp",
				Width:         1024,
				Height:        1024,
				Bytes:         1234,
			}, nil
		},
	}
	idemSvc := &stubImageIdempotencyService{}

	var authHeader string
	var model string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		model, _ = body["model"].(string)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/image.png"}]}`))
	}))
	defer upstream.Close()

	h := NewImageHandler(creditSvc, storageSvc, idemSvc).WithProviderSettings(&stubProviderSettingsService{
		cfg: service.ImageProviderConfig{
			Name:                   "db image provider",
			BaseURL:                upstream.URL,
			APIKey:                 "db-secret-key",
			ImageModel:             "db-image-model",
			EditModel:              "db-edit-model",
			Timeout:                360000000000,
			RetryCount:             0,
			SupportsWebpReferences: true,
			Source:                 "database",
		},
	})

	raw, err := json.Marshal(map[string]any{"prompt": "test prompt", "count": 1})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/image/generate", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-provider")
	res := httptest.NewRecorder()

	h.Generate(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}
	if authHeader != "Bearer db-secret-key" {
		t.Fatalf("expected provider api key, got %q", authHeader)
	}
	if model != "db-image-model" {
		t.Fatalf("expected provider image model, got %q", model)
	}
}

func TestImageGenerateProviderUnavailableDoesNotReserveCreditsAndFailsIdempotency(t *testing.T) {
	creditSvc := &stubImageCreditService{balance: 10}
	storageSvc := &stubImageStorageService{}
	idemSvc := &stubImageIdempotencyService{}
	h := NewImageHandler(creditSvc, storageSvc, idemSvc).WithProviderSettings(&stubProviderSettingsService{
		err: errors.New("provider settings unavailable"),
	})

	raw := []byte(`{"prompt":"test prompt","count":1}`)
	req := httptest.NewRequest(http.MethodPost, "/api/image/generate", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-provider-unavailable")
	res := httptest.NewRecorder()

	h.Generate(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d body=%s", res.Code, res.Body.String())
	}
	if len(creditSvc.reserveCalls) != 0 {
		t.Fatalf("expected no reserve calls when provider config is unavailable, got %d", len(creditSvc.reserveCalls))
	}
	if len(idemSvc.failCalls) != 1 || idemSvc.failCalls[0] != "image_generate" {
		t.Fatalf("expected idempotency failure for provider config error, got %#v", idemSvc.failCalls)
	}
}

func TestImageGenerateReturnsTemporaryURLAndMarksIdempotencyFailedWhenAsyncPersistenceFails(t *testing.T) {
	creditSvc := &stubImageCreditService{balance: 10, refundCh: make(chan float64, 1)}
	storageSvc := &stubImageStorageService{saveErr: io.EOF, cleanupCh: make(chan []string, 1), storeFunc: func(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error) {
		return &service.StoredImage{
			PublicURL:     "https://cdn.example.test/generated.png",
			PreviewURL:    "https://cdn.example.test/generated.preview.webp",
			ThumbnailURL:  "https://cdn.example.test/generated.thumb.webp",
			StoragePath:   "generated/test.png",
			PreviewPath:   "generated/test.preview.webp",
			ThumbnailPath: "generated/test.thumb.webp",
			Width:         1024,
			Height:        1024,
			Bytes:         1234,
		}, nil
	}}
	idemSvc := &stubImageIdempotencyService{failCh: make(chan string, 1)}
	h := NewImageHandler(creditSvc, storageSvc, idemSvc)

	origBaseURL := config.ImageGenBaseURL
	origAPIKey := config.ImageGenAPIKey
	defer func() {
		config.ImageGenBaseURL = origBaseURL
		config.ImageGenAPIKey = origAPIKey
	}()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method: %s", r.Method)
			http.Error(w, "unexpected method", http.StatusBadRequest)
			return
		}
		if r.URL.Path != "/images/generations" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.Error(w, "unexpected path", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/image.png","revised_prompt":"revised"}]}`))
	}))
	defer upstream.Close()
	config.ImageGenBaseURL = upstream.URL
	config.ImageGenAPIKey = "test-key"

	reqBody := map[string]any{
		"prompt": "test prompt",
		"count":  1,
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/image/generate", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-1")
	res := httptest.NewRecorder()

	h.Generate(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}
	var body ImageGenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Images) != 1 {
		t.Fatalf("expected 1 image, got %#v", body.Images)
	}
	if body.Images[0].TemporaryURL != "https://example.com/image.png" {
		t.Fatalf("expected temporary provider URL, got %#v", body.Images[0])
	}
	if body.Images[0].StoragePath != "" {
		t.Fatalf("expected storage path to be empty before async persistence, got %#v", body.Images[0])
	}
	if len(creditSvc.reserveCalls) != 1 {
		t.Fatalf("expected 1 reserve call, got %d", len(creditSvc.reserveCalls))
	}
	select {
	case paths := <-storageSvc.cleanupCh:
		expected := []string{"generated/test.png", "generated/test.preview.webp", "generated/test.thumb.webp"}
		if len(paths) != len(expected) {
			t.Fatalf("expected cleanup paths %#v, got %#v", expected, paths)
		}
		for i, path := range expected {
			if paths[i] != path {
				t.Fatalf("expected cleanup paths %#v, got %#v", expected, paths)
			}
		}
	case <-time.After(time.Second):
		t.Fatalf("expected async cleanup of uploaded objects")
	}
	select {
	case <-creditSvc.refundCh:
	case <-time.After(time.Second):
		t.Fatalf("expected async refund call")
	}
	select {
	case scope := <-idemSvc.failCh:
		if scope != "image_generate" {
			t.Fatalf("expected idempotency fail for image_generate, got %q", scope)
		}
	case <-time.After(time.Second):
		t.Fatalf("expected async idempotency fail")
	}
}

func TestImageGenerateFastReturnsTemporaryURLAndPersistsHistoryAsync(t *testing.T) {
	creditSvc := &stubImageCreditService{balance: 10}
	storeStarted := make(chan string, 1)
	releaseStorage := make(chan struct{})
	var releaseOnce sync.Once
	release := func() {
		releaseOnce.Do(func() {
			close(releaseStorage)
		})
	}
	t.Cleanup(release)

	storageSvc := &stubImageStorageService{
		saveCh: make(chan service.ImageHistoryItem, 1),
		storeFunc: func(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error) {
			storeStarted <- hint
			select {
			case <-releaseStorage:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			return &service.StoredImage{
				PublicURL:     "https://cdn.example.test/generated.png",
				PreviewURL:    "https://cdn.example.test/generated.preview.webp",
				ThumbnailURL:  "https://cdn.example.test/generated.thumb.webp",
				StoragePath:   "generated/test.png",
				PreviewPath:   "generated/test.preview.webp",
				ThumbnailPath: "generated/test.thumb.webp",
				Width:         1024,
				Height:        1024,
				Bytes:         1234,
			}, nil
		},
	}
	idemSvc := &stubImageIdempotencyService{completeCh: make(chan string, 1)}
	h := NewImageHandler(creditSvc, storageSvc, idemSvc)

	origBaseURL := config.ImageGenBaseURL
	origAPIKey := config.ImageGenAPIKey
	defer func() {
		config.ImageGenBaseURL = origBaseURL
		config.ImageGenAPIKey = origAPIKey
	}()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/image.png","revised_prompt":"revised"}]}`))
	}))
	defer upstream.Close()
	config.ImageGenBaseURL = upstream.URL
	config.ImageGenAPIKey = "test-key"

	raw := []byte(`{"prompt":"test prompt","count":1}`)
	req := httptest.NewRequest(http.MethodPost, "/api/image/generate", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-fast")
	res := httptest.NewRecorder()

	h.Generate(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}
	var body ImageGenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Images) != 1 {
		t.Fatalf("expected 1 image, got %#v", body.Images)
	}
	image := body.Images[0]
	if image.TemporaryURL != "https://example.com/image.png" || image.URL != "https://example.com/image.png" {
		t.Fatalf("expected provider URL to be returned immediately, got %#v", image)
	}
	if image.PersistenceStatus != "processing" {
		t.Fatalf("expected processing status before async persistence, got %#v", image)
	}
	if image.StoragePath != "" || image.ThumbnailPath != "" {
		t.Fatalf("expected no permanent storage paths before async persistence, got %#v", image)
	}
	select {
	case scope := <-idemSvc.completeCh:
		t.Fatalf("idempotency completed before async persistence succeeded: %s", scope)
	default:
	}

	select {
	case hint := <-storeStarted:
		if !strings.HasPrefix(hint, "generated/") {
			t.Fatalf("expected generated storage hint, got %q", hint)
		}
	case <-time.After(time.Second):
		t.Fatalf("expected async storage to start")
	}
	release()

	select {
	case saved := <-storageSvc.saveCh:
		if saved.ID != image.ID {
			t.Fatalf("expected saved history id %q, got %q", image.ID, saved.ID)
		}
		if saved.StoragePath != "generated/test.png" {
			t.Fatalf("expected permanent storage path, got %#v", saved)
		}
		if saved.URL != "https://cdn.example.test/generated.png" {
			t.Fatalf("expected permanent URL, got %#v", saved)
		}
		if saved.PreviewURL != "https://cdn.example.test/generated.preview.webp" {
			t.Fatalf("expected preview URL, got %#v", saved)
		}
		if saved.ThumbnailURL != "https://cdn.example.test/generated.thumb.webp" {
			t.Fatalf("expected thumbnail URL, got %#v", saved)
		}
	case <-time.After(time.Second):
		t.Fatalf("expected async history save")
	}
	select {
	case scope := <-idemSvc.completeCh:
		if scope != "image_generate" {
			t.Fatalf("expected idempotency complete for image_generate, got %q", scope)
		}
	case <-time.After(time.Second):
		t.Fatalf("expected idempotency complete after async persistence")
	}
	if len(idemSvc.completeCalls) != 1 || idemSvc.completeCalls[0] != "image_generate" {
		t.Fatalf("expected idempotency complete call, got %#v", idemSvc.completeCalls)
	}
}

func TestImageGenerateRejectsIdempotencyKeyWhenServiceUnavailable(t *testing.T) {
	creditSvc := &stubImageCreditService{balance: 10}
	storageSvc := &stubImageStorageService{}
	h := NewImageHandler(creditSvc, storageSvc, nil)

	raw := []byte(`{"prompt":"test prompt","count":1}`)
	req := httptest.NewRequest(http.MethodPost, "/api/image/generate", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-1")
	res := httptest.NewRecorder()

	h.Generate(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d body=%s", res.Code, res.Body.String())
	}
	if len(creditSvc.reserveCalls) != 0 {
		t.Fatalf("expected no reserve calls when idempotency service is missing, got %d", len(creditSvc.reserveCalls))
	}
}

func TestImageHandlerTreatsTypedNilServicesAsUnavailable(t *testing.T) {
	var creditSvc *service.CreditService
	var storageSvc *service.StorageService
	var idemSvc *service.IdempotencyService
	h := NewImageHandler(creditSvc, storageSvc, idemSvc)

	raw := []byte(`{"prompt":"test prompt","count":1}`)
	generateReq := httptest.NewRequest(http.MethodPost, "/api/image/generate", bytes.NewReader(raw))
	generateReq = generateReq.WithContext(middleware.WithUser(generateReq.Context(), &middleware.User{ID: "user_123"}))
	generateReq.Header.Set("Content-Type", "application/json")
	generateReq.Header.Set("Idempotency-Key", "idem-typed-nil")
	generateRes := httptest.NewRecorder()

	h.Generate(generateRes, generateReq)

	if generateRes.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected typed-nil storage to return 503, got %d body=%s", generateRes.Code, generateRes.Body.String())
	}

	historyReq := httptest.NewRequest(http.MethodGet, "/api/image/history?limit=12&offset=0&scope=mine", nil)
	historyReq = historyReq.WithContext(middleware.WithUser(historyReq.Context(), &middleware.User{ID: "user_123"}))
	historyRes := httptest.NewRecorder()

	h.ListHistory(historyRes, historyReq)

	if historyRes.Code != http.StatusOK {
		t.Fatalf("expected typed-nil storage history fallback to return 200, got %d body=%s", historyRes.Code, historyRes.Body.String())
	}
	var body ImageHistoryListResponse
	if err := json.Unmarshal(historyRes.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Persistence || body.Total != 0 || len(body.Images) != 0 {
		t.Fatalf("expected empty non-persistent history fallback, got %#v", body)
	}
}

func TestImageGenerateRequiresIdempotencyKeyForCreditRequests(t *testing.T) {
	creditSvc := &stubImageCreditService{balance: 10}
	storageSvc := &stubImageStorageService{}
	idemSvc := &stubImageIdempotencyService{}
	h := NewImageHandler(creditSvc, storageSvc, idemSvc)

	raw := []byte(`{"prompt":"test prompt","count":1}`)
	req := httptest.NewRequest(http.MethodPost, "/api/image/generate", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()

	h.Generate(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", res.Code, res.Body.String())
	}
	if idemSvc.acquireCalls != 0 {
		t.Fatalf("expected no acquire calls without idempotency key, got %d", idemSvc.acquireCalls)
	}
	if len(creditSvc.reserveCalls) != 0 {
		t.Fatalf("expected no reserve calls without idempotency key, got %d", len(creditSvc.reserveCalls))
	}
}

func TestImageGenerateIdempotencyReplayDoesNotReserveCredits(t *testing.T) {
	creditSvc := &stubImageCreditService{balance: 10}
	storageSvc := &stubImageStorageService{}
	replayBody := json.RawMessage(`{"images":[],"creditCost":0.75,"totalCost":1.5}`)
	idemSvc := &stubImageIdempotencyService{
		outcome: &service.IdempotencyOutcome{
			Proceed:    false,
			ReplayBody: replayBody,
			ReplayCode: http.StatusOK,
		},
	}
	h := NewImageHandler(creditSvc, storageSvc, idemSvc)

	raw := []byte(`{"prompt":"test prompt","count":2}`)
	req := httptest.NewRequest(http.MethodPost, "/api/image/generate", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-1")
	res := httptest.NewRecorder()

	h.Generate(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}
	if res.Header().Get("X-Idempotent-Replay") != "true" {
		t.Fatalf("expected replay header, got %q", res.Header().Get("X-Idempotent-Replay"))
	}
	if idemSvc.acquireCalls != 1 {
		t.Fatalf("expected 1 acquire call, got %d", idemSvc.acquireCalls)
	}
	if len(creditSvc.reserveCalls) != 0 {
		t.Fatalf("expected no reserve calls for replay, got %d", len(creditSvc.reserveCalls))
	}
	if res.Body.String() != string(replayBody) {
		t.Fatalf("unexpected replay body: %s", res.Body.String())
	}
}

func TestImageGenerateUsesCreditServicePrice(t *testing.T) {
	creditSvc := &stubImageCreditService{balance: 10, costPerImage: 0.75}
	storageSvc := &stubImageStorageService{}
	idemSvc := &stubImageIdempotencyService{}
	h := NewImageHandler(creditSvc, storageSvc, idemSvc)

	origBaseURL := config.ImageGenBaseURL
	origAPIKey := config.ImageGenAPIKey
	defer func() {
		config.ImageGenBaseURL = origBaseURL
		config.ImageGenAPIKey = origAPIKey
	}()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"aGVsbG8="},{"b64_json":"d29ybGQ="}]}`))
	}))
	defer upstream.Close()
	config.ImageGenBaseURL = upstream.URL
	config.ImageGenAPIKey = "test-key"

	raw := []byte(`{"prompt":"test prompt","count":2}`)
	req := httptest.NewRequest(http.MethodPost, "/api/image/generate", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "idem-1")
	res := httptest.NewRecorder()

	h.Generate(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}
	var body ImageGenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.CreditCost != 0.75 {
		t.Fatalf("expected response credit cost 0.75, got %v", body.CreditCost)
	}
	if body.TotalCost != 1.5 {
		t.Fatalf("expected total cost 1.5, got %v", body.TotalCost)
	}
	if len(creditSvc.reserveCalls) != 1 || creditSvc.reserveCalls[0] != 2 {
		t.Fatalf("expected one reserve call for 2 images, got %#v", creditSvc.reserveCalls)
	}
}
