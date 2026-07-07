package service

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"strings"
	"testing"

	"go-gateway/internal/config"
)

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
