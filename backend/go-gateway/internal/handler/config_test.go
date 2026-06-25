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
	if body.AvailableImageModels[0].ID != "gpt-image-2" || body.AvailableImageModels[0].Name != "GPT Image 2" {
		t.Fatalf("unexpected model option: %#v", body.AvailableImageModels[0])
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
