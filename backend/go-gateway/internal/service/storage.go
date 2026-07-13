package service

import (
	"context"
	crand "crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// maxImageSize caps how many bytes are read from a single image download to
// protect against unbounded memory growth (OOM) from oversized responses.
const maxImageSize = 100 * 1024 * 1024 // 100MB

// StorageService handles image storage operations
type StorageService struct {
	pool        *pgxpool.Pool
	client      *http.Client // reused HTTP client for downloading upstream images
	processor   *ImageProcessor
	uploader    *S3Uploader
	objectStore storageObjectStore
	db          storageDB
}

// storageObjectStore is the narrow object-store contract used by staging and
// strict cleanup. The concrete uploader remains available for operations that
// need direct access to its S3 client.
type storageObjectStore interface {
	Upload(context.Context, string, []byte, string) (string, error)
	Delete(context.Context, string) error
	PublicURL(string) string
}

// storageDB is the narrow database contract used by history persistence and
// worker cleanup. *pgxpool.Pool satisfies this interface in production.
type storageDB interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// NewStorageService creates a new storage service
func NewStorageService(pool *pgxpool.Pool, processor *ImageProcessor, uploader *S3Uploader) *StorageService {
	var objectStore storageObjectStore
	if uploader != nil {
		objectStore = uploader
	}
	var db storageDB
	if pool != nil {
		db = pool
	}
	return &StorageService{
		pool:        pool,
		processor:   processor,
		uploader:    uploader,
		objectStore: objectStore,
		db:          db,
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

// StoredImage represents a stored image
type StoredImage struct {
	PublicURL     string
	StoragePath   string
	PreviewURL    string
	PreviewPath   string
	ThumbnailURL  string
	ThumbnailPath string
	Width         int
	Height        int
	Bytes         int
	Mime          string
}

// DownloadedImage represents an image downloaded from configured storage.
type DownloadedImage struct {
	Data []byte
	Mime string
}

// StagedImage describes an exact, unprocessed object written to storage.
type StagedImage struct {
	StoragePath string
	Mime        string
	Bytes       int
	SHA256      string
}

// ImageHistory represents image history data
type ImageHistory struct {
	Images []ImageHistoryItem
	Total  int
}

// ImageHistoryItem represents an image history item
type ImageHistoryItem struct {
	ID                  string                  `json:"id"`
	UserID              string                  `json:"userId,omitempty"`
	GenerationBatchID   string                  `json:"generationBatchId,omitempty"`
	Prompt              string                  `json:"prompt"`
	UserPrompt          string                  `json:"userPrompt,omitempty"`
	SystemPrompt        string                  `json:"systemPrompt,omitempty"`
	ModelPrompt         string                  `json:"modelPrompt,omitempty"`
	StoragePath         string                  `json:"storagePath,omitempty"`
	URL                 string                  `json:"url,omitempty"`
	PreviewURL          string                  `json:"previewUrl,omitempty"`
	PreviewPath         string                  `json:"previewPath,omitempty"`
	ThumbnailURL        string                  `json:"thumbnailUrl,omitempty"`
	ThumbnailPath       string                  `json:"thumbnailPath,omitempty"`
	Size                string                  `json:"size,omitempty"`
	AspectRatio         string                  `json:"aspectRatio,omitempty"`
	Resolution          string                  `json:"resolution,omitempty"`
	Quality             string                  `json:"quality,omitempty"`
	ImageModel          string                  `json:"imageModel,omitempty"`
	RevisedPrompt       string                  `json:"revisedPrompt,omitempty"`
	Width               int                     `json:"width,omitempty"`
	Height              int                     `json:"height,omitempty"`
	Bytes               int                     `json:"-"`
	Timestamp           time.Time               `json:"timestamp"`
	References          []ImageHistoryReference `json:"references,omitempty"`
	ReferenceCount      int                     `json:"referenceImageCount,omitempty"`
	Visibility          string                  `json:"visibility,omitempty"`
	FundingSource       string                  `json:"fundingSource,omitempty"`
	CreditCost          float64                 `json:"creditCost,omitempty"`
	CreditTransactionID string                  `json:"creditTransactionId,omitempty"`
}

// ImageHistoryReference is persisted with generated images.
type ImageHistoryReference struct {
	ID            string `json:"id,omitempty"`
	Title         string `json:"title,omitempty"`
	DataURL       string `json:"dataUrl,omitempty"`
	StoragePath   string `json:"storagePath,omitempty"`
	PreviewURL    string `json:"previewUrl,omitempty"`
	PreviewPath   string `json:"previewPath,omitempty"`
	ThumbnailURL  string `json:"thumbnailUrl,omitempty"`
	ThumbnailPath string `json:"thumbnailPath,omitempty"`
	Content       string `json:"content,omitempty"`
	FileName      string `json:"fileName,omitempty"`
}

func (s *StorageService) objectStoreClient() storageObjectStore {
	if s.objectStore != nil {
		return s.objectStore
	}
	if s.uploader != nil {
		return s.uploader
	}
	return nil
}

func (s *StorageService) databaseClient() storageDB {
	if s.db != nil {
		return s.db
	}
	if s.pool != nil {
		return s.pool
	}
	return nil
}

// StageFromURL downloads an image without transforming it and stages the raw
// bytes at the exact caller-supplied storage path.
func (s *StorageService) StageFromURL(ctx context.Context, sourceURL, storagePath string) (*StagedImage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build download request: %w", err)
	}
	client := s.client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to download image: status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageSize+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read image data: %w", err)
	}
	if len(data) > maxImageSize {
		return nil, fmt.Errorf("image exceeds maximum size of %d bytes", maxImageSize)
	}

	return s.StageFromBuffer(ctx, data, inferImageMime(resp.Header.Get("Content-Type")), storagePath)
}

// StageFromBuffer uploads raw image bytes at an exact storage path and
// returns a checksum of the bytes that were handed to the object store.
func (s *StorageService) StageFromBuffer(ctx context.Context, data []byte, mime, storagePath string) (*StagedImage, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("image data is empty")
	}
	if len(data) > maxImageSize {
		return nil, fmt.Errorf("image exceeds maximum size of %d bytes", maxImageSize)
	}
	if strings.TrimSpace(storagePath) == "" {
		return nil, fmt.Errorf("storage path is required")
	}
	store := s.objectStoreClient()
	if store == nil {
		return nil, fmt.Errorf("storage object store is not configured")
	}

	// Keep an owned copy so an uploader cannot mutate the caller's buffer while
	// the checksum and reported size are being derived.
	payload := append([]byte(nil), data...)
	sum := sha256.Sum256(payload)
	if _, err := store.Upload(ctx, storagePath, payload, mime); err != nil {
		return nil, fmt.Errorf("failed to stage image: %w", err)
	}

	return &StagedImage{
		StoragePath: storagePath,
		Mime:        mime,
		Bytes:       len(payload),
		SHA256:      hex.EncodeToString(sum[:]),
	}, nil
}

