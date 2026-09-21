package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"go-gateway/internal/config"
)

type ProviderSettingsService struct {
	pool *pgxpool.Pool
}

type ImageProviderCompatibilityMode string

const (
	ImageProviderCompatibilityAuto   ImageProviderCompatibilityMode = "auto"
	ImageProviderCompatibilityOpenAI ImageProviderCompatibilityMode = "openai"
	ImageProviderCompatibilityLucen  ImageProviderCompatibilityMode = "lucen"
)

type ImageProviderConfig struct {
	Name       string
	BaseURL    string
	APIKey     string
	ImageModel string
	EditModel  string
	// ImageModels lists the selectable generation models declared by the
	// provider's model_catalog. It is used to route a requested model to the
	// provider that actually offers it.
	ImageModels []string
	// ModelEditModels maps a catalog row id (the generation model the user
	// picked) to that row's edit model. It is consulted first for requests that
	// carry reference images, so a per-row edit model wins over the provider-wide
	// EditModel fallback.
	ModelEditModels        map[string]string
	CompatibilityMode      ImageProviderCompatibilityMode
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
		coalesce(to_jsonb(ps)->>'image_compatibility_mode', 'auto'),
		ps.timeout_ms,
		ps.retry_count,
		ps.supports_webp_references,
		coalesce(ps.model_catalog, '[]'::jsonb)
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
		CompatibilityMode:      ImageProviderCompatibilityAuto,
		Timeout:                defaultImageProviderTimeout,
		RetryCount:             3,
		SupportsWebpReferences: true,
		Source:                 "env",
	}
}

// imageProviderCandidate is one enabled image provider row plus the decoded
// pieces needed to turn it into a usable config.
type imageProviderCandidate struct {
	config            ImageProviderConfig
	encryptedAPIKey   string
	legacyAPIKey      string
	compatibilityMode string
	timeoutMs         int
	models            []string
	editModels        map[string]string
}

func (c imageProviderCandidate) defaultCatalogModel() string {
	if len(c.models) > 0 {
		return c.models[0]
	}
	return ""
}

// ImageProvider 解析应当承载 requestedModel 的图片 Provider。
//
// 路由规则：
//  1. 若 requestedModel 命中了某个 Provider 的 model_catalog 启用项，则由该
//     Provider 承载，并把 ImageModel 设置为请求模型，使生成调用真正使用用户
//     选择的模型。EditModel 不受影响。
//  2. 未命中时回退到优先级最高且可用的 Provider，即历史单 Provider 行为。
//
// 带参考图的请求按「行内优先 → Provider 级兜底 → 生图模型」选择编辑模型：
// ImageModel 对应的目录行若配置了 editModel，就用它（ModelEditModels）；
// 否则回落到 Provider 级 EditModel；两者都没有时行为与历史一致，用生图模型。
// 因此只配置了 Provider 级 edit_model 的老配置行为完全不变。
func (s *ProviderSettingsService) ImageProvider(ctx context.Context, requestedModel string) (ImageProviderConfig, error) {
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
	usable := make([]ImageProviderConfig, 0, 4)
	for rows.Next() {
		candidate, scanErr := scanImageProviderCandidate(rows)
		if scanErr != nil {
			return fallback, scanErr
		}
		cfg, ok, buildErr := buildImageProviderConfig(candidate, fallback)
		if buildErr != nil {
			candidateErr = buildErr
			continue
		}
		if !ok {
			continue
		}
		usable = append(usable, cfg)
	}
	if err := rows.Err(); err != nil {
		return fallback, err
	}
	if selected, ok := selectImageProvider(usable, requestedModel); ok {
		return selected, nil
	}
	if fallback.APIKey != "" && fallback.BaseURL != "" {
		return fallback, nil
	}
	if candidateErr != nil {
		return fallback, candidateErr
	}
	return fallback, nil
}

