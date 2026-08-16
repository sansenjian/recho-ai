package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsretry "github.com/aws/aws-sdk-go-v2/aws/retry"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/hashicorp/golang-lru/v2/expirable"
	"go-gateway/internal/config"
)

const (
	cacheTTLSeconds         = 600
	cacheMaxEntries         = 10000
	defaultCacheControl     = "max-age=31536000"
	multipartThreshold      = 10 * 1024 * 1024 // use multipart above 10 MB
	multipartPartSize       = 5 * 1024 * 1024  // 5 MB per part
	multipartConcurrency    = 4
	s3DialTimeout           = 10 * time.Second
	s3TLSHandshakeTimeout   = 10 * time.Second
	s3ResponseHeaderTimeout = 30 * time.Second
	s3IdleConnTimeout       = 90 * time.Second
	// Keep each SDK attempt bounded so retries cannot hold an image job for
	// several minutes when a provider is unreachable.
	s3RequestTimeout = 30 * time.Second
	s3MaxAttempts    = 2
	s3MaxBackoff     = 2 * time.Second
)

// StorageProvider identifies the configured storage backend.
type StorageProvider string

const (
	StorageProviderSupabase StorageProvider = "supabase"
	StorageProviderCos      StorageProvider = "tencent-cos"
	StorageProviderUnknown  StorageProvider = "unknown"
)

// S3Uploader provides object operations through S3 or the Supabase REST
// fallback. The name is kept for compatibility with existing callers.
type S3Uploader struct {
	provider   StorageProvider
	client     *s3.Client
	restClient *http.Client
	restBase   string
	restToken  string
	bucket     string
	publicBase string
	urlCache   *expirable.LRU[string, string]
}

// S3Config holds configuration for an S3-compatible uploader.
type S3Config struct {
	Provider     StorageProvider
	Endpoint     string
	Region       string
	Bucket       string
	AccessKey    string
	SecretKey    string
	PublicBase   string
	UsePathStyle bool
}

// SupabaseRESTConfig configures the Supabase Storage REST API fallback.
// The service-role key is only used server-side and is never exposed through
// the public URL returned by the uploader.
type SupabaseRESTConfig struct {
	SupabaseURL    string
	Bucket         string
	ServiceRoleKey string
	PublicBase     string
}

// StorageObject identifies an object returned by a reconciliation listing.
type StorageObject struct {
	Path         string
	LastModified time.Time
}

var (
	newS3UploaderOnce sync.Once
	globalUploader    *S3Uploader
	globalUploaders   map[StorageProvider]*S3Uploader
)

// NewS3Uploader creates a new S3 uploader from config.
func NewS3Uploader(cfg S3Config) *S3Uploader {
	client := s3.New(s3.Options{
		BaseEndpoint: aws.String(strings.TrimRight(cfg.Endpoint, "/")),
		Region:       cfg.Region,
		Credentials:  aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
		HTTPClient:   newStorageHTTPClient(),
		UsePathStyle: cfg.UsePathStyle,
		Retryer: awsretry.NewStandard(func(options *awsretry.StandardOptions) {
			options.MaxAttempts = s3MaxAttempts
			options.MaxBackoff = s3MaxBackoff
		}),
	})

	return &S3Uploader{
		provider:   cfg.Provider,
		client:     client,
		bucket:     cfg.Bucket,
		publicBase: strings.TrimRight(cfg.PublicBase, "/"),
		urlCache:   expirable.NewLRU[string, string](cacheMaxEntries, nil, cacheTTLSeconds*time.Second),
	}
}

// NewSupabaseRESTUploader creates a Supabase Storage REST uploader for
// deployments that do not have S3 credentials configured.
func NewSupabaseRESTUploader(cfg SupabaseRESTConfig) *S3Uploader {
	baseURL := strings.TrimRight(cfg.SupabaseURL, "/")
	return &S3Uploader{
		provider:   StorageProviderSupabase,
		restClient: newStorageHTTPClient(),
		restBase:   baseURL + "/storage/v1/object",
		restToken:  cfg.ServiceRoleKey,
		bucket:     cfg.Bucket,
		publicBase: strings.TrimRight(cfg.PublicBase, "/"),
		urlCache:   expirable.NewLRU[string, string](cacheMaxEntries, nil, cacheTTLSeconds*time.Second),
	}
}

