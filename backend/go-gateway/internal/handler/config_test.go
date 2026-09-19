package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"go-gateway/internal/service"
)

type stubAppConfigProvider struct {
	config service.PublicAppConfig
	err    error
}

func (s *stubAppConfigProvider) PublicConfig(ctx context.Context) (service.PublicAppConfig, error) {
	return s.config, s.err
}

type stubLogger struct {
	called bool
	format string
	args   []interface{}
}

func (l *stubLogger) Printf(format string, v ...interface{}) {
	l.called = true
	l.format = format
	l.args = v
}

func TestConfigAppUsesAppSettingsProvider(t *testing.T) {
	h := NewConfigHandler(&stubAppConfigProvider{
		config: service.PublicAppConfig{
			ChatModels: []service.ChatModelOption{{
				ID:       "gpt-5.6-sol",
				Name:     "gpt-5.6-sol",
				Provider: "Custom Chat",
			}},
			ImageEventsEnabled:     true,
			CanvasContextEnabled:   true,
			GuestGenerationEnabled: false,
			AvailableImageModels: []service.ImageModelOption{{
				ID:   "gpt-image-2",
				Name: "GPT Image 2",
			}},
			DefaultImageModel: "gpt-image-2",
		},
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/config/app", nil)
	res := httptest.NewRecorder()

	h.App(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var body service.PublicAppConfig
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.AvailableImageModels) != 1 {
		t.Fatalf("expected 1 image model from provider, got %#v", body.AvailableImageModels)
	}
	if len(body.ChatModels) != 1 || body.ChatModels[0].ID != "gpt-5.6-sol" {
		t.Fatalf("unexpected chat models: %#v", body.ChatModels)
	}
	if body.AvailableImageModels[0].ID != "gpt-image-2" || body.AvailableImageModels[0].Name != "GPT Image 2" {
		t.Fatalf("unexpected model option: %#v", body.AvailableImageModels[0])
	}
}

// TestDefaultAppConfigExposesEmptyPerModelCostsArray 固定公共配置里按模型定价的
// JSON 形状：始终是数组（空时为 []），客户端与契约测试可依赖该形状。
func TestDefaultAppConfigExposesEmptyPerModelCostsArray(t *testing.T) {
	payload, err := json.Marshal(service.DefaultPublicAppConfig())
	if err != nil {
		t.Fatal(err)
	}

	var body map[string]json.RawMessage
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatal(err)
	}
	raw, ok := body["imageModelCreditCosts"]
	if !ok {
		t.Fatal("expected imageModelCreditCosts in the public app config")
	}
	if string(raw) != "[]" {
		t.Fatalf("expected empty array shape, got %s", string(raw))
	}
}

func TestConfigAppFallsBackWithoutHardcodedModels(t *testing.T) {
	h := NewConfigHandler(&stubAppConfigProvider{err: errors.New("database unavailable")}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/config/app", nil)
	res := httptest.NewRecorder()

	h.App(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var body service.PublicAppConfig
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.AvailableImageModels) != 0 {
		t.Fatalf("expected no fallback image models, got %#v", body.AvailableImageModels)
	}
	if len(body.ChatModels) != 0 {
		t.Fatalf("expected no fallback chat models, got %#v", body.ChatModels)
	}
}

func TestConfigAppDefaultsWhenAppSettingsNil(t *testing.T) {
	h := NewConfigHandler(nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/config/app", nil)
	res := httptest.NewRecorder()

	h.App(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	var got service.PublicAppConfig
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	want := service.DefaultPublicAppConfig()
	if got.ImageEventsEnabled != want.ImageEventsEnabled {
		t.Errorf("ImageEventsEnabled: got %v, want %v", got.ImageEventsEnabled, want.ImageEventsEnabled)
	}
	if got.CanvasContextEnabled != want.CanvasContextEnabled {
		t.Errorf("CanvasContextEnabled: got %v, want %v", got.CanvasContextEnabled, want.CanvasContextEnabled)
	}
	if got.GuestGenerationEnabled != want.GuestGenerationEnabled {
		t.Errorf("GuestGenerationEnabled: got %v, want %v", got.GuestGenerationEnabled, want.GuestGenerationEnabled)
	}
	if got.DefaultImageModel != want.DefaultImageModel {
		t.Errorf("DefaultImageModel: got %q, want %q", got.DefaultImageModel, want.DefaultImageModel)
	}
	if len(got.AvailableImageModels) != len(want.AvailableImageModels) {
		t.Errorf("AvailableImageModels length: got %d, want %d", len(got.AvailableImageModels), len(want.AvailableImageModels))
	}
	if len(got.ChatModels) != len(want.ChatModels) {
		t.Errorf("ChatModels length: got %d, want %d", len(got.ChatModels), len(want.ChatModels))
	}
}

func TestConfigAppLogsErrorWhenProviderFails(t *testing.T) {
	providerErr := errors.New("provider failure")
	logger := &stubLogger{}

	h := NewConfigHandler(&stubAppConfigProvider{err: providerErr}, logger)

	req := httptest.NewRequest(http.MethodGet, "/api/config/app", nil)
	res := httptest.NewRecorder()

	h.App(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", res.Code, res.Body.String())
	}

	if !logger.called {
		t.Errorf("expected logger.Printf to be called when PublicConfig returns an error")
	}
}
