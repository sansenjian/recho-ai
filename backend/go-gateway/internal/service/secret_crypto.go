package service

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"

	"go-gateway/internal/config"
)

const providerSecretPrefix = "v1.aes-256-gcm"

var (
	ErrProviderMasterKeyMissing = errors.New("provider api key master key missing")
	ErrProviderMasterKeyInvalid = errors.New("provider api key master key invalid")
	ErrProviderCiphertextInvalid = errors.New("provider api key ciphertext invalid")
)

func decodeProviderMasterKey(raw string) ([]byte, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, ErrProviderMasterKeyMissing
	}
	value = strings.TrimPrefix(value, "base64:")

	candidates := make([][]byte, 0, 4)
	if len(value) == 64 {
		if decoded, err := hex.DecodeString(value); err == nil {
			candidates = append(candidates, decoded)
		}
	}
	if decoded, err := base64.RawURLEncoding.DecodeString(value); err == nil {
		candidates = append(candidates, decoded)
	}
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil {
		candidates = append(candidates, decoded)
	}
	candidates = append(candidates, []byte(value))

	for _, candidate := range candidates {
		if len(candidate) == 32 {
			return candidate, nil
		}
	}
	return nil, ErrProviderMasterKeyInvalid
}

func DecryptProviderSecret(ciphertext string) (string, error) {
	value := strings.TrimSpace(ciphertext)
	if value == "" {
		return "", nil
	}
	parts := strings.Split(value, ".")
	if len(parts) != 5 || parts[0]+"."+parts[1] != providerSecretPrefix {
		return "", ErrProviderCiphertextInvalid
	}

	key, err := decodeProviderMasterKey(config.ProviderAPIKeyMasterKey)
	if err != nil {
		return "", err
	}
	iv, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", ErrProviderCiphertextInvalid
	}
	tag, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return "", ErrProviderCiphertextInvalid
	}
	encrypted, err := base64.RawURLEncoding.DecodeString(parts[4])
	if err != nil {
		return "", ErrProviderCiphertextInvalid
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(iv) != aead.NonceSize() {
		return "", ErrProviderCiphertextInvalid
	}
	sealed := append(encrypted, tag...)
	plaintext, err := aead.Open(nil, iv, sealed, nil)
	if err != nil {
		return "", ErrProviderCiphertextInvalid
	}
	return string(plaintext), nil
}
