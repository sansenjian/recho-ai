package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"go-gateway/internal/config"
)

func TestNewS3UploaderUsesConfiguredAddressingStyle(t *testing.T) {
	tests := []struct {
		name         string
		usePathStyle bool
	}{
		{name: "virtual hosted", usePathStyle: false},
		{name: "path style", usePathStyle: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			uploader := NewS3Uploader(S3Config{
				Endpoint:     "https://project.supabase.co/storage/v1/s3",
				Region:       "auto",
				Bucket:       "images",
				AccessKey:    "access-key",
				SecretKey:    "secret-key",
				UsePathStyle: tt.usePathStyle,
			})
			if got := uploader.client.Options().UsePathStyle; got != tt.usePathStyle {
				t.Fatalf("UsePathStyle = %v, want %v", got, tt.usePathStyle)
			}
		})
	}
}

func TestS3UploaderPathStyleKeepsBucketOutOfEndpointHost(t *testing.T) {
	var requestHost string
	var requestPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestHost = r.Host
		requestPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	uploader := NewS3Uploader(S3Config{
		Endpoint:     server.URL + "/storage/v1/s3",
		Region:       "auto",
		Bucket:       "recho-images",
		AccessKey:    "access-key",
		SecretKey:    "secret-key",
		UsePathStyle: true,
	})
	if _, err := uploader.Upload(context.Background(), "staging/image.source", []byte("image"), "image/png"); err != nil {
		t.Fatalf("Upload() error = %v", err)
	}

	if requestHost != server.Listener.Addr().String() {
		t.Fatalf("request host = %q, want original endpoint host %q", requestHost, server.Listener.Addr().String())
	}
	if requestPath != "/storage/v1/s3/recho-images/staging/image.source" {
		t.Fatalf("request path = %q, want path-style bucket", requestPath)
	}
}

func TestSupabaseConfigUsesDedicatedS3Credentials(t *testing.T) {
	originalURL := config.SupabaseURL
	originalServiceRoleKey := config.SupabaseServiceRoleKey
	originalBucket := config.SupabaseImageBucket
	originalEndpoint := config.SupabaseS3Endpoint
	originalRegion := config.SupabaseS3Region
	originalAccessKeyID := config.SupabaseS3AccessKeyID
	originalSecretAccessKey := config.SupabaseS3SecretAccessKey
	t.Cleanup(func() {
		config.SupabaseURL = originalURL
		config.SupabaseServiceRoleKey = originalServiceRoleKey
		config.SupabaseImageBucket = originalBucket
		config.SupabaseS3Endpoint = originalEndpoint
		config.SupabaseS3Region = originalRegion
		config.SupabaseS3AccessKeyID = originalAccessKeyID
		config.SupabaseS3SecretAccessKey = originalSecretAccessKey
	})

	config.SupabaseURL = "https://project.supabase.co/"
	config.SupabaseServiceRoleKey = "service-role-key"
	config.SupabaseImageBucket = "recho-images"
	config.SupabaseS3Endpoint = "https://project.storage.supabase.co/storage/v1/s3/"
	config.SupabaseS3Region = "ap-southeast-1"
	config.SupabaseS3AccessKeyID = "s3-access-key-id"
	config.SupabaseS3SecretAccessKey = "s3-secret-access-key"

	cfg, ok := supabaseConfigFromEnv()
	if !ok {
		t.Fatal("supabaseConfigFromEnv() did not return a configured uploader")
	}
	if cfg.Endpoint != "https://project.storage.supabase.co/storage/v1/s3" {
		t.Fatalf("endpoint = %q, want configured direct storage endpoint", cfg.Endpoint)
	}
	if cfg.Region != "ap-southeast-1" {
		t.Fatalf("region = %q, want configured S3 region", cfg.Region)
	}
	if cfg.AccessKey != "s3-access-key-id" {
		t.Fatalf("access key = %q, want dedicated S3 access key ID", cfg.AccessKey)
	}
	if cfg.SecretKey != "s3-secret-access-key" {
		t.Fatal("secret key does not use the dedicated S3 secret access key")
	}
	if cfg.AccessKey == config.SupabaseServiceRoleKey || cfg.SecretKey == config.SupabaseServiceRoleKey {
		t.Fatal("service-role key must not be used for S3 credentials")
	}
	if !cfg.UsePathStyle {
		t.Fatal("Supabase S3 uploader must use path-style addressing")
	}
}

