package service

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"go-gateway/internal/config"
)

type ImageModelOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type PublicAppConfig struct {
	ImageEventsEnabled      bool               `json:"imageEventsEnabled"`
	CanvasContextEnabled    bool               `json:"canvasContextEnabled"`
	GuestGenerationEnabled  bool               `json:"guestGenerationEnabled"`
	ImageCreditCostPerImage float64            `json:"imageCreditCostPerImage"`
	AvailableImageModels    []ImageModelOption `json:"availableImageModels"`
	DefaultImageModel       string             `json:"defaultImageModel"`
}

type AppSettingsService struct {
	pool *pgxpool.Pool
}

func NewAppSettingsService(pool *pgxpool.Pool) *AppSettingsService {
	return &AppSettingsService{pool: pool}
}

func DefaultPublicAppConfig() PublicAppConfig {
	return PublicAppConfig{
		ImageEventsEnabled:      config.ImageEventsEnabled,
		CanvasContextEnabled:    config.CanvasContextEnabled,
		GuestGenerationEnabled:  config.GuestGenerationEnabled,
		ImageCreditCostPerImage: normalizeImageCreditCostPerImage(config.ImageCreditCostPerImage),
		AvailableImageModels:    []ImageModelOption{},
		DefaultImageModel:       config.ImageResponsesImageModel,
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
			'image_credit_cost_per_image',
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
		case "image_credit_cost_per_image":
			cfg.ImageCreditCostPerImage = parseJSONCreditCost(raw, cfg.ImageCreditCostPerImage)
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

func (s *AppSettingsService) ImageCreditCostPerImage(ctx context.Context) (float64, error) {
	fallback := normalizeImageCreditCostPerImage(config.ImageCreditCostPerImage)
	if s == nil || s.pool == nil {
		return fallback, nil
	}

	var raw []byte
	err := s.pool.QueryRow(ctx, `
		select value
		from public.app_settings
		where key = 'image_credit_cost_per_image'
	`).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fallback, nil
		}
		return fallback, err
	}
	return parseJSONCreditCost(raw, fallback), nil
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

func parseJSONCreditCost(raw []byte, fallback float64) float64 {
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		return normalizeImageCreditCostPerImageWithFallback(number, fallback)
	}

	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return fallback
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	if err != nil {
		return fallback
	}
	return normalizeImageCreditCostPerImageWithFallback(parsed, fallback)
}

func normalizeImageCreditCostPerImage(value any) float64 {
	return normalizeImageCreditCostPerImageWithFallback(value, 1)
}

func normalizeImageCreditCostPerImageWithFallback(value any, fallback float64) float64 {
	fallback = normalizePositiveCreditCostFallback(fallback)
	var number float64
	switch v := value.(type) {
	case float64:
		number = v
	case float32:
		number = float64(v)
	case int:
		number = float64(v)
	case int64:
		number = float64(v)
	case json.Number:
		parsed, err := v.Float64()
		if err != nil {
			return fallback
		}
		number = parsed
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil {
			return fallback
		}
		number = parsed
	default:
		return fallback
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number <= 0 {
		return fallback
	}
	if number < 0.01 {
		return 0.01
	}
	return math.Round(number*100) / 100
}

func normalizePositiveCreditCostFallback(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return 1
	}
	if value < 0.01 {
		return 0.01
	}
	return math.Round(value*100) / 100
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
