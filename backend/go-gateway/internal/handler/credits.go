package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/middleware"
	"go-gateway/internal/pkg/response"
	"go-gateway/internal/service"
)

// CreditsHandler handles credit-related endpoints
type CreditsHandler struct {
	creditService *service.CreditService
	redeemService *service.RedeemService
}

// NewCreditsHandler creates a new credits handler
func NewCreditsHandler(creditService *service.CreditService, redeemService *service.RedeemService) *CreditsHandler {
	return &CreditsHandler{
		creditService: creditService,
		redeemService: redeemService,
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
	Success bool    `json:"success"`
	Message string  `json:"message"`
	Credits int     `json:"credits,omitempty"`
}

// Redeem handles POST /api/credits/redeem
func (h *CreditsHandler) Redeem(w http.ResponseWriter, r *http.Request) {
	user := middleware.GetUserFromRequest(r)
	if user == nil || user.ID == "" {
		response.Error(w, http.StatusUnauthorized, "请先登录后再兑换额度。")
		return
	}

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

	result, err := h.redeemService.Redeem(r.Context(), user.ID, req.Code)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "兑换失败，请稍后重试。")
		return
	}

	if !result.Success {
		response.JSON(w, http.StatusOK, RedeemResponse{
			Success: false,
			Message: result.Message,
		})
		return
	}

	response.JSON(w, http.StatusOK, RedeemResponse{
		Success: true,
		Message: result.Message,
		Credits: result.Credits,
	})
}

// RegisterRoutes registers credit routes
func (h *CreditsHandler) RegisterRoutes(r chi.Router) {
	r.Get("/credits", h.GetBalance)
	r.Post("/credits/redeem", h.Redeem)
}
