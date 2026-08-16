package service

import "testing"

func TestStorageLocatorParsesProviderAwareAndLegacyPaths(t *testing.T) {
	tests := []struct {
		name     string
		value    string
		provider StorageProvider
		key      string
	}{
		{name: "cos", value: "cos://generated/image.webp", provider: StorageProviderCos, key: "generated/image.webp"},
		{name: "tencent alias", value: "tencent-cos:///generated/image.webp", provider: StorageProviderCos, key: "generated/image.webp"},
		{name: "supabase", value: "supabase://references/image.webp", provider: StorageProviderSupabase, key: "references/image.webp"},
		{name: "legacy", value: "generated/legacy.webp", provider: StorageProviderSupabase, key: "generated/legacy.webp"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseStorageLocator(tt.value)
			if err != nil {
				t.Fatalf("ParseStorageLocator() error = %v", err)
			}
			if got.Provider != tt.provider || got.Key != tt.key {
				t.Fatalf("ParseStorageLocator() = %#v, want provider=%q key=%q", got, tt.provider, tt.key)
			}
		})
	}
}

func TestStorageLocatorRejectsUnknownProvider(t *testing.T) {
	if _, err := ParseStorageLocator("s3://generated/image.webp"); err == nil {
		t.Fatal("ParseStorageLocator() accepted an unknown provider")
	}
}

func TestEncodeStorageLocator(t *testing.T) {
	tests := []struct {
		provider StorageProvider
		key      string
		want     string
	}{
		{provider: StorageProviderCos, key: "/generated/image.webp", want: "cos://generated/image.webp"},
		{provider: StorageProviderSupabase, key: "generated/image.webp", want: "supabase://generated/image.webp"},
		{provider: StorageProviderUnknown, key: "generated/image.webp", want: "generated/image.webp"},
	}

	for _, tt := range tests {
		if got := EncodeStorageLocator(tt.provider, tt.key); got != tt.want {
			t.Errorf("EncodeStorageLocator(%q, %q) = %q, want %q", tt.provider, tt.key, got, tt.want)
		}
	}
}