// selectImageProvider 从「已按优先级排序的可用 Provider」中挑选承载 requestedModel 的那个。
// 命中声明该模型的 Provider 时返回它并覆盖 ImageModel；否则回退到优先级最高的 Provider。
func selectImageProvider(candidates []ImageProviderConfig, requestedModel string) (ImageProviderConfig, bool) {
	if len(candidates) == 0 {
		return ImageProviderConfig{}, false
	}
	requested := strings.TrimSpace(requestedModel)
	if requested != "" {
		for _, candidate := range candidates {
			if declaresImageModel(candidate.ImageModels, requested) {
				candidate.ImageModel = requested
				return candidate, true
			}
		}
	}
	return candidates[0], true
}

func scanImageProviderCandidate(rows pgx.Rows) (imageProviderCandidate, error) {
	var candidate imageProviderCandidate
	var catalog []byte
	if err := rows.Scan(
		&candidate.config.Name,
		&candidate.config.BaseURL,
		&candidate.encryptedAPIKey,
		&candidate.legacyAPIKey,
		&candidate.config.ImageModel,
		&candidate.config.EditModel,
		&candidate.compatibilityMode,
		&candidate.timeoutMs,
		&candidate.config.RetryCount,
		&candidate.config.SupportsWebpReferences,
		&catalog,
	); err != nil {
		return candidate, err
	}
	candidate.models, candidate.editModels = catalogModels(catalog)
	return candidate, nil
}

// catalogModels 从 model_catalog 的原始 jsonb 解出两部分：
//   - 启用行的生成模型 id 列表（用于路由用户请求到正确的 Provider）；
//   - 启用行自己的编辑模型表，键为生成模型 id。
//
// 只有「启用且 editModel 非空」的行才进编辑模型表：停用的行不能把带参考图的
// 请求计费到一个管理员已经关掉的模型上。没有任何编辑模型时返回 nil，调用方据此
// 回落到 Provider 级 EditModel。
func catalogModels(catalog []byte) ([]string, map[string]string) {
	options := parseProviderModelOptions(catalog)
	models := make([]string, 0, len(options))
	editModels := make(map[string]string, len(options))
	for _, entry := range options {
		if !entry.Enabled {
			continue
		}
		id := normalizeModelName(entry.ID, "")
		if id == "" {
			continue
		}
		models = append(models, id)
		if editModel := normalizeModelName(entry.EditModel, ""); editModel != "" {
			editModels[id] = editModel
		}
	}
	if len(editModels) == 0 {
		editModels = nil
	}
	return models, editModels
}

func buildImageProviderConfig(candidate imageProviderCandidate, fallback ImageProviderConfig) (ImageProviderConfig, bool, error) {
	cfg := candidate.config
	cfg.BaseURL = strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	apiKey, err := providerAPIKeyFromSettings(candidate.encryptedAPIKey, candidate.legacyAPIKey)
	if err != nil {
		return cfg, false, err
	}
	cfg.APIKey = strings.TrimSpace(apiKey)
	if cfg.APIKey == "" || cfg.BaseURL == "" {
		return cfg, false, nil
	}
	cfg.ImageModels = candidate.models
	cfg.ModelEditModels = candidate.editModels
	cfg.ImageModel = firstNonEmptyProviderSetting(cfg.ImageModel, candidate.defaultCatalogModel(), fallback.ImageModel)
	cfg.EditModel = firstNonEmptyProviderSetting(cfg.EditModel, cfg.ImageModel)
	cfg.CompatibilityMode = normalizeImageProviderCompatibilityMode(candidate.compatibilityMode)
	timeoutMs := candidate.timeoutMs
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
	return cfg, true, nil
}

func declaresImageModel(models []string, model string) bool {
	for _, candidate := range models {
		if candidate == model {
			return true
		}
	}
	return false
}

func normalizeImageProviderCompatibilityMode(value string) ImageProviderCompatibilityMode {
	switch ImageProviderCompatibilityMode(strings.ToLower(strings.TrimSpace(value))) {
	case ImageProviderCompatibilityOpenAI:
		return ImageProviderCompatibilityOpenAI
	case ImageProviderCompatibilityLucen:
		return ImageProviderCompatibilityLucen
	default:
		return ImageProviderCompatibilityAuto
	}
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