// DeleteObjects strictly removes every non-empty path. All paths are
// attempted even when one deletion fails; errors are returned to the caller.
func (s *StorageService) DeleteObjects(ctx context.Context, paths ...string) error {
	store := s.objectStoreClient()
	needsDeletion := false
	for _, storagePath := range paths {
		if strings.TrimSpace(storagePath) != "" {
			needsDeletion = true
			break
		}
	}
	if !needsDeletion {
		return nil
	}
	if store == nil {
		return fmt.Errorf("storage object store is not configured")
	}

	var errs []error
	for _, storagePath := range paths {
		if strings.TrimSpace(storagePath) == "" {
			continue
		}
		if err := store.Delete(ctx, storagePath); err != nil {
			errs = append(errs, fmt.Errorf("failed to delete object %q: %w", storagePath, err))
		}
	}
	return errors.Join(errs...)
}

// DeleteImageHistoryByID removes one history row and then strictly cleans up
// its stored objects. It is intended for worker paths that must surface
// cleanup failures instead of silently leaving orphaned objects.
func (s *StorageService) DeleteImageHistoryByID(ctx context.Context, id string) error {
	db := s.databaseClient()
	if db == nil {
		return fmt.Errorf("storage database is not configured")
	}

	var storagePath, previewPath, thumbnailPath string
	row := db.QueryRow(ctx, `
		SELECT COALESCE(storage_path, ''), COALESCE(preview_path, ''), COALESCE(thumbnail_path, '')
		FROM image_generations
		WHERE id = $1
	`, id)
	if err := row.Scan(&storagePath, &previewPath, &thumbnailPath); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("failed to query image history %q: %w", id, err)
	}

	if _, err := db.Exec(ctx, `DELETE FROM image_generations WHERE id = $1`, id); err != nil {
		return fmt.Errorf("failed to delete image history %q: %w", id, err)
	}
	return s.DeleteObjects(ctx, storagePath, previewPath, thumbnailPath)
}

