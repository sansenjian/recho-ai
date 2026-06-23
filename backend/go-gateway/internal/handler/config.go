package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/config"
	"go-gateway/internal/pkg/response"
)

type ConfigHandler struct{}

func NewConfigHandler() *ConfigHandler {
	return &ConfigHandler{}
}

func (h *ConfigHandler) Supabase(w http.ResponseWriter, r *http.Request) {
	configured := config.SupabaseURL != "" && config.SupabasePublishableKey != ""
	body := map[string]any{
		"configured":     configured,
		"url":            nil,
		"publishableKey": nil,
	}
	if configured {
		body["url"] = config.SupabaseURL
		body["publishableKey"] = config.SupabasePublishableKey
	}
	response.JSON(w, http.StatusOK, body)
}

func (h *ConfigHandler) App(w http.ResponseWriter, r *http.Request) {
	response.JSON(w, http.StatusOK, map[string]any{
		"imageEventsEnabled":     config.ImageEventsEnabled,
		"canvasContextEnabled":   config.CanvasContextEnabled,
		"guestGenerationEnabled": config.GuestGenerationEnabled,
		"availableImageModels":   []any{},
		"defaultImageModel":      config.ImageResponsesImageModel,
	})
}

func (h *ConfigHandler) RegisterRoutes(r chi.Router) {
	r.Get("/config/supabase", h.Supabase)
	r.Get("/config/app", h.App)
}