func newStorageHTTPClient() *http.Client {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   s3DialTimeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       s3IdleConnTimeout,
		TLSHandshakeTimeout:   s3TLSHandshakeTimeout,
		ResponseHeaderTimeout: s3ResponseHeaderTimeout,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &http.Client{Transport: transport, Timeout: s3RequestTimeout}
}

// Upload stores data at the given key and returns the public URL.
// Files larger than multipartThreshold are uploaded via S3 multipart upload.
func (u *S3Uploader) Upload(ctx context.Context, key string, data []byte, contentType string) (string, error) {
	if u == nil {
		return "", fmt.Errorf("uploader not initialized")
	}
	if u.restClient != nil {
		return u.uploadREST(ctx, key, data, contentType)
	}
	if u.client == nil {
		return "", fmt.Errorf("uploader not initialized")
	}

	if len(data) > multipartThreshold {
		return u.uploadMultipart(ctx, key, data, contentType)
	}
	return u.uploadSingle(ctx, key, data, contentType)
}

func (u *S3Uploader) uploadREST(ctx context.Context, key string, data []byte, contentType string) (string, error) {
	req, err := u.newRESTRequest(ctx, http.MethodPost, u.objectRESTURL(key), bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Cache-Control", defaultCacheControl)
	req.Header.Set("x-upsert", "true")
	resp, err := u.restClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to upload %s via Supabase REST: %w", key, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("failed to upload %s via Supabase REST: %s", key, readRESTError(resp))
	}

	publicURL := u.publicURL(key)
	u.urlCache.Add(key, publicURL)
	return publicURL, nil
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
	// Buffer the error channel by the number of parts so that every goroutine
	// can report its error without blocking, even if the first error has
	// already been observed.
	errChan := make(chan error, partCount)

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
	if u == nil {
		return fmt.Errorf("uploader not initialized")
	}
	if u.restClient != nil {
		return u.deleteREST(ctx, key)
	}
	if u.client == nil {
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

func (u *S3Uploader) deleteREST(ctx context.Context, key string) error {
	body, err := json.Marshal(map[string][]string{"prefixes": {key}})
	if err != nil {
		return fmt.Errorf("failed to encode delete request for %s: %w", key, err)
	}
	req, err := u.newRESTRequest(ctx, http.MethodDelete, u.restBase+"/"+escapeStoragePath(u.bucket), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := u.restClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to delete %s via Supabase REST: %w", key, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("failed to delete %s via Supabase REST: %s", key, readRESTError(resp))
	}
	u.urlCache.Remove(key)
	return nil
}

// ListObjects lists object keys for reconciliation. Callers should apply a
// grace period before deleting results because object-store listings can lag.
func (u *S3Uploader) ListObjects(ctx context.Context, prefix string) ([]StorageObject, error) {
	if u == nil {
		return nil, fmt.Errorf("uploader not initialized")
	}
	if u.restClient != nil {
		return u.listREST(ctx, prefix)
	}
	if u.client == nil {
		return nil, fmt.Errorf("uploader not initialized")
	}
	paginator := s3.NewListObjectsV2Paginator(u.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(u.bucket),
		Prefix: aws.String(prefix),
	})
	objects := make([]StorageObject, 0)
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list objects: %w", err)
		}
		for _, object := range page.Contents {
			if object.Key == nil {
				continue
			}
			modified := time.Time{}
			if object.LastModified != nil {
				modified = *object.LastModified
			}
			objects = append(objects, StorageObject{Path: *object.Key, LastModified: modified})
		}
	}
	return objects, nil
}

type supabaseRESTListRequest struct {
	Prefix        string `json:"prefix"`
	Limit         int    `json:"limit"`
	Cursor        string `json:"cursor,omitempty"`
	WithDelimiter bool   `json:"with_delimiter"`
	SortBy        struct {
		Column string `json:"column"`
		Order  string `json:"order"`
	} `json:"sortBy"`
}

type supabaseRESTObject struct {
	Name      string `json:"name"`
	Key       string `json:"key"`
	UpdatedAt string `json:"updated_at"`
}

type supabaseRESTListResponse struct {
	HasNext    bool                 `json:"hasNext"`
	NextCursor string               `json:"nextCursor"`
	Objects    []supabaseRESTObject `json:"objects"`
}

