package service

import (
	"context"
	"fmt"
	"strings"
	"time"

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

const (
	defaultImageProviderTimeout     = 360 * time.Second
	minImageProviderTimeout         = time.Second
	defaultImageProviderTimeoutMS   = int(defaultImageProviderTimeout / time.Millisecond)
	minImageProviderTimeoutMS       = int(minImageProviderTimeout / time.Millisecond)
	imageProviderEncryptedAPIKeySQL = "coalesce(ps.api_key_encrypted, '')"
	imageProviderLegacyAPIKeySQL    = "coalesce(to_jsonb(ps)->>'api_key', '')"
)

var imageProviderQuery = fmt.Sprintf(`
	select
		ps.name,
		ps.base_url,
		%s,
		%s,
		coalesce(ps.image_model, ''),
		coalesce(ps.edit_model, ''),
		ps.timeout_ms,
		ps.retry_count,
		ps.supports_webp_references
	from public.provider_settings ps
	where ps.kind = 'image'
		and ps.enabled = true
		and %s
	order by ps.priority asc, ps.updated_at desc
`, imageProviderEncryptedAPIKeySQL, imageProviderLegacyAPIKeySQL, imageProviderAPIKeyFilterSQL())

func imageProviderAPIKeyFilterSQL() string {
	return fmt.Sprintf("(\n\t\t\t%s <> ''\n\t\t\tor %s <> ''\n\t\t)", imageProviderEncryptedAPIKeySQL, imageProviderLegacyAPIKeySQL)
}

func DefaultImageProviderConfig() ImageProviderConfig {
	return ImageProviderConfig{
		Name:                   "env image provider",
		BaseURL:                strings.TrimRight(config.ImageGenBaseURL, "/"),
		APIKey:                 strings.TrimSpace(config.ImageGenAPIKey),
		ImageModel:             strings.TrimSpace(config.ImageResponsesImageModel),
		EditModel:              strings.TrimSpace(config.ImageResponsesImageModel),
		Timeout:                defaultImageProviderTimeout,
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

	rows, err := s.pool.Query(ctx, imageProviderQuery)
	if err != nil {
		return fallback, err
	}
	defer rows.Close()

	var candidateErr error
	for rows.Next() {
		var cfg ImageProviderConfig
		var timeoutMs int
		var encryptedAPIKey string
		var legacyAPIKey string
		if err := rows.Scan(
			&cfg.Name,
			&cfg.BaseURL,
			&encryptedAPIKey,
			&legacyAPIKey,
			&cfg.ImageModel,
			&cfg.EditModel,
			&timeoutMs,
			&cfg.RetryCount,
			&cfg.SupportsWebpReferences,
		); err != nil {
			return fallback, err
		}

		cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
		cfg.APIKey, err = providerAPIKeyFromSettings(encryptedAPIKey, legacyAPIKey)
		if err != nil {
			candidateErr = err
			continue
		}
		cfg.APIKey = strings.TrimSpace(cfg.APIKey)
		if cfg.APIKey == "" || cfg.BaseURL == "" {
			continue
		}
		cfg.ImageModel = firstNonEmptyProviderSetting(cfg.ImageModel, fallback.ImageModel)
		cfg.EditModel = firstNonEmptyProviderSetting(cfg.EditModel, cfg.ImageModel)
		if timeoutMs < minImageProviderTimeoutMS {
			timeoutMs = defaultImageProviderTimeoutMS
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
	if err := rows.Err(); err != nil {
		return fallback, err
	}
	if fallback.APIKey != "" && fallback.BaseURL != "" {
		return fallback, nil
	}
	if candidateErr != nil {
		return fallback, candidateErr
	}
	return fallback, nil
}

func firstNonEmptyProviderSetting(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func providerAPIKeyFromSettings(encryptedAPIKey, legacyAPIKey string) (string, error) {
	encryptedAPIKey = strings.TrimSpace(encryptedAPIKey)
	legacyAPIKey = strings.TrimSpace(legacyAPIKey)
	if encryptedAPIKey != "" {
		apiKey, err := DecryptProviderSecret(encryptedAPIKey)
		if err == nil && strings.TrimSpace(apiKey) != "" {
			return apiKey, nil
		}
		if err == nil {
			err = ErrProviderCiphertextInvalid
		}
		if legacyAPIKey == "" {
			return "", err
		}
	}
	return legacyAPIKey, nil
}