// StoreFromURL downloads an image from URL, processes it, and stores it.
// The pathHint is used to build the storage path; if empty, a random path is generated.
func (s *StorageService) StoreFromURL(ctx context.Context, url, pathHint string) (*StoredImage, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build download request: %w", err)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to download image: status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageSize))
	if err != nil {
		return nil, fmt.Errorf("failed to read image data: %w", err)
	}

	contentType := resp.Header.Get("Content-Type")
	mime := "image/png"
	if strings.Contains(contentType, "jpeg") || strings.Contains(contentType, "jpg") {
		mime = "image/jpeg"
	} else if strings.Contains(contentType, "webp") {
		mime = "image/webp"
	} else if strings.Contains(contentType, "gif") {
		mime = "image/gif"
	}

	return s.StoreFromBuffer(ctx, data, mime, pathHint)
}

// StoreFromBuffer processes image data and uploads the original, preview, and thumbnail.
func (s *StorageService) StoreFromBuffer(ctx context.Context, data []byte, mime, hint string) (*StoredImage, error) {
	storagePath := imageStoragePath(mime, hint)
	return s.StoreFromBufferAtPath(ctx, data, mime, storagePath)
}

// StoreFromBufferAtPath processes image data and uploads variants to a specific storage path prefix.
func (s *StorageService) StoreFromBufferAtPath(ctx context.Context, data []byte, mime, storagePath string) (*StoredImage, error) {
	if storagePath == "" {
		storagePath = imageStoragePath(mime, "")
	}

	if s.processor == nil {
		return nil, fmt.Errorf("image processor not configured")
	}

	processed, err := s.processor.ProcessImage(data, storagePath)
	if err != nil {
		return nil, fmt.Errorf("failed to process image: %w", err)
	}

	if s.uploader == nil {
		return nil, fmt.Errorf("storage uploader is not configured")
	}

	uploadedKeys := make([]string, 0, 3)

	originalURL, err := s.uploader.Upload(ctx, processed.Original.Path, processed.Original.Data, processed.Original.Mime)
	if err != nil {
		return nil, fmt.Errorf("failed to upload original: %w", err)
	}
	uploadedKeys = append(uploadedKeys, processed.Original.Path)

	previewURL, err := s.uploader.Upload(ctx, processed.Preview.Path, processed.Preview.Data, processed.Preview.Mime)
	if err != nil {
		s.cleanupUploaded(uploadedKeys)
		return nil, fmt.Errorf("failed to upload preview: %w", err)
	}
	uploadedKeys = append(uploadedKeys, processed.Preview.Path)

	thumbnailURL, err := s.uploader.Upload(ctx, processed.Thumbnail.Path, processed.Thumbnail.Data, processed.Thumbnail.Mime)
	if err != nil {
		s.cleanupUploaded(uploadedKeys)
		return nil, fmt.Errorf("failed to upload thumbnail: %w", err)
	}

	return &StoredImage{
		PublicURL:     originalURL,
		StoragePath:   processed.Original.Path,
		PreviewURL:    previewURL,
		PreviewPath:   processed.Preview.Path,
		ThumbnailURL:  thumbnailURL,
		ThumbnailPath: processed.Thumbnail.Path,
		Width:         processed.Width,
		Height:        processed.Height,
		Bytes:         processed.Original.Bytes,
		Mime:          processed.Original.Mime,
	}, nil
}

func (s *StorageService) cleanupUploaded(keys []string) {
	if s.uploader == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, key := range keys {
		if err := s.uploader.Delete(ctx, key); err != nil {
			log.Printf("[image-storage] failed to clean up uploaded object %s: %v", key, err)
		}
	}
}

