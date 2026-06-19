package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/middleware"
	"go-gateway/internal/pkg/response"
	"go-gateway/internal/service"
)

const redeemRequestMaxBytes = 1 * 1024 * 1024

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
	Balance         float64 `json:"balance"`
	RedeemedCredits int     `json:"redeemedCredits"`
}

// Redeem handles POST /api/credits/redeem
func (h *CreditsHandler) Redeem(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	if user == nil || user.ID == "" {
		response.Error(w, http.StatusUnauthorized, "请先登录后再兑换额度。")
		return
	}

	// Read raw body for idempotency fingerprint, then restore for JSON decoding
	body := http.MaxBytesReader(w, r.Body, redeemRequestMaxBytes)
	defer body.Close()
	rawBody, err := io.ReadAll(body)
	if err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			response.Error(w, http.StatusRequestEntityTooLarge, "请求内容过大。")
			return
		}
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
		status, message, businessErr := redeemErrorResponse(err)
		body := map[string]string{"error": message}
		if idemKey != "" && h.idempotencySvc != nil {
			if businessErr && status < 500 {
				h.idempotencySvc.Complete(r.Context(), user.ID, idemKey, "credit_redeem", int16(status), body, "")
			} else {
				h.idempotencySvc.Fail(r.Context(), user.ID, idemKey, "credit_redeem")
			}
		}
		response.Error(w, status, message)
		return
	}

	resp := RedeemResponse{Balance: result.Balance, RedeemedCredits: result.RedeemedCredits}
	if idemKey != "" && h.idempotencySvc != nil {
		h.idempotencySvc.Complete(r.Context(), user.ID, idemKey, "credit_redeem", 200, resp, "")
	}
	response.JSON(w, http.StatusOK, resp)
}

func redeemErrorResponse(err error) (status int, message string, business bool) {
	switch {
	case errors.Is(err, service.ErrInvalidCode):
		return http.StatusBadRequest, "兑换码无效，请检查后重试。", true
	case errors.Is(err, service.ErrCodeAlreadyRedeemed):
		return http.StatusConflict, "这个兑换码已经兑换过。", true
	case errors.Is(err, service.ErrCodeExpired):
		return http.StatusBadRequest, "这个兑换码已过期。", true
	case errors.Is(err, service.ErrCodeDisabled):
		return http.StatusBadRequest, "这个兑换码已停用。", true
	case errors.Is(err, service.ErrCodeExhausted):
		return http.StatusBadRequest, "这个兑换码已被用完。", true
	default:
		log.Printf("[credits] redeem failed: %v", err)
		return http.StatusInternalServerError, "兑换失败，请稍后重试。", false
	}
}

// RegisterRoutes registers credit routes
func (h *CreditsHandler) RegisterRoutes(r chi.Router) {
	r.Get("/credits", h.GetBalance)
	r.Post("/credits/redeem", h.Redeem)
}
