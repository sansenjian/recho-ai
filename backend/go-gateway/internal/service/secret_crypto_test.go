package service

import (
	"testing"

	"go-gateway/internal/config"
)

func TestDecryptProviderSecret(t *testing.T) {
	previous := config.ProviderAPIKeyMasterKey
	config.ProviderAPIKeyMasterKey = "0123456789abcdef0123456789abcdef"
	t.Cleanup(func() {
		config.ProviderAPIKeyMasterKey = previous
	})

	got, err := DecryptProviderSecret("v1.aes-256-gcm.bm9kZS1nb2xhbmcx.gYPiGuqv2_PnwWxsr0mzqQ.xrKl0I6kinKSkdGI0v3Wog")
	if err != nil {
		t.Fatalf("DecryptProviderSecret returned error: %v", err)
	}
	if got != "sk-cross-runtime" {
		t.Fatalf("DecryptProviderSecret = %q, want %q", got, "sk-cross-runtime")
	}
}

func TestDecryptProviderSecretRequiresMasterKey(t *testing.T) {
	previous := config.ProviderAPIKeyMasterKey
	config.ProviderAPIKeyMasterKey = ""
	t.Cleanup(func() {
		config.ProviderAPIKeyMasterKey = previous
	})

	_, err := DecryptProviderSecret("v1.aes-256-gcm.bm9kZS1nb2xhbmcx.gYPiGuqv2_PnwWxsr0mzqQ.xrKl0I6kinKSkdGI0v3Wog")
	if err != ErrProviderMasterKeyMissing {
		t.Fatalf("DecryptProviderSecret error = %v, want %v", err, ErrProviderMasterKeyMissing)
	}
}
