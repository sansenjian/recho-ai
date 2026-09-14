package service

import (
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"go-gateway/internal/config"
)

func TestParseImageModelOptionsKeepsDatabaseValues(t *testing.T) {
	tests := [][]byte{
		[]byte(`[{"id":"gpt-image-2","name":"GPT Image 2"}]`),
		[]byte(`"[{\"id\":\"gpt-image-2\",\"name\":\"GPT Image 2\"}]"`),
	}

	for _, raw := range tests {
		models := parseImageModelOptions(raw)
		if len(models) != 1 {
			t.Fatalf("expected 1 model for %s, got %#v", string(raw), models)
		}
		if models[0].ID != "gpt-image-2" || models[0].Name != "GPT Image 2" {
			t.Fatalf("unexpected model for %s: %#v", string(raw), models[0])
		}
	}
}

func TestParseImageModelOptionsDoesNotAddFallbackModels(t *testing.T) {
	tests := [][]byte{
		[]byte(`[]`),
		[]byte(`null`),
		[]byte(`[{"id":"","name":"GPT Image 2"}]`),
		[]byte(`not-json`),
	}

	for _, raw := range tests {
		models := parseImageModelOptions(raw)
		if len(models) != 0 {
			t.Fatalf("expected no models for %s, got %#v", string(raw), models)
		}
	}
}

func TestNormalizeModelNameAcceptsChatModelIdentifiers(t *testing.T) {
	for _, model := range []string{"gpt-5.6-sol", "moonshotai/kimi-k2.6", "vendor:model_v1"} {
		if got := normalizeModelName(model, ""); got != model {
			t.Fatalf("expected %q, got %q", model, got)
		}
	}
}

func TestNormalizeModelNameRejectsInvalidLeadingCharacters(t *testing.T) {
	for _, model := range []string{"-gpt-4o", "_gpt-4o", "/vendor/model"} {
		if got := normalizeModelName(model, "fallback"); got != "fallback" {
			t.Fatalf("expected %q to use fallback, got %q", model, got)
		}
	}
}

func TestEnvironmentChatModelsIncludesConfiguredProviders(t *testing.T) {
	original := struct {
		openAIKey, openAIBase, kimiKey, kimiBase string
	}{config.OpenAIAPIKey, config.OpenAIBaseURL, config.KimiAPIKey, config.KimiBaseURL}
	t.Cleanup(func() {
		config.OpenAIAPIKey = original.openAIKey
		config.OpenAIBaseURL = original.openAIBase
		config.KimiAPIKey = original.kimiKey
		config.KimiBaseURL = original.kimiBase
	})

	config.OpenAIAPIKey = "sk-openai"
	config.OpenAIBaseURL = "https://openai.example.test/v1"
	config.KimiAPIKey = "sk-kimi"
	config.KimiBaseURL = "https://kimi.example.test/v1"

	models := environmentChatModels()
	if len(models) != 2 || models[0].ID != "gpt-4o-mini" || models[1].ID != "kimi-k2-0711-preview" {
		t.Fatalf("unexpected environment chat models: %#v", models)
	}
}

func TestEnvironmentImageModelsIncludesConfiguredProvider(t *testing.T) {
	original := struct {
		apiKey, baseURL, model string
	}{config.ImageGenAPIKey, config.ImageGenBaseURL, config.ImageResponsesImageModel}
	t.Cleanup(func() {
		config.ImageGenAPIKey = original.apiKey
		config.ImageGenBaseURL = original.baseURL
		config.ImageResponsesImageModel = original.model
	})

	config.ImageGenAPIKey = "sk-image"
	config.ImageGenBaseURL = "https://image.example.test/v1"
	config.ImageResponsesImageModel = "gpt-image-2.5"

	models := environmentImageModels()
	if len(models) != 1 || models[0].ID != "gpt-image-2.5" {
		t.Fatalf("unexpected environment image models: %#v", models)
	}
}

func TestMergeImageModelsPrefersProviderOrderAndDeduplicates(t *testing.T) {
	got := mergeImageModels(
		[]ImageModelOption{{ID: "gpt-image-2.5", Name: "GPT Image 2.5"}, {ID: "gpt-image-2", Name: ""}},
		[]ImageModelOption{{ID: "gpt-image-2", Name: "GPT Image 2"}, {ID: "gpt-image-1", Name: "GPT Image 1"}},
	)
	want := []ImageModelOption{
		{ID: "gpt-image-2.5", Name: "GPT Image 2.5"},
		{ID: "gpt-image-2", Name: "gpt-image-2"},
		{ID: "gpt-image-1", Name: "GPT Image 1"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("model %d: got %#v, want %#v", i, got[i], want[i])
		}
	}
}

func TestMissingChatModelsSchemaIsBackwardCompatible(t *testing.T) {
	for _, code := range []string{"42703", "42P01"} {
		if !isMissingChatModelsSchema(&pgconn.PgError{Code: code}) {
			t.Fatalf("expected PostgreSQL error %s to be treated as a missing schema", code)
		}
	}
}

func TestParseJSONCreditCostAcceptsNumberAndString(t *testing.T) {
	tests := []struct {
		raw  []byte
		want float64
	}{
		{raw: []byte(`0.75`), want: 0.75},
		{raw: []byte(`"1.25"`), want: 1.25},
		{raw: []byte(`2`), want: 2},
	}

	for _, tt := range tests {
		got := parseJSONCreditCost(tt.raw, 1)
		if got != tt.want {
			t.Fatalf("expected %v for %s, got %v", tt.want, string(tt.raw), got)
		}
	}
}

func TestParseJSONCreditCostFallsBackForInvalidValues(t *testing.T) {
	tests := [][]byte{
		[]byte(`0`),
		[]byte(`-1`),
		[]byte(`"nope"`),
		[]byte(`{}`),
	}

	for _, raw := range tests {
		got := parseJSONCreditCost(raw, 0.5)
		if got != 0.5 {
			t.Fatalf("expected fallback for %s, got %v", string(raw), got)
		}
	}
}

func TestParseJSONCreditCostClampsTinyPositiveValues(t *testing.T) {
	tests := [][]byte{
		[]byte(`0.004`),
		[]byte(`"0.009"`),
	}

	for _, raw := range tests {
		t.Run(string(raw), func(t *testing.T) {
			got := parseJSONCreditCost(raw, 0.5)
			if got != 0.01 {
				t.Fatalf("expected minimum billable cost for %s, got %v", string(raw), got)
			}
		})
	}
}

func TestNormalizePositiveCreditCostFallbackClampsTinyFallback(t *testing.T) {
	got := normalizeImageCreditCostPerImageWithFallback(-1, 0.004)
	if got != 0.01 {
		t.Fatalf("expected tiny fallback to clamp to 0.01, got %v", got)
	}
}
