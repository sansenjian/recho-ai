package handler

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"go-gateway/internal/config"
	"go-gateway/internal/pkg/response"
	"go-gateway/internal/service"
)

type appConfigProvider interface {
	PublicConfig(ctx context.Context) (service.PublicAppConfig, error)
}

type configLogger interface {
	Printf(format string, v ...any)
}

type ConfigHandler struct {
	appSettings appConfigProvider
	logger      configLogger
}

func NewConfigHandler(appSettings appConfigProvider, logger configLogger) *ConfigHandler {
	return &ConfigHandler{appSettings: appSettings, logger: logger}
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
	appConfig := service.DefaultPublicAppConfig()
	if h.appSettings != nil {
		next, err := h.appSettings.PublicConfig(r.Context())
		if err != nil {
			if h.logger != nil {
				h.logger.Printf("Warning: failed to load app settings: %v", err)
			}
		} else {
			appConfig = next
		}
	}
	response.JSON(w, http.StatusOK, appConfig)
}

func (h *ConfigHandler) RegisterRoutes(r chi.Router) {
	r.Get("/config/supabase", h.Supabase)
	r.Get("/config/app", h.App)
}
