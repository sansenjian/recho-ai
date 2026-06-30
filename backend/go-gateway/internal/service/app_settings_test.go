package service

import "testing"

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
		got := parseJSONCreditCost(raw, 0.5)
		if got != 0.01 {
			t.Fatalf("expected minimum billable cost for %s, got %v", string(raw), got)
		}
	}
}

func TestNormalizePositiveCreditCostFallbackClampsTinyFallback(t *testing.T) {
	got := normalizeImageCreditCostPerImageWithFallback(-1, 0.004)
	if got != 0.01 {
		t.Fatalf("expected tiny fallback to clamp to 0.01, got %v", got)
	}
}
