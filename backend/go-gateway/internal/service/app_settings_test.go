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
