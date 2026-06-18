package handler

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/pkg/response"
	"go-gateway/internal/pkg/supabase"
)

// HealthHandler handles health check endpoints
type HealthHandler struct {
	db *supabase.Client
}

// NewHealthHandler creates a new health handler
func NewHealthHandler(db *supabase.Client) *HealthHandler {
	return &HealthHandler{db: db}
}

// HealthResponse represents the health check response
type HealthResponse struct {
	Status    string            `json:"status"`
	Message   string            `json:"message,omitempty"`
	Services  map[string]string `json:"services,omitempty"`
	Timestamp string            `json:"timestamp"`
}

// Health handles GET /health
func (h *HealthHandler) Health(w http.ResponseWriter, r *http.Request) {
	resp := HealthResponse{
		Status:    "ok",
		Message:   "recho-ai go-gateway",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	response.JSON(w, http.StatusOK, resp)
}

// Ready handles GET /ready - checks if the service is ready to accept traffic
func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
	services := make(map[string]string)
	allHealthy := true

	// Check database connection
	if h.db != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		if err := h.db.Ping(ctx); err != nil {
			services["database"] = "unhealthy: " + err.Error()
			allHealthy = false
		} else {
			services["database"] = "healthy"
		}
	} else {
		services["database"] = "not configured"
		allHealthy = false
	}

	status := "ok"
	httpStatus := http.StatusOK
	if !allHealthy {
		status = "degraded"
		httpStatus = http.StatusServiceUnavailable
	}

	resp := HealthResponse{
		Status:    status,
		Services:  services,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	response.JSON(w, httpStatus, resp)
}

// Live handles GET /live - checks if the process is alive
func (h *HealthHandler) Live(w http.ResponseWriter, r *http.Request) {
	resp := HealthResponse{
		Status:    "ok",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}
	response.JSON(w, http.StatusOK, resp)
}

// Root handles GET / - basic info
func (h *HealthHandler) Root(w http.ResponseWriter, r *http.Request) {
	info := map[string]string{
		"service": "recho-ai go-gateway",
		"version": "1.0.0",
		"status":  "running",
	}
	response.JSON(w, http.StatusOK, info)
}

// RegisterRoutes registers health check routes
func (h *HealthHandler) RegisterRoutes(r chi.Router) {
	r.Get("/health", h.Health)
	r.Get("/ready", h.Ready)
	r.Get("/live", h.Live)
	r.Get("/", h.Root)
}
