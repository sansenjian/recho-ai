package service

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"strings"
	"testing"

	"go-gateway/internal/config"
)

func TestNormalizeImageProviderCompatibilityMode(t *testing.T) {
	tests := []struct {
		input string
		want  ImageProviderCompatibilityMode
	}{
		{input: "auto", want: ImageProviderCompatibilityAuto},
		{input: "openai", want: ImageProviderCompatibilityOpenAI},
		{input: "lucen", want: ImageProviderCompatibilityLucen},
		{input: "", want: ImageProviderCompatibilityAuto},
		{input: "unsupported", want: ImageProviderCompatibilityAuto},
	}

	for _, tt := range tests {
		if got := normalizeImageProviderCompatibilityMode(tt.input); got != tt.want {
			t.Fatalf("normalizeImageProviderCompatibilityMode(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestImageProviderQueryAllowsLegacyPlaintextAPIKey(t *testing.T) {
	filter := imageProviderAPIKeyFilterSQL()
	encryptedCheck := imageProviderEncryptedAPIKeySQL + " <> ''"
	legacyCheck := imageProviderLegacyAPIKeySQL + " <> ''"

	if !strings.Contains(filter, encryptedCheck) {
		t.Fatalf("expected provider filter to include encrypted key check %q, got %q", encryptedCheck, filter)
	}
	if !strings.Contains(filter, "\n\t\t\tor "+legacyCheck) {
		t.Fatalf("expected provider filter to OR legacy key check %q, got %q", legacyCheck, filter)
	}
	if strings.Contains(filter, "\n\t\t\tand "+legacyCheck) {
		t.Fatalf("provider filter must not require encrypted and legacy keys together: %q", filter)
	}
	if !strings.Contains(imageProviderQuery, filter) {
		t.Fatal("expected image provider query to use the shared API key filter")
	}
}

func TestProviderAPIKeyFromSettingsUsesLegacyPlaintextWhenEncryptedKeyMissing(t *testing.T) {
	got, err := providerAPIKeyFromSettings("", " legacy-key ")
	if err != nil {
		t.Fatalf("providerAPIKeyFromSettings returned error: %v", err)
	}
	if got != "legacy-key" {
		t.Fatalf("expected legacy plaintext key, got %q", got)
	}
}

func TestProviderAPIKeyFromSettingsPrefersEncryptedKey(t *testing.T) {
	previous := config.ProviderAPIKeyMasterKey
	config.ProviderAPIKeyMasterKey = "0123456789abcdef0123456789abcdef"
	t.Cleanup(func() {
		config.ProviderAPIKeyMasterKey = previous
	})

	got, err := providerAPIKeyFromSettings(
		"v1.aes-256-gcm.bm9kZS1nb2xhbmcx.gYPiGuqv2_PnwWxsr0mzqQ.xrKl0I6kinKSkdGI0v3Wog",
		"legacy-key",
	)
	if err != nil {
		t.Fatalf("providerAPIKeyFromSettings returned error: %v", err)
	}
	if got != "sk-cross-runtime" {
		t.Fatalf("expected decrypted key, got %q", got)
	}
}

func TestProviderAPIKeyFromSettingsFallsBackToLegacyWhenEncryptedKeyIsInvalid(t *testing.T) {
	got, err := providerAPIKeyFromSettings("not-a-valid-ciphertext", "legacy-key")
	if err != nil {
		t.Fatalf("providerAPIKeyFromSettings returned error: %v", err)
	}
	if got != "legacy-key" {
		t.Fatalf("expected legacy plaintext key, got %q", got)
	}
}

func TestProviderAPIKeyFromSettingsReturnsErrorWhenEncryptedKeyInvalidWithoutLegacy(t *testing.T) {
	got, err := providerAPIKeyFromSettings("not-a-valid-ciphertext", "")
	if err == nil {
		t.Fatal("expected invalid encrypted key to return an error")
	}
	if got != "" {
		t.Fatalf("expected empty key on error, got %q", got)
	}
}

func TestProviderAPIKeyFromSettingsReturnsErrorWhenEncryptedKeyDecryptsBlankWithoutLegacy(t *testing.T) {
	previous := config.ProviderAPIKeyMasterKey
	config.ProviderAPIKeyMasterKey = "0123456789abcdef0123456789abcdef"
	t.Cleanup(func() {
		config.ProviderAPIKeyMasterKey = previous
	})

	got, err := providerAPIKeyFromSettings(encryptedProviderSecretForTest(t, "   "), "")
	if err == nil {
		t.Fatal("expected blank decrypted key to return an error")
	}
	if got != "" {
		t.Fatalf("expected empty key on error, got %q", got)
	}
}

func encryptedProviderSecretForTest(t *testing.T, plaintext string) string {
	t.Helper()

	key, err := decodeProviderMasterKey(config.ProviderAPIKeyMasterKey)
	if err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	iv := []byte("test-iv-1234")
	sealed := aead.Seal(nil, iv, []byte(plaintext), nil)
	tagStart := len(sealed) - aead.Overhead()
	return strings.Join([]string{
		providerSecretPrefix,
		base64.RawURLEncoding.EncodeToString(iv),
		base64.RawURLEncoding.EncodeToString(sealed[tagStart:]),
		base64.RawURLEncoding.EncodeToString(sealed[:tagStart]),
	}, ".")
}

func TestImageProviderQuerySelectsModelCatalog(t *testing.T) {
	if !strings.Contains(imageProviderQuery, "coalesce(ps.model_catalog, '[]'::jsonb)") {
		t.Fatalf("expected image provider query to select the model catalog, got %q", imageProviderQuery)
	}
}

func TestDeclaresImageModel(t *testing.T) {
	models := []string{"gpt-image-2", "gpt-image-1.5"}

	if !declaresImageModel(models, "gpt-image-1.5") {
		t.Fatal("expected gpt-image-1.5 to be declared by the provider catalog")
	}
	if declaresImageModel(models, "gpt-image-3") {
		t.Fatal("expected an undeclared model to fall through to the priority default")
	}
	if declaresImageModel(nil, "gpt-image-2") {
		t.Fatal("expected an empty catalog to declare nothing")
	}
}

func TestImageProviderCandidateDefaultCatalogModel(t *testing.T) {
	if got := (imageProviderCandidate{}).defaultCatalogModel(); got != "" {
		t.Fatalf("expected empty default for a catalog-less provider, got %q", got)
	}
	candidate := imageProviderCandidate{models: []string{"first", "second"}}
	if got := candidate.defaultCatalogModel(); got != "first" {
		t.Fatalf("expected first catalog model, got %q", got)
	}
}

func TestBuildImageProviderConfigFallsBackToFirstCatalogModel(t *testing.T) {
	candidate := imageProviderCandidate{
		config: ImageProviderConfig{
			Name:       "provider",
			BaseURL:    "https://provider.example/v1/",
			ImageModel: "",
			EditModel:  "provider-edit-model",
			RetryCount: 3,
		},
		legacyAPIKey:      "legacy-key",
		compatibilityMode: "auto",
		timeoutMs:         defaultImageProviderTimeoutMS,
		models:            []string{"model-one", "model-two"},
	}

	cfg, usable, err := buildImageProviderConfig(candidate, DefaultImageProviderConfig())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !usable {
		t.Fatal("expected a provider with base URL and API key to be usable")
	}
	if cfg.BaseURL != "https://provider.example/v1" {
		t.Fatalf("expected trailing slash to be trimmed, got %q", cfg.BaseURL)
	}
	if cfg.ImageModel != "model-one" {
		t.Fatalf("expected the first catalog model as default, got %q", cfg.ImageModel)
	}
	if cfg.EditModel != "provider-edit-model" {
		t.Fatalf("expected edit_model to stay untouched, got %q", cfg.EditModel)
	}
	if len(cfg.ImageModels) != 2 {
		t.Fatalf("expected 2 declared models, got %#v", cfg.ImageModels)
	}
	if cfg.Source != "database" {
		t.Fatalf("expected database source, got %q", cfg.Source)
	}
}

func TestBuildImageProviderConfigRejectsProviderWithoutCredentials(t *testing.T) {
	candidate := imageProviderCandidate{
		config:    ImageProviderConfig{Name: "provider", BaseURL: "https://provider.example/v1"},
		timeoutMs: defaultImageProviderTimeoutMS,
		models:    []string{"model-one"},
	}

	_, usable, err := buildImageProviderConfig(candidate, DefaultImageProviderConfig())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if usable {
		t.Fatal("expected a provider without an API key to be skipped")
	}
}

func TestSelectImageProviderRoutesRequestedModelToOwningProvider(t *testing.T) {
	candidates := []ImageProviderConfig{
		{Name: "primary", ImageModel: "model-one", EditModel: "primary-edit", ImageModels: []string{"model-one"}},
		{Name: "secondary", ImageModel: "model-two", EditModel: "secondary-edit", ImageModels: []string{"model-two", "model-three"}},
	}

	got, ok := selectImageProvider(candidates, "model-three")
	if !ok {
		t.Fatal("expected a provider to be selected")
	}
	if got.Name != "secondary" {
		t.Fatalf("expected the secondary provider to own model-three, got %q", got.Name)
	}
	if got.ImageModel != "model-three" {
		t.Fatalf("expected ImageModel to be the requested model, got %q", got.ImageModel)
	}
	if got.EditModel != "secondary-edit" {
		t.Fatalf("expected EditModel to stay untouched, got %q", got.EditModel)
	}
}

func TestSelectImageProviderFallsBackToHighestPriority(t *testing.T) {
	candidates := []ImageProviderConfig{
		{Name: "primary", ImageModel: "model-one", ImageModels: []string{"model-one"}},
		{Name: "secondary", ImageModel: "model-two", ImageModels: []string{"model-two"}},
	}

	for _, requested := range []string{"", "model-unknown"} {
		got, ok := selectImageProvider(candidates, requested)
		if !ok {
			t.Fatalf("expected a fallback provider for requested model %q", requested)
		}
		if got.Name != "primary" {
			t.Fatalf("expected the highest priority provider for %q, got %q", requested, got.Name)
		}
		if got.ImageModel != "model-one" {
			t.Fatalf("expected the provider default model for %q, got %q", requested, got.ImageModel)
		}
	}
}

func TestSelectImageProviderHandlesCatalogLessProviders(t *testing.T) {
	candidates := []ImageProviderConfig{
		{Name: "legacy", ImageModel: "legacy-model"},
	}

	got, ok := selectImageProvider(candidates, "legacy-model")
	if !ok {
		t.Fatal("expected a legacy provider to still be selectable")
	}
	if got.ImageModel != "legacy-model" {
		t.Fatalf("expected the legacy provider default model, got %q", got.ImageModel)
	}

	if _, ok := selectImageProvider(nil, "anything"); ok {
		t.Fatal("expected no selection when no usable provider exists")
	}
}

func TestCatalogModelsCollectsPerRowEditModels(t *testing.T) {
	catalog := []byte(`[
		{"id":"gpt-image-2","name":"GPT Image 2","enabled":true,"editModel":"gpt-image-2-edit"},
		{"id":"flux-pro","name":"FLUX Pro","enabled":true},
		{"id":"retired-model","name":"Retired","enabled":false,"editModel":"retired-edit"}
	]`)

	models, editModels := catalogModels(catalog)
	if len(models) != 2 || models[0] != "gpt-image-2" || models[1] != "flux-pro" {
		t.Fatalf("unexpected models: %#v", models)
	}
	if len(editModels) != 1 || editModels["gpt-image-2"] != "gpt-image-2-edit" {
		t.Fatalf("unexpected per-row edit models: %#v", editModels)
	}
	// 停用的行不得贡献编辑模型，否则会把带参考图的请求计费到管理员已关掉的模型上。
	if _, exists := editModels["retired-model"]; exists {
		t.Fatalf("disabled rows must not contribute an edit model: %#v", editModels)
	}
}

func TestCatalogModelsSkipsRowsWithoutAnEditModel(t *testing.T) {
	models, editModels := catalogModels([]byte(`[{"id":"gpt-image-2","enabled":true},{"id":"flux-pro","enabled":true,"editModel":"  "}]`))
	if len(models) != 2 {
		t.Fatalf("unexpected models: %#v", models)
	}
	if editModels != nil {
		t.Fatalf("expected nil edit models when no row configures one, got %#v", editModels)
	}

	if _, unparsable := catalogModels([]byte(`not-json`)); unparsable != nil {
		t.Fatalf("expected nil edit models for an unparsable catalog, got %#v", unparsable)
	}
}

func TestCatalogTransparentModelsRequiresAnEnabledDeclaration(t *testing.T) {
	catalog := []byte(`[
		{"id":"gpt-image-2.5-sunburst","name":"Sunburst","enabled":true,"supportsTransparent":true},
		{"id":"gpt-image-2.5-flare","name":"Flare","enabled":true},
		{"id":"retired-model","name":"Retired","enabled":false,"supportsTransparent":true}
	]`)

	transparent := catalogTransparentModels(catalog)
	if len(transparent) != 1 || !transparent["gpt-image-2.5-sunburst"] {
		t.Fatalf("unexpected transparent models: %#v", transparent)
	}
	// 停用行不能再让请求带上 background: transparent，没勾选的行同理。
	if transparent["retired-model"] || transparent["gpt-image-2.5-flare"] {
		t.Fatalf("only enabled declared rows may output transparency: %#v", transparent)
	}
	if none := catalogTransparentModels([]byte(`not-json`)); none != nil {
		t.Fatalf("expected nil transparent models for an unparsable catalog, got %#v", none)
	}
}

func TestBuildImageProviderConfigFillsTransparentModels(t *testing.T) {
	models, editModels := catalogModels([]byte(`[{"id":"model-one","enabled":true}]`))
	transparentModels := catalogTransparentModels([]byte(`[
		{"id":"model-one","enabled":true,"supportsTransparent":true},
		{"id":"model-two","enabled":true}
	]`))
	candidate := imageProviderCandidate{
		config: ImageProviderConfig{
			Name:       "provider",
			BaseURL:    "https://provider.example/v1/",
			ImageModel: "",
			RetryCount: 3,
		},
		legacyAPIKey:      "legacy-key",
		compatibilityMode: "auto",
		timeoutMs:         defaultImageProviderTimeoutMS,
		models:            models,
		editModels:        editModels,
		transparentModels: transparentModels,
	}

	cfg, usable, err := buildImageProviderConfig(candidate, DefaultImageProviderConfig())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !usable {
		t.Fatal("expected a provider with base URL and API key to be usable")
	}
	if !cfg.ModelSupportsTransparent["model-one"] {
		t.Fatalf("expected the declared transparent model to be carried over, got %#v", cfg.ModelSupportsTransparent)
	}
	if cfg.ModelSupportsTransparent["model-two"] {
		t.Fatalf("rows without the capability must not be carried over: %#v", cfg.ModelSupportsTransparent)
	}
}

func TestBuildImageProviderConfigFillsModelEditModels(t *testing.T) {
	models, editModels := catalogModels([]byte(`[
		{"id":"model-one","enabled":true,"editModel":"row-edit"},
		{"id":"model-two","enabled":true,"editModel":""}
	]`))
	candidate := imageProviderCandidate{
		config: ImageProviderConfig{
			Name:       "provider",
			BaseURL:    "https://provider.example/v1/",
			ImageModel: "",
			EditModel:  "provider-edit-model",
			RetryCount: 3,
		},
		legacyAPIKey:      "legacy-key",
		compatibilityMode: "auto",
		timeoutMs:         defaultImageProviderTimeoutMS,
		models:            models,
		editModels:        editModels,
	}

	cfg, usable, err := buildImageProviderConfig(candidate, DefaultImageProviderConfig())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !usable {
		t.Fatal("expected a provider with base URL and API key to be usable")
	}
	if len(cfg.ModelEditModels) != 1 || cfg.ModelEditModels["model-one"] != "row-edit" {
		t.Fatalf("expected the per-row edit model to be filled, got %#v", cfg.ModelEditModels)
	}
	// Provider 级 EditModel 仍是行内未配置时的兜底，不能被目录改写。
	if cfg.EditModel != "provider-edit-model" {
		t.Fatalf("expected the provider-level edit_model to stay untouched, got %q", cfg.EditModel)
	}
}
