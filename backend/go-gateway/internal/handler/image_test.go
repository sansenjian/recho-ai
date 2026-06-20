package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"go-gateway/internal/config"
	"go-gateway/internal/middleware"
	"go-gateway/internal/service"
)

type stubImageCreditService struct {
	reserveCalls []float64
	refundCalls  []float64
	balance      float64
}

func (s *stubImageCreditService) ReserveCredits(ctx context.Context, userID string, imageCount int) (string, float64, float64, float64, error) {
	cost := 1.0
	s.reserveCalls = append(s.reserveCalls, float64(imageCount))
	return "tx_image_test", s.balance - cost, cost, cost, nil
}

func (s *stubImageCreditService) RefundCredits(ctx context.Context, userID string, transactionID string, refundAmount float64, reason string) (float64, error) {
	s.refundCalls = append(s.refundCalls, refundAmount)
	return s.balance, nil
}

func (s *stubImageCreditService) GetCreditCost(imageCount int) (float64, float64) {
	return 1.0, 1.0
}

type stubImageStorageService struct {
	saveErr error
}

func (s *stubImageStorageService) StoreFromURL(ctx context.Context, url string) (*service.StoredImage, error) {
	return nil, nil
}

func (s *stubImageStorageService) StoreFromBuffer(ctx context.Context, data []byte, mime, hint string) (*service.StoredImage, error) {
	return nil, nil
}

func (s *stubImageStorageService) StoreFromBufferAtPath(ctx context.Context, data []byte, mime, storagePath string) (*service.StoredImage, error) {
	return nil, nil
}

func (s *stubImageStorageService) DownloadImage(ctx context.Context, storagePath string) (*service.DownloadedImage, error) {
	return nil, nil
}

func (s *stubImageStorageService) SaveImageHistory(ctx context.Context, item *service.ImageHistoryItem, userID string) error {
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

type stubImageIdempotencyService struct {
	failCalls []string
}

func (s *stubImageIdempotencyService) Acquire(ctx context.Context, userID, idemKey, scope string, body []byte) (*service.IdempotencyOutcome, error) {
	return &service.IdempotencyOutcome{Proceed: true}, nil
}

func (s *stubImageIdempotencyService) Fail(ctx context.Context, userID, idemKey, scope string) {
	s.failCalls = append(s.failCalls, scope)
}

func (s *stubImageIdempotencyService) Complete(ctx context.Context, userID, idemKey, scope string, responseCode int16, responseBody any, transactionID string) {
}

func TestImageGenerateMarksIdempotencyFailedWhenHistorySaveFails(t *testing.T) {
	creditSvc := &stubImageCreditService{balance: 10}
	storageSvc := &stubImageStorageService{saveErr: io.EOF}
	idemSvc := &stubImageIdempotencyService{}
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

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d body=%s", res.Code, res.Body.String())
	}
	if len(creditSvc.reserveCalls) != 1 {
		t.Fatalf("expected 1 reserve call, got %d", len(creditSvc.reserveCalls))
	}
	if len(creditSvc.refundCalls) != 1 {
		t.Fatalf("expected 1 refund call, got %d", len(creditSvc.refundCalls))
	}
	if len(idemSvc.failCalls) != 1 || idemSvc.failCalls[0] != "image_generate" {
		t.Fatalf("expected idempotency fail for image_generate, got %#v", idemSvc.failCalls)
	}
}