func (u *S3Uploader) listREST(ctx context.Context, prefix string) ([]StorageObject, error) {
	const pageSize = 1000
	objects := make([]StorageObject, 0)
	cursor := ""
	for {
		payload := supabaseRESTListRequest{
			Prefix:        strings.Trim(prefix, "/"),
			Limit:         pageSize,
			Cursor:        cursor,
			WithDelimiter: false,
		}
		payload.SortBy.Column = "name"
		payload.SortBy.Order = "asc"
		body, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("failed to encode Supabase list request: %w", err)
		}
		req, err := u.newRESTRequest(ctx, http.MethodPost, u.restBase+"/list-v2/"+escapeStoragePath(u.bucket), bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := u.restClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to list Supabase objects: %w", err)
		}
		if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
			errText := readRESTError(resp)
			resp.Body.Close()
			return nil, fmt.Errorf("failed to list Supabase objects: %s", errText)
		}
		var page supabaseRESTListResponse
		decodeErr := json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&page)
		resp.Body.Close()
		if decodeErr != nil {
			return nil, fmt.Errorf("failed to decode Supabase object list: %w", decodeErr)
		}
		for _, entry := range page.Objects {
			name := strings.TrimPrefix(entry.Key, "/")
			if name == "" {
				name = strings.TrimPrefix(entry.Name, "/")
			}
			if prefix != "" && !strings.HasPrefix(name, strings.Trim(prefix, "/")+"/") {
				name = strings.Trim(strings.Trim(prefix, "/")+"/"+name, "/")
			}
			modified, _ := time.Parse(time.RFC3339Nano, entry.UpdatedAt)
			objects = append(objects, StorageObject{Path: name, LastModified: modified})
		}
		if !page.HasNext || page.NextCursor == "" {
			return objects, nil
		}
		if page.NextCursor == cursor {
			return nil, fmt.Errorf("Supabase object listing returned a repeated cursor")
		}
		cursor = page.NextCursor
	}
}

// Download retrieves an object using either S3 or the Supabase REST API.
func (u *S3Uploader) Download(ctx context.Context, key string) (*DownloadedImage, error) {
	if u == nil {
		return nil, fmt.Errorf("uploader not initialized")
	}
	if u.restClient != nil {
		return u.downloadREST(ctx, key)
	}
	if u.client == nil {
		return nil, fmt.Errorf("uploader not initialized")
	}
	resp, err := u.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(u.bucket), Key: aws.String(key)})
	if err != nil {
		return nil, err
	}
	return readDownloadedImage(resp, key)
}

func (u *S3Uploader) downloadREST(ctx context.Context, key string) (*DownloadedImage, error) {
	req, err := u.newRESTRequest(ctx, http.MethodGet, u.objectRESTURL(key), nil)
	if err != nil {
		return nil, err
	}
	resp, err := u.restClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to download %s via Supabase REST: %w", key, err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		message := readRESTError(resp)
		resp.Body.Close()
		return nil, fmt.Errorf("failed to download %s via Supabase REST: %s", key, message)
	}
	data, readErr := io.ReadAll(io.LimitReader(resp.Body, maxImageSize+1))
	mime := resp.Header.Get("Content-Type")
	resp.Body.Close()
	if readErr != nil {
		return nil, fmt.Errorf("failed to read Supabase REST response: %w", readErr)
	}
	if len(data) > maxImageSize {
		return nil, fmt.Errorf("image exceeds maximum size of %d bytes", maxImageSize)
	}
	if mime == "" {
		mime = mimeFromStoragePath(key)
	}
	return &DownloadedImage{Data: data, Mime: mime}, nil
}

func (u *S3Uploader) newRESTRequest(ctx context.Context, method, endpoint string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, fmt.Errorf("failed to build Supabase REST request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+u.restToken)
	req.Header.Set("apikey", u.restToken)
	return req, nil
}

func (u *S3Uploader) objectRESTURL(key string) string {
	return u.restBase + "/" + escapeStoragePath(u.bucket) + "/" + escapeStoragePath(key)
}

func escapeStoragePath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func readRESTError(resp *http.Response) string {
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024))
	message := strings.TrimSpace(string(data))
	if message == "" {
		return resp.Status
	}
	return resp.Status + ": " + message
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
	S3UploadersFromEnv()
	return globalUploader
}