// cleanupStorageObjects attempts to delete the original, preview, and thumbnail
// S3 objects for a deleted image history row. Failures are logged but do not
// block the DB deletion. If the uploader is nil, orphaned paths are logged.
func (s *StorageService) cleanupStorageObjects(paths ...*string) {
	var orphans []string
	for _, p := range paths {
		if p == nil || *p == "" {
			continue
		}
		orphans = append(orphans, *p)
	}
	if len(orphans) == 0 {
		return
	}
	if s.uploader == nil {
		for _, p := range orphans {
			log.Printf("[image-storage] S3 uploader not configured; orphaned object: %s", p)
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, p := range orphans {
		if err := s.uploader.Delete(ctx, p); err != nil {
			log.Printf("[image-storage] failed to delete orphaned S3 object %s: %v", p, err)
		}
	}
}

// CleanupObjects is the public, best-effort S3 cleanup entry point. It accepts
// plain string paths and delegates to the internal cleanupStorageObjects helper.
// Callers outside the storage service (e.g. the image handler) use this when
// they need to remove orphaned S3 objects without a DB row.
func (s *StorageService) CleanupObjects(paths ...string) {
	ptrs := make([]*string, len(paths))
	for i := range paths {
		ptrs[i] = &paths[i]
	}
	s.cleanupStorageObjects(ptrs...)
}

// ListObjects exposes the narrow object listing needed by reconciliation.
func (s *StorageService) ListObjects(ctx context.Context, prefix string) ([]StorageObject, error) {
	uploader := s.uploader
	if uploader == nil {
		return nil, fmt.Errorf("storage uploader is not configured")
	}
	return uploader.ListObjects(ctx, prefix)
}

// DownloadImage downloads a stored image from S3-compatible storage.
func (s *StorageService) DownloadImage(ctx context.Context, storagePath string) (*DownloadedImage, error) {
	if s.uploader != nil && s.uploader.client != nil {
		resp, err := s.uploader.client.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(s.uploader.bucket),
			Key:    aws.String(storagePath),
		})
		if err != nil {
			return nil, fmt.Errorf("failed to download from storage: %w", err)
		}
		defer resp.Body.Close()

		data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageSize))
		if err != nil {
			return nil, fmt.Errorf("failed to read storage response: %w", err)
		}

		mime := ""
		if resp.ContentType != nil {
			mime = *resp.ContentType
		}
		if mime == "" {
			mime = mimeFromStoragePath(storagePath)
		}
		return &DownloadedImage{Data: data, Mime: mime}, nil
	}

	// Fallback: try public URL
	if s.uploader == nil {
		return nil, fmt.Errorf("storage is not configured")
	}
	publicURL := s.getPublicURL(storagePath)
	if publicURL == "" {
		return nil, fmt.Errorf("storage is not configured")
	}

	req, err := http.NewRequestWithContext(ctx, "GET", publicURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build download request: %w", err)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("storage download returned %d: %s", resp.StatusCode, string(body))
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageSize))
	if err != nil {
		return nil, fmt.Errorf("failed to read storage response: %w", err)
	}

	mime := resp.Header.Get("Content-Type")
	if mime == "" {
		mime = mimeFromStoragePath(storagePath)
	}
	return &DownloadedImage{Data: data, Mime: mime}, nil
}

