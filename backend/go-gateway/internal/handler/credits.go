package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/middleware"
	"go-gateway/internal/pkg/response"
	"go-gateway/internal/service"
)

// CreditsHandler handles credit-related endpoints
type CreditsHandler struct {
	creditService  *service.CreditService
	redeemService  *service.RedeemService
	idempotencySvc *service.IdempotencyService // optional, nil disables idempotency
}

// NewCreditsHandler creates a new credits handler.
// idempotencySvc may be nil to disable idempotency checks.
func NewCreditsHandler(
	creditService *service.CreditService,
	redeemService *service.RedeemService,
	idempotencySvc *service.IdempotencyService,
) *CreditsHandler {
	return &CreditsHandler{
		creditService:  creditService,
		redeemService:  redeemService,
		idempotencySvc: idempotencySvc,
	}
}

// CreditBalanceResponse represents the credit balance response
type CreditBalanceResponse struct {
	Balance float64 `json:"balance"`
}

// GetBalance handles GET /api/credits
func (h *CreditsHandler) GetBalance(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	if user == nil || user.ID == "" {
		response.Error(w, http.StatusUnauthorized, "请先登录后再查看额度。")
		return
	}
	if h.creditService == nil {
		response.Error(w, http.StatusServiceUnavailable, "额度服务暂时不可用。")
		return
	}

	balance, err := h.creditService.GetBalance(r.Context(), user.ID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "额度查询失败，请稍后重试。")
		return
	}

	response.JSON(w, http.StatusOK, CreditBalanceResponse{Balance: balance})
}

// RedeemRequest represents a code redemption request
type RedeemRequest struct {
	Code string `json:"code"`
}

// RedeemResponse represents the redemption response
type RedeemResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Credits int    `json:"credits,omitempty"`
}

// Redeem handles POST /api/credits/redeem
func (h *CreditsHandler) Redeem(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	if user == nil || user.ID == "" {
		response.Error(w, http.StatusUnauthorized, "请先登录后再兑换额度。")
		return
	}

	// Read raw body for idempotency fingerprint, then restore for JSON decoding
	rawBody, err := io.ReadAll(r.Body)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "无效的请求格式。")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(rawBody))

	var req RedeemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "无效的请求格式。")
		return
	}

	if req.Code == "" {
		response.Error(w, http.StatusBadRequest, "请输入兑换码。")
		return
	}

	if h.redeemService == nil {
		response.Error(w, http.StatusServiceUnavailable, "兑换服务暂时不可用。")
		return
	}
	if h.creditService == nil {
		response.Error(w, http.StatusServiceUnavailable, "额度服务暂时不可用。")
		return
	}

	// --- Idempotency check ---
	idemKey := r.Header.Get("Idempotency-Key")
	if idemKey != "" && h.idempotencySvc != nil {
		outcome, err := h.idempotencySvc.Acquire(r.Context(), user.ID, idemKey, "credit_redeem", rawBody)
		if err != nil {
			log.Printf("[idempotency] acquire error (proceeding without): %v", err)
		} else if outcome != nil {
			if outcome.Conflict {
				response.Error(w, http.StatusConflict, "请求正在处理中或使用相同的幂等键发送了不同的请求。")
				return
			}
			if !outcome.Proceed && outcome.ReplayBody != nil {
				w.Header().Set("X-Idempotent-Replay", "true")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(int(outcome.ReplayCode))
				w.Write(outcome.ReplayBody)
				return
			}
		}
	}

	result, err := h.redeemService.Redeem(r.Context(), user.ID, req.Code)
	if err != nil {
		// System error — mark as failed so client can retry with same key
		if idemKey != "" && h.idempotencySvc != nil {
			h.idempotencySvc.Fail(r.Context(), user.ID, idemKey, "credit_redeem")
		}
		response.Error(w, http.StatusInternalServerError, "兑换失败，请稍后重试。")
		return
	}

	if !result.Success {
		resp := RedeemResponse{Success: false, Message: result.Message}
		// Business-level failure (invalid code, expired, already used) — cache the response
		// so a retry with the same key gets the same "failed" answer without re-querying
		if idemKey != "" && h.idempotencySvc != nil {
			h.idempotencySvc.Complete(r.Context(), user.ID, idemKey, "credit_redeem", 200, resp, "")
		}
		response.JSON(w, http.StatusOK, resp)
		return
	}

	resp := RedeemResponse{Success: true, Message: result.Message, Credits: result.Credits}
	if idemKey != "" && h.idempotencySvc != nil {
		h.idempotencySvc.Complete(r.Context(), user.ID, idemKey, "credit_redeem", 200, resp, "")
	}
	response.JSON(w, http.StatusOK, resp)
}

// RegisterRoutes registers credit routes
func (h *CreditsHandler) RegisterRoutes(r chi.Router) {
	r.Get("/credits", h.GetBalance)
	r.Post("/credits/redeem", h.Redeem)
}
