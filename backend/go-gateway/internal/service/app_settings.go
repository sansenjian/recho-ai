package service

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"go-gateway/internal/config"
)

type ImageModelOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ChatModelOption struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Provider  string   `json:"provider"`
	Providers []string `json:"providers,omitempty"`
}

type providerModelOption struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

type PublicAppConfig struct {
	ChatModels              []ChatModelOption  `json:"chatModels"`
	ImageEventsEnabled      bool               `json:"imageEventsEnabled"`
	CanvasContextEnabled    bool               `json:"canvasContextEnabled"`
	GuestGenerationEnabled  bool               `json:"guestGenerationEnabled"`
	ImageCreditCostPerImage float64            `json:"imageCreditCostPerImage"`
	// ImageModelCreditCosts 是兜底价之外的按模型覆盖价；未命中覆盖价的模型回退
	// ImageCreditCostPerImage。形状与 Node 侧 publicAppConfig 保持一致（数组）。
	ImageModelCreditCosts []ImageModelCreditCostEntry `json:"imageModelCreditCosts"`
	AvailableImageModels  []ImageModelOption          `json:"availableImageModels"`
	DefaultImageModel     string                      `json:"defaultImageModel"`
}

// ImageModelCreditCostEntry 是「模型 id → 单价」覆盖表对外下发的一项。
type ImageModelCreditCostEntry struct {
	ID   string  `json:"id"`
	Cost float64 `json:"cost"`
}

// imageModelCreditCostEntries 把解析后的覆盖表转成按 id 排序的数组，
// 保证同一份数据每次序列化结果稳定（便于前端 diff 与契约测试）。
func imageModelCreditCostEntries(costs map[string]float64) []ImageModelCreditCostEntry {
	entries := make([]ImageModelCreditCostEntry, 0, len(costs))
	for id, cost := range costs {
		entries = append(entries, ImageModelCreditCostEntry{ID: id, Cost: cost})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	return entries
}

type AppSettingsService struct {
	pool *pgxpool.Pool
}

func NewAppSettingsService(pool *pgxpool.Pool) *AppSettingsService {
	return &AppSettingsService{pool: pool}
}

func DefaultPublicAppConfig() PublicAppConfig {
	return PublicAppConfig{
		ChatModels:              []ChatModelOption{},
		ImageEventsEnabled:      config.ImageEventsEnabled,
		CanvasContextEnabled:    config.CanvasContextEnabled,
		GuestGenerationEnabled:  config.GuestGenerationEnabled,
		ImageCreditCostPerImage: normalizeImageCreditCostPerImage(config.ImageCreditCostPerImage),
		ImageModelCreditCosts:   []ImageModelCreditCostEntry{},
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
			'image_model_credit_costs',
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
		case "image_model_credit_costs":
			if costs := normalizeImageModelCreditCosts(raw); costs != nil {
				cfg.ImageModelCreditCosts = imageModelCreditCostEntries(costs)
			}
		case "image_responses_image_model":
			cfg.DefaultImageModel = parseJSONModelName(raw, cfg.DefaultImageModel)
		case "available_image_models":
			cfg.AvailableImageModels = parseImageModelOptions(raw)
		}
	}
	if err := rows.Err(); err != nil {
		return cfg, err
	}
	rows.Close()

	providerImageModels, imageErr := s.loadImageModels(ctx)
	if imageErr != nil {
		providerImageModels = environmentImageModels()
	}
	cfg.AvailableImageModels = mergeImageModels(providerImageModels, cfg.AvailableImageModels)
	if len(providerImageModels) > 0 {
		cfg.DefaultImageModel = providerImageModels[0].ID
	}

	chatModels, err := s.loadChatModels(ctx)
	if err != nil {
		envModels := environmentChatModels()
		if isMissingChatModelsSchema(err) || len(envModels) > 0 {
			cfg.ChatModels = envModels
			return cfg, nil
		}
		return cfg, err
	}
	cfg.ChatModels = chatModels

	return cfg, nil
}

func isMissingChatModelsSchema(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "42703" || pgErr.Code == "42P01")
}

