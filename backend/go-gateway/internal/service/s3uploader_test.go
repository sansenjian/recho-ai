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

func TestSupabaseConfigKeepsOriginalEndpointAndUsesPathStyle(t *testing.T) {
	originalURL := config.SupabaseURL
	originalKey := config.SupabaseServiceRoleKey
	originalBucket := config.SupabaseImageBucket
	t.Cleanup(func() {
		config.SupabaseURL = originalURL
		config.SupabaseServiceRoleKey = originalKey
		config.SupabaseImageBucket = originalBucket
	})

	config.SupabaseURL = "https://project.supabase.co/"
	config.SupabaseServiceRoleKey = "service-role-key"
	config.SupabaseImageBucket = "recho-images"

	cfg, ok := supabaseConfigFromEnv()
	if !ok {
		t.Fatal("supabaseConfigFromEnv() did not return a configured uploader")
	}
	if cfg.Endpoint != "https://project.supabase.co/storage/v1/s3" {
		t.Fatalf("endpoint = %q, want original project endpoint", cfg.Endpoint)
	}
	if !cfg.UsePathStyle {
		t.Fatal("Supabase S3 uploader must use path-style addressing")
	}
}
