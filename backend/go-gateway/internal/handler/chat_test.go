package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"go-gateway/internal/middleware"
	"go-gateway/internal/service"
)

type stubChatService struct {
	modelCosts map[string]int
	resp       *http.Response
	err        error
}

func (s *stubChatService) Chat(ctx context.Context, model string, body []byte) (*http.Response, error) {
	return s.resp, s.err
}

func (s *stubChatService) GetCreditCost(model string) int {
	if s.modelCosts != nil {
		if cost, ok := s.modelCosts[model]; ok {
			return cost
		}
	}
	return 0
}

func (s *stubChatService) GetChatHistory(userID string) ([]service.ChatHistoryItem, error) {
	return nil, nil
}

type stubChatCreditService struct {
	reserveCalls []float64
	refundCalls  []float64
	balance      float64
	reserveErr   error
}

func (s *stubChatCreditService) ReserveAmount(ctx context.Context, userID string, amount float64, metadata map[string]any) (string, float64, error) {
	s.reserveCalls = append(s.reserveCalls, amount)
	if s.reserveErr != nil {
		return "", s.balance, s.reserveErr
	}
	return "tx_chat_test", s.balance - amount, nil
}

func (s *stubChatCreditService) RefundCredits(ctx context.Context, userID string, transactionID string, refundAmount float64, reason string) (float64, error) {
	s.refundCalls = append(s.refundCalls, refundAmount)
	return s.balance, nil
}

func (s *stubChatCreditService) GetBalance(ctx context.Context, userID string) (float64, error) {
	return s.balance, nil
}

func TestChatReserveFailureReturnsPaymentRequiredWhenBalanceIsTooLow(t *testing.T) {
	chatSvc := &stubChatService{
		modelCosts: map[string]int{"gpt-4": 100},
	}
	creditSvc := &stubChatCreditService{
		balance:    25,
		reserveErr: errors.New("insufficient credits"),
	}
	h := NewChatHandler(chatSvc, creditSvc, "")

	reqBody := map[string]any{
		"model":    "gpt-4",
		"stream":   false,
		"messages": []map[string]string{{"role": "user", "content": "hello"}},
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/chat", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	res := httptest.NewRecorder()

	h.Chat(res, req)

	if res.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402, got %d body=%s", res.Code, res.Body.String())
	}
	expected := "Insufficient credits. Required: 100.00, Available: 25.00"
	if !bytes.Contains(res.Body.Bytes(), []byte(expected)) {
		t.Fatalf("expected error %q, got body=%s", expected, res.Body.String())
	}
	if len(creditSvc.reserveCalls) != 1 {
		t.Fatalf("expected 1 reserve call, got %d", len(creditSvc.reserveCalls))
	}
}

func TestChatReserveFailureReturnsServiceUnavailableWhenBalanceCoversCost(t *testing.T) {
	chatSvc := &stubChatService{
		modelCosts: map[string]int{"gpt-4": 100},
	}
	creditSvc := &stubChatCreditService{
		balance:    500,
		reserveErr: errors.New("credit service unavailable"),
	}
	h := NewChatHandler(chatSvc, creditSvc, "")

	reqBody := map[string]any{
		"model":    "gpt-4",
		"stream":   false,
		"messages": []map[string]string{{"role": "user", "content": "hello"}},
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/chat", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	res := httptest.NewRecorder()

	h.Chat(res, req)

	if res.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d body=%s", res.Code, res.Body.String())
	}
	expected := "Credit service unavailable"
	if !bytes.Contains(res.Body.Bytes(), []byte(expected)) {
		t.Fatalf("expected error %q, got body=%s", expected, res.Body.String())
	}
	if len(creditSvc.reserveCalls) != 1 {
		t.Fatalf("expected 1 reserve call, got %d", len(creditSvc.reserveCalls))
	}
}

func TestChatNonStreamReservesAndRefundsCreditsOnUpstreamFailure(t *testing.T) {
	chatSvc := &stubChatService{
		modelCosts: map[string]int{"gpt-4": 100},
		resp: &http.Response{
			StatusCode: http.StatusBadGateway,
			Body:       io.NopCloser(bytes.NewBufferString(`{"error":"bad gateway"}`)),
		},
	}
	creditSvc := &stubChatCreditService{balance: 500}
	h := NewChatHandler(chatSvc, creditSvc, "")

	reqBody := map[string]any{
		"model":  "gpt-4",
		"stream": false,
		"messages": []map[string]string{{
			"role":    "user",
			"content": "hello",
		}},
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/chat", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	res := httptest.NewRecorder()

	h.Chat(res, req)

	if res.Code != http.StatusBadGateway {
		t.Fatalf("expected upstream status, got %d body=%s", res.Code, res.Body.String())
	}
	if len(creditSvc.reserveCalls) != 1 {
		t.Fatalf("expected 1 reserve call, got %d", len(creditSvc.reserveCalls))
	}
	if len(creditSvc.refundCalls) != 1 {
		t.Fatalf("expected 1 refund call, got %d", len(creditSvc.refundCalls))
	}
	if creditSvc.reserveCalls[0] != 100 {
		t.Fatalf("expected reserve amount 100, got %.2f", creditSvc.reserveCalls[0])
	}
	if creditSvc.refundCalls[0] != 100 {
		t.Fatalf("expected refund amount 100, got %.2f", creditSvc.refundCalls[0])
	}
}

func TestChatNonStreamReservesAndRefundsCreditsOnChatError(t *testing.T) {
	chatSvc := &stubChatService{
		modelCosts: map[string]int{"gpt-4": 100},
		err:        errors.New("upstream unavailable"),
	}
	creditSvc := &stubChatCreditService{balance: 500}
	h := NewChatHandler(chatSvc, creditSvc, "")

	reqBody := map[string]any{
		"model":  "gpt-4",
		"stream": false,
		"messages": []map[string]string{{
			"role":    "user",
			"content": "hello",
		}},
	}
	raw, err := json.Marshal(reqBody)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/chat", bytes.NewReader(raw))
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	res := httptest.NewRecorder()

	h.Chat(res, req)

	if res.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d body=%s", res.Code, res.Body.String())
	}
	if len(creditSvc.reserveCalls) != 1 {
		t.Fatalf("expected 1 reserve call, got %d", len(creditSvc.reserveCalls))
	}
	if len(creditSvc.refundCalls) != 1 {
		t.Fatalf("expected 1 refund call, got %d", len(creditSvc.refundCalls))
	}
}

func TestChatHistoryUsesService(t *testing.T) {
	chatSvc := &stubChatService{}
	h := NewChatHandler(chatSvc, nil, "")

	req := httptest.NewRequest(http.MethodGet, "/api/chat/history", nil)
	req = req.WithContext(middleware.WithUser(req.Context(), &middleware.User{ID: "user_123"}))
	res := httptest.NewRecorder()

	h.ChatHistory(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}
}