// SaveImageHistory saves an image generation to history
func (s *StorageService) SaveImageHistory(ctx context.Context, item *ImageHistoryItem, userID string) error {
	db := s.databaseClient()
	if db == nil {
		return nil
	}

	// Default nil references to empty array so json.Marshal produces "[]" not "null".
	refs := item.References
	if refs == nil {
		refs = []ImageHistoryReference{}
	}

	references, err := json.Marshal(refs)
	if err != nil {
		return fmt.Errorf("failed to marshal reference images: %w", err)
	}
	referencesJSON, err := jsonStringForJSONB(references)
	if err != nil {
		log.Printf("[image-history] invalid reference_images: %v", err)
		return fmt.Errorf("invalid reference_images: %w", err)
	}

	visibility := item.Visibility
	if visibility == "" {
		visibility = "public"
	}
	fundingSource := item.FundingSource
	if fundingSource == "" {
		fundingSource = "free"
	}
	referenceCount := item.ReferenceCount
	if referenceCount == 0 {
		referenceCount = len(item.References)
	}
	generatedAt := item.Timestamp
	if generatedAt.IsZero() {
		generatedAt = time.Now()
	}
	var expiresAt sql.NullTime
	if fundingSource == "credit" {
		expiresAt = sql.NullTime{Time: generatedAt.Add(7 * 24 * time.Hour), Valid: true}
	}
	var creditTxID any
	if item.CreditTransactionID != "" {
		creditTxID = item.CreditTransactionID
	}
	insertUserID := nullableString(firstNonEmpty(userID, item.UserID))

	query := `
		INSERT INTO image_generations (
			id, user_id, generation_batch_id, prompt, user_prompt, system_prompt,
			model_prompt, revised_prompt, data_url, storage_path, preview_url, preview_path,
			thumbnail_url, thumbnail_path, size, aspect_ratio, resolution, quality,
			reference_images, reference_count, image_model, image_width, image_height,
			original_bytes, visibility, funding_source, credit_cost, credit_transaction_id,
			expires_at, generated_at
		) VALUES (
			$1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11,
			$12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21,
			$22, $23, $24, $25, $26, $27, $28::uuid, $29, $30
		)
		ON CONFLICT (id) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			generation_batch_id = EXCLUDED.generation_batch_id,
			prompt = EXCLUDED.prompt,
			user_prompt = EXCLUDED.user_prompt,
			system_prompt = EXCLUDED.system_prompt,
			model_prompt = EXCLUDED.model_prompt,
			revised_prompt = EXCLUDED.revised_prompt,
			data_url = EXCLUDED.data_url,
			storage_path = EXCLUDED.storage_path,
			preview_url = EXCLUDED.preview_url,
			preview_path = EXCLUDED.preview_path,
			thumbnail_url = EXCLUDED.thumbnail_url,
			thumbnail_path = EXCLUDED.thumbnail_path,
			size = EXCLUDED.size,
			aspect_ratio = EXCLUDED.aspect_ratio,
			resolution = EXCLUDED.resolution,
			quality = EXCLUDED.quality,
			image_model = EXCLUDED.image_model,
			reference_images = EXCLUDED.reference_images,
			reference_count = EXCLUDED.reference_count,
			image_width = EXCLUDED.image_width,
			image_height = EXCLUDED.image_height,
			original_bytes = EXCLUDED.original_bytes,
			visibility = EXCLUDED.visibility,
			funding_source = EXCLUDED.funding_source,
			credit_cost = EXCLUDED.credit_cost,
			credit_transaction_id = EXCLUDED.credit_transaction_id,
			expires_at = EXCLUDED.expires_at,
			generated_at = EXCLUDED.generated_at
	`

	_, err = db.Exec(ctx, query,
		item.ID, insertUserID, nullableString(item.GenerationBatchID),
		item.Prompt, nullableString(firstNonEmpty(item.UserPrompt, item.Prompt)),
		nullableString(item.SystemPrompt), nullableString(firstNonEmpty(item.ModelPrompt, item.Prompt)),
		nullableString(item.RevisedPrompt), nullableString(item.URL), nullableString(item.StoragePath),
		nullableString(item.PreviewURL), nullableString(item.PreviewPath),
		nullableString(item.ThumbnailURL), nullableString(item.ThumbnailPath),
		item.Size, nullableString(item.AspectRatio), nullableString(item.Resolution),
		nullableString(item.Quality), referencesJSON, referenceCount, nullableString(item.ImageModel),
		nullableInt(item.Width), nullableInt(item.Height), nullableInt(item.Bytes),
		visibility, fundingSource, item.CreditCost, creditTxID, expiresAt, generatedAt,
	)

	return err
}

