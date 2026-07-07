package service

import (
	"strings"
	"testing"

	"go-gateway/internal/config"
)

func TestImageProviderQueryAllowsLegacyPlaintextAPIKey(t *testing.T) {
	if !strings.Contains(imageProviderQuery, "to_jsonb(ps)->>'api_key'") {
		t.Fatal("expected image provider query to read legacy provider_settings.api_key without requiring the column to exist")
	}
	if strings.Contains(imageProviderQuery, "and coalesce(api_key_encrypted, '') <> ''") {
		t.Fatal("image provider query must not exclude legacy plaintext api_key rows")
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