func TestSupabaseConfigRequiresAllDedicatedS3Settings(t *testing.T) {
	originalURL := config.SupabaseURL
	originalBucket := config.SupabaseImageBucket
	originalEndpoint := config.SupabaseS3Endpoint
	originalRegion := config.SupabaseS3Region
	originalAccessKeyID := config.SupabaseS3AccessKeyID
	originalSecretAccessKey := config.SupabaseS3SecretAccessKey
	t.Cleanup(func() {
		config.SupabaseURL = originalURL
		config.SupabaseImageBucket = originalBucket
		config.SupabaseS3Endpoint = originalEndpoint
		config.SupabaseS3Region = originalRegion
		config.SupabaseS3AccessKeyID = originalAccessKeyID
		config.SupabaseS3SecretAccessKey = originalSecretAccessKey
	})

	base := struct {
		url       string
		bucket    string
		endpoint  string
		region    string
		accessKey string
		secretKey string
	}{
		url:       "https://project.supabase.co",
		bucket:    "recho-images",
		endpoint:  "https://project.storage.supabase.co/storage/v1/s3",
		region:    "ap-southeast-1",
		accessKey: "s3-access-key-id",
		secretKey: "s3-secret-access-key",
	}
	setBaseConfig := func(t *testing.T) {
		t.Helper()
		config.SupabaseURL = base.url
		config.SupabaseImageBucket = base.bucket
		config.SupabaseS3Endpoint = base.endpoint
		config.SupabaseS3Region = base.region
		config.SupabaseS3AccessKeyID = base.accessKey
		config.SupabaseS3SecretAccessKey = base.secretKey
	}

	tests := []struct {
		name  string
		clear func()
	}{
		{name: "endpoint", clear: func() { config.SupabaseS3Endpoint = "" }},
		{name: "region", clear: func() { config.SupabaseS3Region = "" }},
		{name: "access key ID", clear: func() { config.SupabaseS3AccessKeyID = "" }},
		{name: "secret access key", clear: func() { config.SupabaseS3SecretAccessKey = "" }},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			setBaseConfig(t)
			tt.clear()

			if _, ok := supabaseConfigFromEnv(); ok {
				t.Fatalf("supabaseConfigFromEnv() configured uploader without %s", tt.name)
			}
		})
	}
}

func TestSupabaseS3ConfigStatusDistinguishesDisabledFromIncomplete(t *testing.T) {
	originalURL := config.SupabaseURL
	originalBucket := config.SupabaseImageBucket
	originalEndpoint := config.SupabaseS3Endpoint
	originalRegion := config.SupabaseS3Region
	originalAccessKeyID := config.SupabaseS3AccessKeyID
	originalSecretAccessKey := config.SupabaseS3SecretAccessKey
	t.Cleanup(func() {
		config.SupabaseURL = originalURL
		config.SupabaseImageBucket = originalBucket
		config.SupabaseS3Endpoint = originalEndpoint
		config.SupabaseS3Region = originalRegion
		config.SupabaseS3AccessKeyID = originalAccessKeyID
		config.SupabaseS3SecretAccessKey = originalSecretAccessKey
	})

	config.SupabaseS3Endpoint = ""
	config.SupabaseS3Region = ""
	config.SupabaseS3AccessKeyID = ""
	config.SupabaseS3SecretAccessKey = ""
	if enabled, missing := supabaseS3ConfigStatus(); enabled || len(missing) != 0 {
		t.Fatalf("empty S3 settings should be intentionally disabled, got enabled=%v missing=%v", enabled, missing)
	}

	config.SupabaseURL = "https://project.supabase.co"
	config.SupabaseImageBucket = "recho-images"
	config.SupabaseS3Endpoint = "https://project.storage.supabase.co/storage/v1/s3"
	enabled, missing := supabaseS3ConfigStatus()
	if !enabled {
		t.Fatal("partial S3 settings should be reported as enabled but incomplete")
	}
	want := []string{
		"SUPABASE_S3_REGION",
		"SUPABASE_S3_ACCESS_KEY_ID",
		"SUPABASE_S3_SECRET_ACCESS_KEY",
	}
	if len(missing) != len(want) {
		t.Fatalf("missing settings = %v, want %v", missing, want)
	}
	for i := range want {
		if missing[i] != want[i] {
			t.Fatalf("missing settings = %v, want %v", missing, want)
		}
	}
}