// ListImageHistory lists image history
func (s *StorageService) ListImageHistory(ctx context.Context, userID, scope string, limit, offset int) (*ImageHistory, error) {
	if s.pool == nil {
		return &ImageHistory{Images: []ImageHistoryItem{}, Total: 0}, nil
	}

	var query string
	var countQuery string
	var args []any

	if scope == "mine" && userID != "" {
		query = `
			SELECT id, coalesce(user_id::text, ''), coalesce(generation_batch_id, ''),
			       prompt, coalesce(user_prompt, ''), coalesce(revised_prompt, ''),
			       coalesce(storage_path, ''), coalesce(preview_url, ''), coalesce(preview_path, ''),
			       coalesce(thumbnail_url, ''), coalesce(thumbnail_path, ''),
			       size, coalesce(aspect_ratio, ''), coalesce(resolution, ''), coalesce(quality, ''),
			       coalesce(image_model, ''), coalesce(image_width, 0), coalesce(image_height, 0),
			       generated_at, coalesce(reference_images, '[]'::jsonb), coalesce(reference_count, 0),
			       coalesce(visibility, 'public'), coalesce(funding_source, 'free'), coalesce(credit_cost, 0)
			FROM image_generations
			WHERE user_id = $1::uuid AND visibility = 'private'
			  AND (expires_at IS NULL OR expires_at > now())
			ORDER BY generated_at DESC
			LIMIT $2 OFFSET $3
		`
		countQuery = `SELECT COUNT(*) FROM image_generations WHERE user_id = $1::uuid AND visibility = 'private' AND (expires_at IS NULL OR expires_at > now())`
		args = []any{userID, limit, offset}
	} else {
		query = `
			SELECT id, coalesce(user_id::text, ''), coalesce(generation_batch_id, ''),
			       prompt, coalesce(user_prompt, ''), coalesce(revised_prompt, ''),
			       coalesce(storage_path, ''), coalesce(preview_url, ''), coalesce(preview_path, ''),
			       coalesce(thumbnail_url, ''), coalesce(thumbnail_path, ''),
			       size, coalesce(aspect_ratio, ''), coalesce(resolution, ''), coalesce(quality, ''),
			       coalesce(image_model, ''), coalesce(image_width, 0), coalesce(image_height, 0),
			       generated_at, coalesce(reference_images, '[]'::jsonb), coalesce(reference_count, 0),
			       coalesce(visibility, 'public'), coalesce(funding_source, 'free'), coalesce(credit_cost, 0)
			FROM image_generations
			WHERE visibility = 'public'
			ORDER BY generated_at DESC
			LIMIT $1 OFFSET $2
		`
		countQuery = `SELECT COUNT(*) FROM image_generations WHERE visibility = 'public'`
		args = []any{limit, offset}
	}

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query history: %w", err)
	}
	defer rows.Close()

	images := make([]ImageHistoryItem, 0)
	for rows.Next() {
		var item ImageHistoryItem
		var generatedAt time.Time
		var references []byte
		err := rows.Scan(
			&item.ID, &item.UserID, &item.GenerationBatchID, &item.Prompt, &item.UserPrompt,
			&item.RevisedPrompt, &item.StoragePath, &item.PreviewURL, &item.PreviewPath,
			&item.ThumbnailURL, &item.ThumbnailPath, &item.Size, &item.AspectRatio,
			&item.Resolution, &item.Quality, &item.ImageModel, &item.Width, &item.Height,
			&generatedAt, &references, &item.ReferenceCount, &item.Visibility,
			&item.FundingSource, &item.CreditCost,
		)
		if err != nil {
			log.Printf("[image-history] failed to scan history row: %v", err)
			continue
		}
		item.Timestamp = generatedAt
		item.References = decodeReferences(references)
		if item.StoragePath != "" {
			item.URL = s.getPublicURL(item.StoragePath)
			if item.PreviewURL == "" {
				item.PreviewURL = item.URL
			}
		}
		images = append(images, item)
	}

	// Get total count — use the same scope-specific query
	var total int
	if scope == "mine" && userID != "" {
		if err := s.pool.QueryRow(ctx, countQuery, userID).Scan(&total); err != nil {
			return nil, fmt.Errorf("failed to count private image history: %w", err)
		}
	} else {
		if err := s.pool.QueryRow(ctx, countQuery).Scan(&total); err != nil {
			return nil, fmt.Errorf("failed to count public image history: %w", err)
		}
	}

	return &ImageHistory{Images: images, Total: total}, nil
}