// S3UploadersFromEnv initializes every configured storage provider. Supabase
// uses dedicated S3 credentials when available and otherwise falls back to
// its REST API. The name is kept for compatibility with existing callers.
func S3UploadersFromEnv() map[StorageProvider]*S3Uploader {
	newS3UploaderOnce.Do(func() {
		globalUploaders = make(map[StorageProvider]*S3Uploader)
		if cfg, ok := cosConfigFromEnv(); ok {
			globalUploaders[StorageProviderCos] = NewS3Uploader(cfg)
			log.Printf("[s3uploader] configured for Tencent COS: %s", cfg.Bucket)
		}
		if cfg, ok := supabaseConfigFromEnv(); ok {
			globalUploaders[StorageProviderSupabase] = NewS3Uploader(cfg)
			log.Printf("[s3uploader] configured for Supabase Storage: %s", cfg.Bucket)
		} else if cfg, ok := supabaseRESTConfigFromEnv(); ok {
			globalUploaders[StorageProviderSupabase] = NewSupabaseRESTUploader(cfg)
			if enabled, missing := supabaseS3ConfigStatus(); enabled && len(missing) > 0 {
				log.Printf("[s3uploader] Supabase S3 incomplete; using Storage REST fallback (missing: %s)", strings.Join(missing, ", "))
			} else {
				log.Printf("[s3uploader] configured for Supabase Storage REST fallback: %s", cfg.Bucket)
			}
		} else if enabled, missing := supabaseS3ConfigStatus(); enabled && len(missing) > 0 {
			log.Printf("[s3uploader] Supabase Storage disabled; missing S3 and REST configuration: %s, SUPABASE_SERVICE_ROLE_KEY", strings.Join(missing, ", "))
		}
		if uploader := globalUploaders[StorageProviderCos]; uploader != nil {
			globalUploader = uploader
		} else {
			globalUploader = globalUploaders[StorageProviderSupabase]
		}
		if globalUploader == nil {
			log.Println("[s3uploader] no storage provider configured")
		}
	})
	return globalUploaders
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
	enabled, missing := supabaseS3ConfigStatus()
	if !enabled || len(missing) > 0 {
		return S3Config{}, false
	}

	publicBase := fmt.Sprintf("%s/storage/v1/object/public/%s", strings.TrimRight(config.SupabaseURL, "/"), config.SupabaseImageBucket)
	return S3Config{
		Provider:     StorageProviderSupabase,
		Endpoint:     strings.TrimRight(config.SupabaseS3Endpoint, "/"),
		Region:       config.SupabaseS3Region,
		Bucket:       config.SupabaseImageBucket,
		AccessKey:    config.SupabaseS3AccessKeyID,
		SecretKey:    config.SupabaseS3SecretAccessKey,
		PublicBase:   publicBase,
		UsePathStyle: true,
	}, true
}

func supabaseRESTConfigFromEnv() (SupabaseRESTConfig, bool) {
	if config.SupabaseURL == "" || config.SupabaseImageBucket == "" || config.SupabaseServiceRoleKey == "" {
		return SupabaseRESTConfig{}, false
	}
	return SupabaseRESTConfig{
		SupabaseURL:    config.SupabaseURL,
		Bucket:         config.SupabaseImageBucket,
		ServiceRoleKey: config.SupabaseServiceRoleKey,
		PublicBase:     fmt.Sprintf("%s/storage/v1/object/public/%s", strings.TrimRight(config.SupabaseURL, "/"), config.SupabaseImageBucket),
	}, true
}

func supabaseS3ConfigStatus() (bool, []string) {
	s3Settings := []string{
		config.SupabaseS3Endpoint,
		config.SupabaseS3Region,
		config.SupabaseS3AccessKeyID,
		config.SupabaseS3SecretAccessKey,
	}
	enabled := false
	for _, value := range s3Settings {
		if value != "" {
			enabled = true
			break
		}
	}
	if !enabled {
		return false, nil
	}

	required := []struct {
		name  string
		value string
	}{
		{name: "SUPABASE_URL", value: config.SupabaseURL},
		{name: "SUPABASE_IMAGE_BUCKET", value: config.SupabaseImageBucket},
		{name: "SUPABASE_S3_ENDPOINT", value: config.SupabaseS3Endpoint},
		{name: "SUPABASE_S3_REGION", value: config.SupabaseS3Region},
		{name: "SUPABASE_S3_ACCESS_KEY_ID", value: config.SupabaseS3AccessKeyID},
		{name: "SUPABASE_S3_SECRET_ACCESS_KEY", value: config.SupabaseS3SecretAccessKey},
	}
	missing := make([]string, 0, len(required))
	for _, setting := range required {
		if setting.value == "" {
			missing = append(missing, setting.name)
		}
	}
	return true, missing
}
