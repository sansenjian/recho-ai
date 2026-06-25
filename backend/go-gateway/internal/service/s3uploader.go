package service

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/hashicorp/golang-lru/v2/expirable"
	"go-gateway/internal/config"
)

const (
	cacheTTLSeconds      = 600
	cacheMaxEntries      = 10000
	defaultCacheControl  = "max-age=31536000"
	multipartThreshold   = 10 * 1024 * 1024 // use multipart above 10 MB
	multipartPartSize    = 5 * 1024 * 1024  // 5 MB per part
	multipartConcurrency = 4
)

// StorageProvider identifies the configured storage backend.
type StorageProvider string

const (
	StorageProviderSupabase StorageProvider = "supabase"
	StorageProviderCos      StorageProvider = "tencent-cos"
	StorageProviderUnknown  StorageProvider = "unknown"
)

// S3Uploader uploads objects to S3-compatible storage.
type S3Uploader struct {
	provider   StorageProvider
	client     *s3.Client
	bucket     string
	publicBase string
	urlCache   *expirable.LRU[string, string]
}

// S3Config holds configuration for an S3-compatible uploader.
type S3Config struct {
	Provider   StorageProvider
	Endpoint   string
	Region     string
	Bucket     string
	AccessKey  string
	SecretKey  string
	PublicBase string
}

var (
	newS3UploaderOnce sync.Once
	globalUploader    *S3Uploader
)

// NewS3Uploader creates a new S3 uploader from config.
func NewS3Uploader(cfg S3Config) *S3Uploader {
	client := s3.New(s3.Options{
		BaseEndpoint: aws.String(strings.TrimRight(cfg.Endpoint, "/")),
		Region:       cfg.Region,
		Credentials:  aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
	})

	return &S3Uploader{
		provider:   cfg.Provider,
		client:     client,
		bucket:     cfg.Bucket,
		publicBase: strings.TrimRight(cfg.PublicBase, "/"),
		urlCache:   expirable.NewLRU[string, string](cacheMaxEntries, nil, cacheTTLSeconds*time.Second),
	}
}

// Upload stores data at the given key and returns the public URL.
// Files larger than multipartThreshold are uploaded via S3 multipart upload.
func (u *S3Uploader) Upload(ctx context.Context, key string, data []byte, contentType string) (string, error) {
	if u == nil || u.client == nil {
		return "", fmt.Errorf("uploader not initialized")
	}

	if len(data) > multipartThreshold {
		return u.uploadMultipart(ctx, key, data, contentType)
	}
	return u.uploadSingle(ctx, key, data, contentType)
}

func (u *S3Uploader) uploadSingle(ctx context.Context, key string, data []byte, contentType string) (string, error) {
	_, err := u.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(u.bucket),
		Key:          aws.String(key),
		Body:         bytes.NewReader(data),
		ContentType:  aws.String(contentType),
		CacheControl: aws.String(defaultCacheControl),
	})
	if err != nil {
		return "", fmt.Errorf("failed to upload %s: %w", key, err)
	}

	publicURL := u.publicURL(key)
	u.urlCache.Add(key, publicURL)
	return publicURL, nil
}

func (u *S3Uploader) uploadMultipart(ctx context.Context, key string, data []byte, contentType string) (string, error) {
	createResp, err := u.client.CreateMultipartUpload(ctx, &s3.CreateMultipartUploadInput{
		Bucket:       aws.String(u.bucket),
		Key:          aws.String(key),
		ContentType:  aws.String(contentType),
		CacheControl: aws.String(defaultCacheControl),
	})
	if err != nil {
		return "", fmt.Errorf("failed to create multipart upload for %s: %w", key, err)
	}

	uploadID := aws.ToString(createResp.UploadId)
	partCount := (len(data) + multipartPartSize - 1) / multipartPartSize
	completedParts := make([]types.CompletedPart, partCount)

	uploadCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	var wg sync.WaitGroup
	var partsMu sync.Mutex
	sem := make(chan struct{}, multipartConcurrency)
	errChan := make(chan error, 1)

	for i := 0; i < partCount; i++ {
		partNum := i + 1
		start := i * multipartPartSize
		end := start + multipartPartSize
		if end > len(data) {
			end = len(data)
		}
		partData := data[start:end]

		wg.Add(1)
		sem <- struct{}{}
		go func(partNum int, partData []byte) {
			defer wg.Done()
			defer func() { <-sem }()

			select {
			case <-uploadCtx.Done():
				return
			default:
			}

			resp, uploadErr := u.client.UploadPart(uploadCtx, &s3.UploadPartInput{
				Bucket:     aws.String(u.bucket),
				Key:        aws.String(key),
				UploadId:   aws.String(uploadID),
				PartNumber: aws.Int32(int32(partNum)),
				Body:       bytes.NewReader(partData),
			})
			if uploadErr != nil {
				select {
				case errChan <- fmt.Errorf("failed to upload part %d of %s: %w", partNum, key, uploadErr):
					cancel()
				default:
				}
				return
			}

			partsMu.Lock()
			completedParts[partNum-1] = types.CompletedPart{
				ETag:       resp.ETag,
				PartNumber: aws.Int32(int32(partNum)),
			}
			partsMu.Unlock()
		}(partNum, partData)
	}

	wg.Wait()
	cancel()

	select {
	case uploadErr := <-errChan:
		cleanupCtx, cancel := cleanupContext()
		if abortErr := u.abortMultipart(cleanupCtx, key, uploadID); abortErr != nil {
			log.Printf("[s3uploader] failed to abort multipart upload %s: %v", key, abortErr)
		}
		cancel()
		return "", uploadErr
	default:
	}

	_, err = u.client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:   aws.String(u.bucket),
		Key:      aws.String(key),
		UploadId: aws.String(uploadID),
		MultipartUpload: &types.CompletedMultipartUpload{
			Parts: completedParts,
		},
	})
	if err != nil {
		cleanupCtx, cancel := cleanupContext()
		if abortErr := u.abortMultipart(cleanupCtx, key, uploadID); abortErr != nil {
			log.Printf("[s3uploader] failed to abort multipart upload %s: %v", key, abortErr)
		}
		cancel()
		return "", fmt.Errorf("failed to complete multipart upload %s: %w", key, err)
	}

	publicURL := u.publicURL(key)
	u.urlCache.Add(key, publicURL)
	return publicURL, nil
}

func cleanupContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}

func (u *S3Uploader) abortMultipart(ctx context.Context, key, uploadID string) error {
	_, err := u.client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
		Bucket:   aws.String(u.bucket),
		Key:      aws.String(key),
		UploadId: aws.String(uploadID),
	})
	return err
}

// Delete removes an object from storage.
func (u *S3Uploader) Delete(ctx context.Context, key string) error {
	if u == nil || u.client == nil {
		return fmt.Errorf("uploader not initialized")
	}

	_, err := u.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(u.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("failed to delete %s: %w", key, err)
	}

	u.urlCache.Remove(key)
	return nil
}

// PublicURL returns the public URL for a key, using a small LRU cache.
func (u *S3Uploader) PublicURL(key string) string {
	if u == nil {
		return ""
	}

	if cached, ok := u.urlCache.Get(key); ok {
		return cached
	}

	publicURL := u.publicURL(key)
	u.urlCache.Add(key, publicURL)
	return publicURL
}

func (u *S3Uploader) publicURL(key string) string {
	if u.publicBase == "" {
		return fmt.Sprintf("/api/image/storage/%s", key)
	}
	return fmt.Sprintf("%s/%s", u.publicBase, key)
}

// Provider returns the configured storage provider.
func (u *S3Uploader) Provider() StorageProvider {
	if u == nil {
		return StorageProviderUnknown
	}
	return u.provider
}

// S3UploaderFromEnv creates an S3Uploader from environment variables.
// It prefers Tencent COS when configured, otherwise falls back to Supabase Storage.
func S3UploaderFromEnv() *S3Uploader {
	newS3UploaderOnce.Do(func() {
		if cfg, ok := cosConfigFromEnv(); ok {
			globalUploader = NewS3Uploader(cfg)
			log.Printf("[s3uploader] configured for Tencent COS: %s", cfg.Bucket)
			return
		}
		if cfg, ok := supabaseConfigFromEnv(); ok {
			globalUploader = NewS3Uploader(cfg)
			log.Printf("[s3uploader] configured for Supabase Storage: %s", cfg.Bucket)
			return
		}
		log.Println("[s3uploader] no storage provider configured")
	})
	return globalUploader
}

func cosConfigFromEnv() (S3Config, bool) {
	if config.TencentCosSecretID == "" || config.TencentCosSecretKey == "" || config.TencentCosFullBucket == "" || config.TencentCosRegion == "" {
		return S3Config{}, false
	}

	return S3Config{
		Provider:   StorageProviderCos,
		Endpoint:   fmt.Sprintf("https://cos.%s.myqcloud.com", config.TencentCosRegion),
		Region:     config.TencentCosRegion,
		Bucket:     config.TencentCosFullBucket,
		AccessKey:  config.TencentCosSecretID,
		SecretKey:  config.TencentCosSecretKey,
		PublicBase: config.TencentCosPublicBaseURL,
	}, true
}

func supabaseConfigFromEnv() (S3Config, bool) {
	if config.SupabaseURL == "" || config.SupabaseServiceRoleKey == "" {
		return S3Config{}, false
	}

	publicBase := fmt.Sprintf("%s/storage/v1/object/public/%s", strings.TrimRight(config.SupabaseURL, "/"), config.SupabaseImageBucket)
	return S3Config{
		Provider:   StorageProviderSupabase,
		Endpoint:   fmt.Sprintf("%s/storage/v1/s3", strings.TrimRight(config.SupabaseURL, "/")),
		Region:     "auto",
		Bucket:     config.SupabaseImageBucket,
		AccessKey:  config.SupabaseServiceRoleKey,
		SecretKey:  config.SupabaseServiceRoleKey,
		PublicBase: publicBase,
	}, true
}
