package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"go-gateway/internal/config"
)

type ProviderSettingsService struct {
	pool *pgxpool.Pool
}

type ImageProviderConfig struct {
	Name                   string
	BaseURL                string
	APIKey                 string
	ImageModel             string
	EditModel              string
	Timeout                time.Duration
	RetryCount             int
	SupportsWebpReferences bool
	Source                 string
}

func NewProviderSettingsService(pool *pgxpool.Pool) *ProviderSettingsService {
	return &ProviderSettingsService{pool: pool}
}

func DefaultImageProviderConfig() ImageProviderConfig {
	return ImageProviderConfig{
		Name:                   "env image provider",
		BaseURL:                strings.TrimRight(config.ImageGenBaseURL, "/"),
		APIKey:                 strings.TrimSpace(config.ImageGenAPIKey),
		ImageModel:             strings.TrimSpace(config.ImageResponsesImageModel),
		EditModel:              strings.TrimSpace(config.ImageResponsesImageModel),
		Timeout:                360 * time.Second,
		RetryCount:             3,
		SupportsWebpReferences: true,
		Source:                 "env",
	}
}

func (s *ProviderSettingsService) ImageProvider(ctx context.Context) (ImageProviderConfig, error) {
	fallback := DefaultImageProviderConfig()
	if s == nil || s.pool == nil {
		return fallback, nil
	}

	var cfg ImageProviderConfig
	var timeoutMs int
	var encryptedAPIKey string
	err := s.pool.QueryRow(ctx, `
		select
			name,
			base_url,
			coalesce(api_key_encrypted, ''),
			coalesce(image_model, ''),
			coalesce(edit_model, ''),
			timeout_ms,
			retry_count,
			supports_webp_references
		from public.provider_settings
		where kind = 'image'
			and enabled = true
			and coalesce(api_key_encrypted, '') <> ''
		order by priority asc, updated_at desc
		limit 1
	`).Scan(
		&cfg.Name,
		&cfg.BaseURL,
		&encryptedAPIKey,
		&cfg.ImageModel,
		&cfg.EditModel,
		&timeoutMs,
		&cfg.RetryCount,
		&cfg.SupportsWebpReferences,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fallback, nil
		}
		return fallback, err
	}

	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	cfg.APIKey, err = DecryptProviderSecret(encryptedAPIKey)
	if err != nil {
		return fallback, err
	}
	cfg.APIKey = strings.TrimSpace(cfg.APIKey)
	cfg.ImageModel = firstNonEmptyProviderSetting(cfg.ImageModel, fallback.ImageModel)
	cfg.EditModel = firstNonEmptyProviderSetting(cfg.EditModel, cfg.ImageModel)
	if timeoutMs < 1000 {
		timeoutMs = 360000
	}
	cfg.Timeout = time.Duration(timeoutMs) * time.Millisecond
	if cfg.RetryCount < 0 {
		cfg.RetryCount = 0
	}
	if cfg.RetryCount > 10 {
		cfg.RetryCount = 10
	}
	cfg.Source = "database"
	return cfg, nil
}

func firstNonEmptyProviderSetting(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