// GetImageHistory gets a single image history item
func (s *StorageService) GetImageHistory(ctx context.Context, id, userID, scope string) (*ImageHistoryItem, error) {
	if s.pool == nil {
		return nil, nil
	}

	var query string
	var args []any

	if scope == "mine" && userID != "" {
		query = `
			SELECT id, coalesce(user_id::text, ''), coalesce(generation_batch_id, ''),
			       prompt, coalesce(user_prompt, ''), coalesce(system_prompt, ''),
			       coalesce(model_prompt, ''), coalesce(revised_prompt, ''),
			       coalesce(storage_path, ''), coalesce(preview_url, ''), coalesce(preview_path, ''),
			       coalesce(thumbnail_url, ''), coalesce(thumbnail_path, ''),
			       size, coalesce(aspect_ratio, ''), coalesce(resolution, ''), coalesce(quality, ''),
			       coalesce(image_model, ''), coalesce(image_width, 0), coalesce(image_height, 0),
			       generated_at, coalesce(reference_images, '[]'::jsonb), coalesce(reference_count, 0),
			       coalesce(visibility, 'public'), coalesce(funding_source, 'free'), coalesce(credit_cost, 0)
			FROM image_generations
			WHERE id = $1 AND user_id = $2::uuid AND visibility = 'private'
			  AND (expires_at IS NULL OR expires_at > now())
		`
		args = []any{id, userID}
	} else {
		query = `
			SELECT id, coalesce(user_id::text, ''), coalesce(generation_batch_id, ''),
			       prompt, coalesce(user_prompt, ''), coalesce(system_prompt, ''),
			       coalesce(model_prompt, ''), coalesce(revised_prompt, ''),
			       coalesce(storage_path, ''), coalesce(preview_url, ''), coalesce(preview_path, ''),
			       coalesce(thumbnail_url, ''), coalesce(thumbnail_path, ''),
			       size, coalesce(aspect_ratio, ''), coalesce(resolution, ''), coalesce(quality, ''),
			       coalesce(image_model, ''), coalesce(image_width, 0), coalesce(image_height, 0),
			       generated_at, coalesce(reference_images, '[]'::jsonb), coalesce(reference_count, 0),
			       coalesce(visibility, 'public'), coalesce(funding_source, 'free'), coalesce(credit_cost, 0)
			FROM image_generations
			WHERE id = $1 AND visibility = 'public'
		`
		args = []any{id}
	}

	var item ImageHistoryItem
	var generatedAt time.Time
	var references []byte
	err := s.pool.QueryRow(ctx, query, args...).Scan(
		&item.ID, &item.UserID, &item.GenerationBatchID, &item.Prompt, &item.UserPrompt,
		&item.SystemPrompt, &item.ModelPrompt, &item.RevisedPrompt, &item.StoragePath,
		&item.PreviewURL, &item.PreviewPath, &item.ThumbnailURL, &item.ThumbnailPath,
		&item.Size, &item.AspectRatio, &item.Resolution, &item.Quality, &item.ImageModel,
		&item.Width, &item.Height, &generatedAt, &references, &item.ReferenceCount,
		&item.Visibility, &item.FundingSource, &item.CreditCost,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	item.Timestamp = generatedAt
	item.References = decodeReferences(references)
	if item.StoragePath != "" {
		item.URL = s.getPublicURL(item.StoragePath)
		if item.PreviewURL == "" {
			item.PreviewURL = item.URL
		}
	}

	return &item, nil
}

// GetImageVisibilityByPath returns the visibility and owner userID for an image
// identified by its storage path. Returns nil, nil when no matching DB record
// exists (e.g. reference images that were stored without a history row).
func (s *StorageService) GetImageVisibilityByPath(ctx context.Context, storagePath string) (visibility string, ownerID string, err error) {
	if s.pool == nil {
		return "", "", nil
	}
	// Match against all three path columns — any of them could be the target.
	// COALESCE NULL user_id to empty string so pgx can scan it directly into a
	// string variable (anonymous images may have no owner).
	query := `SELECT visibility, COALESCE(user_id::text, '') FROM image_generations
		WHERE storage_path = $1 OR preview_path = $1 OR thumbnail_path = $1
		LIMIT 1`
	row := s.pool.QueryRow(ctx, query, storagePath)
	err = row.Scan(&visibility, &ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", nil
		}
		return "", "", err
	}
	return visibility, ownerID, nil
}

