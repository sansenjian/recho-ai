package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"go-gateway/internal/config"
)

type ImageModelOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type PublicAppConfig struct {
	ImageEventsEnabled     bool               `json:"imageEventsEnabled"`
	CanvasContextEnabled   bool               `json:"canvasContextEnabled"`
	GuestGenerationEnabled bool               `json:"guestGenerationEnabled"`
	AvailableImageModels   []ImageModelOption `json:"availableImageModels"`
	DefaultImageModel      string             `json:"defaultImageModel"`
}

type AppSettingsService struct {
	pool *pgxpool.Pool
}

func NewAppSettingsService(pool *pgxpool.Pool) *AppSettingsService {
	return &AppSettingsService{pool: pool}
}

func DefaultPublicAppConfig() PublicAppConfig {
	return PublicAppConfig{
		ImageEventsEnabled:     config.ImageEventsEnabled,
		CanvasContextEnabled:   config.CanvasContextEnabled,
		GuestGenerationEnabled: config.GuestGenerationEnabled,
		AvailableImageModels:   []ImageModelOption{},
		DefaultImageModel:      config.ImageResponsesImageModel,
	}
}

func (s *AppSettingsService) PublicConfig(ctx context.Context) (PublicAppConfig, error) {
	cfg := DefaultPublicAppConfig()
	if s == nil || s.pool == nil {
		return cfg, nil
	}

	rows, err := s.pool.Query(ctx, `
		select key, value
		from public.app_settings
		where key in (
			'image_events_enabled',
			'canvas_context_enabled',
			'guest_generation_enabled',
			'image_responses_image_model',
			'available_image_models'
		)
	`)
	if err != nil {
		return cfg, err
	}
	defer rows.Close()

	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return cfg, err
		}

		switch key {
		case "image_events_enabled":
			cfg.ImageEventsEnabled = parseJSONBool(raw, cfg.ImageEventsEnabled)
		case "canvas_context_enabled":
			cfg.CanvasContextEnabled = parseJSONBool(raw, cfg.CanvasContextEnabled)
		case "guest_generation_enabled":
			cfg.GuestGenerationEnabled = parseJSONBool(raw, cfg.GuestGenerationEnabled)
		case "image_responses_image_model":
			cfg.DefaultImageModel = parseJSONModelName(raw, cfg.DefaultImageModel)
		case "available_image_models":
			cfg.AvailableImageModels = parseImageModelOptions(raw)
		}
	}
	if err := rows.Err(); err != nil {
		return cfg, err
	}

	return cfg, nil
}

func parseJSONBool(raw []byte, fallback bool) bool {
	var value bool
	if err := json.Unmarshal(raw, &value); err == nil {
		return value
	}

	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return fallback
	}
	switch strings.ToLower(strings.TrimSpace(text)) {
	case "true":
		return true
	case "false":
		return false
	default:
		return fallback
	}
}

func parseJSONModelName(raw []byte, fallback string) string {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return fallback
	}
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 120 {
		return fallback
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			continue
		}
		switch r {
		case '.', '_', ':', '/', '-':
			continue
		default:
			return fallback
		}
	}
	return value
}

func parseImageModelOptions(raw []byte) []ImageModelOption {
	var values []ImageModelOption
	if err := json.Unmarshal(raw, &values); err != nil {
		var encoded string
		if stringErr := json.Unmarshal(raw, &encoded); stringErr != nil {
			return []ImageModelOption{}
		}
		if err := json.Unmarshal([]byte(encoded), &values); err != nil {
			return []ImageModelOption{}
		}
	}

	result := make([]ImageModelOption, 0, len(values))
	for _, item := range values {
		id := strings.TrimSpace(item.ID)
		if id == "" {
			continue
		}
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = id
		}
		result = append(result, ImageModelOption{ID: id, Name: name})
	}
	return result
}