func (s *AppSettingsService) loadChatModels(ctx context.Context) ([]ChatModelOption, error) {
	envModels := environmentChatModels()
	hasCatalog := true
	rows, err := s.pool.Query(ctx, `
		select name, models, model_catalog, default_model
		from public.provider_settings
		where kind = 'chat'
			and enabled = true
			and coalesce(api_key_encrypted, '') <> ''
		order by priority asc, updated_at desc
	`)
	if err != nil {
		hasCatalog = false
		rows, err = s.pool.Query(ctx, `
			select name, models, default_model
			from public.provider_settings
			where kind = 'chat'
				and enabled = true
				and coalesce(api_key_encrypted, '') <> ''
			order by priority asc, updated_at desc
		`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ChatModelOption, 0, len(envModels))
	seen := make(map[string]int)
	for rows.Next() {
		var provider string
		var models []string
		var catalogRaw []byte
		var defaultModel *string
		if hasCatalog {
			if err := rows.Scan(&provider, &models, &catalogRaw, &defaultModel); err != nil {
				return nil, err
			}
		} else if err := rows.Scan(&provider, &models, &defaultModel); err != nil {
			return nil, err
		}
		entries := parseProviderModelOptions(catalogRaw)
		if len(entries) == 0 {
			if len(models) == 0 && defaultModel != nil {
				models = []string{*defaultModel}
			}
			for _, model := range models {
				entries = append(entries, providerModelOption{ID: model, Name: model, Enabled: true})
			}
		}
		for _, model := range entries {
			if !model.Enabled {
				continue
			}
			id := normalizeModelName(model.ID, "")
			if id == "" {
				continue
			}
			name := strings.TrimSpace(model.Name)
			if name == "" {
				name = id
			}
			key := strings.ToLower(name)
			if index, exists := seen[key]; exists {
				if len(result[index].Providers) == 0 {
					result[index].Providers = []string{result[index].Provider}
				}
				result[index].Providers = append(result[index].Providers, provider)
				result[index].Provider = strings.Join(result[index].Providers, " / ")
				continue
			}
			seen[key] = len(result)
			result = append(result, ChatModelOption{ID: id, Name: name, Provider: provider})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, model := range envModels {
		key := strings.ToLower(strings.TrimSpace(model.Name))
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = len(result)
		result = append(result, model)
	}
	return result, nil
}

func parseProviderModelOptions(raw []byte) []providerModelOption {
	if len(raw) == 0 {
		return nil
	}
	var entries []providerModelOption
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil
	}
	return entries
}

func environmentChatModels() []ChatModelOption {
	providers := []struct {
		apiKey  string
		baseURL string
		name    string
		model   string
	}{
		{config.OpenAIAPIKey, config.OpenAIBaseURL, "Env OpenAI provider", "gpt-4o-mini"},
		{config.KimiAPIKey, config.KimiBaseURL, "Env Kimi provider", "kimi-k2-0711-preview"},
	}

	result := make([]ChatModelOption, 0, len(providers))
	for _, provider := range providers {
		if strings.TrimSpace(provider.apiKey) == "" || strings.TrimSpace(provider.baseURL) == "" {
			continue
		}
		if model := normalizeModelName(provider.model, ""); model != "" {
			result = append(result, ChatModelOption{ID: model, Name: model, Provider: provider.name})
		}
	}
	return result
}

func environmentImageModels() []ImageModelOption {
	model := normalizeModelName(config.ImageResponsesImageModel, "")
	if strings.TrimSpace(config.ImageGenAPIKey) == "" || strings.TrimSpace(config.ImageGenBaseURL) == "" || model == "" {
		return nil
	}
	return []ImageModelOption{{ID: model, Name: model}}
}

func mergeImageModels(primary, fallback []ImageModelOption) []ImageModelOption {
	result := make([]ImageModelOption, 0, len(primary)+len(fallback))
	seen := make(map[string]struct{}, len(primary)+len(fallback))
	for _, model := range append(primary, fallback...) {
		id := normalizeModelName(model.ID, "")
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		name := strings.TrimSpace(model.Name)
		if name == "" {
			name = id
		}
		result = append(result, ImageModelOption{ID: id, Name: name})
	}
	return result
}

// imageModelsForProviderRow resolves the generation models a single provider row
// contributes to the public list.
//
// A catalog that is present is authoritative: when every entry is disabled it
// contributes nothing. Only a row with no catalog at all falls back to its legacy
// single image_model, which keeps pre-catalog configurations working. Keying the
// fallback on "no enabled entry was appended" instead would treat a fully
// disabled catalog as a legacy row and resurrect a model the operator turned off.
func imageModelsForProviderRow(catalog []byte, legacyModel string) []ImageModelOption {
	entries := parseProviderModelOptions(catalog)
	if len(entries) > 0 {
		models := make([]ImageModelOption, 0, len(entries))
		for _, entry := range entries {
			if !entry.Enabled {
				continue
			}
			id := normalizeModelName(entry.ID, "")
			if id == "" {
				continue
			}
			name := strings.TrimSpace(entry.Name)
			if name == "" {
				name = id
			}
			models = append(models, ImageModelOption{ID: id, Name: name})
		}
		return models
	}
	if id := normalizeModelName(legacyModel, ""); id != "" {
		return []ImageModelOption{{ID: id, Name: id}}
	}
	return nil
}

func (s *AppSettingsService) loadImageModels(ctx context.Context) ([]ImageModelOption, error) {
	envModels := environmentImageModels()
	rows, err := s.pool.Query(ctx, `
		select coalesce(ps.model_catalog, '[]'::jsonb), coalesce(ps.image_model, '')
		from public.provider_settings ps
		where ps.kind = 'image'
			and ps.enabled = true
			and (
				coalesce(ps.api_key_encrypted, '') <> ''
				or coalesce(to_jsonb(ps)->>'api_key', '') <> ''
			)
			and (
				coalesce(ps.model_catalog, '[]'::jsonb) <> '[]'::jsonb
				or coalesce(trim(ps.image_model), '') <> ''
			)
		order by ps.priority asc, ps.updated_at desc
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	models := make([]ImageModelOption, 0, len(envModels))
	for rows.Next() {
		var catalog []byte
		var legacyModel string
		if err := rows.Scan(&catalog, &legacyModel); err != nil {
			return nil, err
		}
		models = append(models, imageModelsForProviderRow(catalog, legacyModel)...)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return mergeImageModels(models, envModels), nil
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

// ImageModelCreditCosts 读取「模型 id → 单价」覆盖表；未配置或全部非法时返回 nil。
func (s *AppSettingsService) ImageModelCreditCosts(ctx context.Context) (map[string]float64, error) {
	if s == nil || s.pool == nil {
		return nil, nil
	}

	var raw []byte
	err := s.pool.QueryRow(ctx, `
		select value
		from public.app_settings
		where key = 'image_model_credit_costs'
	`).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return normalizeImageModelCreditCosts(raw), nil
}

// ImageCreditCostPerModel 返回某模型**实际**应使用的每张单价：命中覆盖表就用覆盖价，
// 否则回退到 image_credit_cost_per_image（最终回退环境变量）。
//
// 调用方必须传入「本次生成真正会使用的模型」，否则会出现显示价与扣费价不一致。
func (s *AppSettingsService) ImageCreditCostPerModel(ctx context.Context, model string) (float64, error) {
	base, baseErr := s.ImageCreditCostPerImage(ctx)
	modelID := normalizeModelName(model, "")
	if modelID == "" {
		return base, baseErr
	}

	costs, err := s.ImageModelCreditCosts(ctx)
	if err != nil {
		return base, err
	}
	if cost, ok := costs[modelID]; ok {
		return cost, nil
	}
	return base, baseErr
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

// imageModelCreditCostEntry 用 any 承接字段，便于逐条宽容解析。
type imageModelCreditCostEntry struct {
	ID   any `json:"id"`
	Cost any `json:"cost"`
}

const maxImageModelCreditCostEntries = 200

// normalizeImageModelCreditCosts 解析「模型 id → 单价」覆盖表。
//
// 与 normalizeImageCreditCostPerImageWithFallback 的取舍**故意不同**：单条非法
// （缺 id、id 不合法、价格非数字或低于下限）意味着「该模型没有覆盖价」，于是丢弃这
// 一条让它回退兜底价；而**不是**把非法值钳成默认价，否则一次手滑的输入会静默改变某
// 个模型的真实计费。逐条解析（而不是整体 Unmarshal 进结构体）也是为了一条脏数据不
// 至于让整张表失效。
//
// 空表/无有效项都返回 nil，调用方据此回退兜底价。
func normalizeImageModelCreditCosts(raw []byte) map[string]float64 {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return nil
	}
	// 兼容「JSON 字符串里再套一层数组」的存储写法。
	if text[0] == '"' {
		var inner string
		if err := json.Unmarshal([]byte(text), &inner); err != nil {
			return nil
		}
		return normalizeImageModelCreditCosts([]byte(inner))
	}

	var entries []json.RawMessage
	if err := json.Unmarshal([]byte(text), &entries); err != nil {
		return nil
	}
	result := make(map[string]float64, len(entries))
	for _, rawEntry := range entries {
		var entry imageModelCreditCostEntry
		if err := json.Unmarshal(rawEntry, &entry); err != nil {
			continue
		}
		id, ok := entry.ID.(string)
		if !ok {
			continue
		}
		modelID := normalizeModelName(id, "")
		if modelID == "" {
			continue
		}
		// 同一模型重复出现时以第一条为准，避免表内顺序决定实际计费。
		if _, exists := result[modelID]; exists {
			continue
		}
		cost, ok := creditCostNumber(entry.Cost)
		if !ok || cost < 0.01 {
			continue
		}
		result[modelID] = math.Round(cost*100) / 100
		if len(result) >= maxImageModelCreditCostEntries {
			break
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeImageCreditCostPerImage(value any) float64 {
	return normalizeImageCreditCostPerImageWithFallback(value, 1)
}

// creditCostNumber 把任意来源的额度数值转成 float64。
// 无法解析、NaN/Inf 或非正数时返回 false，由调用方决定是回退还是丢弃。
func creditCostNumber(value any) (float64, bool) {
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
			return 0, false
		}
		number = parsed
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
		if err != nil {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number <= 0 {
		return 0, false
	}
	return number, true
}

func normalizeImageCreditCostPerImageWithFallback(value any, fallback float64) float64 {
	fallback = normalizePositiveCreditCostFallback(fallback)
	number, ok := creditCostNumber(value)
	if !ok {
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
	return normalizeModelName(value, fallback)
}

func normalizeModelName(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 120 {
		return fallback
	}
	first := value[0]
	if !((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') || (first >= '0' && first <= '9')) {
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