// DeleteImageHistory deletes an image history item
func (s *StorageService) DeleteImageHistory(ctx context.Context, id, userID string) (bool, error) {
	if s.pool == nil {
		return false, nil
	}

	// Query storage paths before deleting so we can attempt S3 cleanup.
	// Use COALESCE to convert NULL to empty string, then scan into plain
	// string variables — avoids the **string double-pointer trap with pgx.
	var storagePath, previewPath, thumbnailPath string
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(storage_path, ''), COALESCE(preview_path, ''), COALESCE(thumbnail_path, '')
		 FROM image_generations WHERE id = $1 AND user_id = $2::uuid`,
		id, userID,
	).Scan(&storagePath, &previewPath, &thumbnailPath)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}

	// Best-effort S3 cleanup BEFORE DB delete — if cleanup fails, the DB
	// record survives and continues to enforce visibility/ownership checks
	// in ProxyStorage, rather than leaving generated/private objects
	// downloadable with no access-control record.
	s.cleanupStorageObjects(&storagePath, &previewPath, &thumbnailPath)

	query := `DELETE FROM image_generations WHERE id = $1 AND user_id = $2::uuid`
	result, err := s.pool.Exec(ctx, query, id, userID)
	if err != nil {
		return false, err
	}

	return result.RowsAffected() > 0, nil
}

// ClearImageHistory clears all image history for a user and best-effort removes
// the corresponding S3 objects to avoid orphaning stored images.
func (s *StorageService) ClearImageHistory(ctx context.Context, userID string) (int64, error) {
	if s.pool == nil {
		return 0, nil
	}

	// Fetch all storage paths first so we can clean up S3 objects after the
	// DB rows are deleted.
	rows, err := s.pool.Query(ctx,
		`SELECT COALESCE(storage_path, ''), COALESCE(preview_path, ''), COALESCE(thumbnail_path, '')
		 FROM image_generations WHERE user_id = $1::uuid`, userID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var orphanPaths []*string
	for rows.Next() {
		var storagePath, previewPath, thumbnailPath string
		if scanErr := rows.Scan(&storagePath, &previewPath, &thumbnailPath); scanErr != nil {
			return 0, fmt.Errorf("ClearImageHistory: failed to scan path row: %w", scanErr)
		}
		orphanPaths = append(orphanPaths, &storagePath, &previewPath, &thumbnailPath)
	}
	// Don't let a scan error mask the real error from Query.
	if rowsErr := rows.Err(); rowsErr != nil {
		return 0, rowsErr
	}

	// Delete all DB rows for the user.
	query := `DELETE FROM image_generations WHERE user_id = $1::uuid`
	result, err := s.pool.Exec(ctx, query, userID)
	if err != nil {
		return 0, err
	}

	// Best-effort S3 cleanup of orphaned objects.
	s.cleanupStorageObjects(orphanPaths...)

	return result.RowsAffected(), nil
}

// Helper functions

func (s *StorageService) getPublicURL(storagePath string) string {
	if storagePath == "" {
		return ""
	}
	if s.uploader != nil {
		return s.uploader.PublicURL(storagePath)
	}
	// Fallback to proxy URL
	return "/api/image/storage/" + storagePath
}

func getExtension(mime string) string {
	switch mime {
	case "image/jpeg", "image/jpg":
		return "jpg"
	case "image/webp":
		return "webp"
	case "image/gif":
		return "gif"
	default:
		return "png"
	}
}

func imageStoragePath(mime, hint string) string {
	extension := getExtension(mime)
	cleanHint := strings.Trim(path.Clean(strings.ReplaceAll(hint, "\\", "/")), "/")
	if cleanHint != "" && cleanHint != "." && !strings.Contains(cleanHint, "..") {
		if path.Ext(cleanHint) == "" {
			cleanHint += "." + extension
		}
		return cleanHint
	}
	return fmt.Sprintf("images/%d_%s.%s", time.Now().UnixNano(), secureRandomPathPart(), extension)
}

func secureRandomPathPart() string {
	var randomBytes [16]byte
	if _, err := crand.Read(randomBytes[:]); err != nil {
		log.Printf("[image-storage] crypto random path generation failed: %v", err)
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x", randomBytes[:])
}

func mimeFromStoragePath(storagePath string) string {
	switch strings.ToLower(path.Ext(storagePath)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	default:
		return "image/png"
	}
}

func inferImageMime(contentType string) string {
	contentType = strings.ToLower(contentType)
	switch {
	case strings.Contains(contentType, "jpeg"), strings.Contains(contentType, "jpg"):
		return "image/jpeg"
	case strings.Contains(contentType, "webp"):
		return "image/webp"
	case strings.Contains(contentType, "gif"):
		return "image/gif"
	default:
		return "image/png"
	}
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableInt(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// jsonStringForJSONB validates that raw bytes are valid UTF-8 and valid JSON,
// then returns a string that pgx encodes as PostgreSQL text — which can be
// correctly cast to jsonb. Passing []byte directly to pgx causes it to be
// encoded as bytea, leading to 22P02 errors when PostgreSQL tries to cast
// bytea → jsonb.
func jsonStringForJSONB(data []byte) (string, error) {
	if !utf8.Valid(data) {
		preview := string(data)
		if len(preview) > 200 {
			preview = preview[:200] + "..."
		}
		return "", fmt.Errorf("non-UTF-8 bytes in JSON (len=%d, preview=%q)", len(data), preview)
	}
	if !json.Valid(data) {
		preview := string(data)
		if len(preview) > 200 {
			preview = preview[:200] + "..."
		}
		return "", fmt.Errorf("invalid JSON (len=%d, preview=%q)", len(data), preview)
	}
	return string(data), nil
}

func decodeReferences(data []byte) []ImageHistoryReference {
	if len(data) == 0 {
		return nil
	}
	var references []ImageHistoryReference
	if err := json.Unmarshal(data, &references); err != nil {
		return nil
	}
	return references
}
