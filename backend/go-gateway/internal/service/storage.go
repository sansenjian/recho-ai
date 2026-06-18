package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"path"
	"strings"
	"time"

	"go-gateway/internal/config"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CreditReservation holds credit reservation info
type CreditReservation struct {
	TransactionID string
	Amount        float64
	Balance       float64
}

// StorageService handles image storage operations
type StorageService struct {
	pool   *pgxpool.Pool
	client *http.Client // reused HTTP client for storage uploads
}

// NewStorageService creates a new storage service
func NewStorageService(pool *pgxpool.Pool) *StorageService {
	return &StorageService{
		pool: pool,
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

// StoreFromURL downloads an image from URL and stores it
func (s *StorageService) StoreFromURL(ctx context.Context, url string) (*StoredImage, error) {
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

	data, err := io.ReadAll(resp.Body)
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

	return s.StoreFromBuffer(ctx, data, mime, "")
}

// StoreFromBuffer uploads image data to Supabase Storage
func (s *StorageService) StoreFromBuffer(ctx context.Context, data []byte, mime, hint string) (*StoredImage, error) {
	storagePath := imageStoragePath(mime, hint)
	return s.StoreFromBufferAtPath(ctx, data, mime, storagePath)
}

// StoreFromBufferAtPath uploads image data to a specific storage path.
func (s *StorageService) StoreFromBufferAtPath(ctx context.Context, data []byte, mime, storagePath string) (*StoredImage, error) {
	if storagePath == "" {
		storagePath = imageStoragePath(mime, "")
	}
	// Upload to Supabase Storage if configured
	if config.SupabaseURL != "" && config.SupabaseServiceRoleKey != "" && config.SupabaseImageBucket != "" {
		publicURL, err := s.uploadToSupabaseStorage(ctx, data, storagePath, mime)
		if err != nil {
			return nil, fmt.Errorf("failed to upload to storage: %w", err)
		}
		return &StoredImage{
			PublicURL:   publicURL,
			StoragePath: storagePath,
			PreviewURL:  publicURL,
			Bytes:       len(data),
			Mime:        mime,
		}, nil
	}

	// Fallback: return a proxy URL (storage not configured)
	return &StoredImage{
		PublicURL:   "/api/image/storage/" + storagePath,
		StoragePath: storagePath,
		PreviewURL:  "/api/image/storage/" + storagePath,
		Bytes:       len(data),
		Mime:        mime,
	}, nil
}

// uploadToSupabaseStorage uploads bytes to Supabase Storage via REST API.
// Returns the public URL of the uploaded object.
func (s *StorageService) uploadToSupabaseStorage(ctx context.Context, data []byte, objectPath, contentType string) (string, error) {
	uploadURL := fmt.Sprintf("%s/storage/v1/object/%s/%s",
		strings.TrimRight(config.SupabaseURL, "/"),
		config.SupabaseImageBucket,
		objectPath,
	)

	req, err := http.NewRequestWithContext(ctx, "POST", uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("failed to build upload request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+config.SupabaseServiceRoleKey)
	req.Header.Set("apikey", config.SupabaseServiceRoleKey)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("x-upsert", "false")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("upload request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("storage upload returned %d: %s", resp.StatusCode, string(body))
	}

	// Build public URL
	publicURL := fmt.Sprintf("%s/storage/v1/object/public/%s/%s",
		strings.TrimRight(config.SupabaseURL, "/"),
		config.SupabaseImageBucket,
		objectPath,
	)

	return publicURL, nil
}

// DownloadImage downloads a stored image through Supabase Storage.
func (s *StorageService) DownloadImage(ctx context.Context, storagePath string) (*DownloadedImage, error) {
	if config.SupabaseURL == "" || config.SupabaseServiceRoleKey == "" || config.SupabaseImageBucket == "" {
		return nil, fmt.Errorf("storage is not configured")
	}

	downloadURL := fmt.Sprintf("%s/storage/v1/object/%s/%s",
		strings.TrimRight(config.SupabaseURL, "/"),
		config.SupabaseImageBucket,
		storagePath,
	)

	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build download request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+config.SupabaseServiceRoleKey)
	req.Header.Set("apikey", config.SupabaseServiceRoleKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("storage download returned %d: %s", resp.StatusCode, string(body))
	}

	data, err := io.ReadAll(resp.Body)
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
	if s.pool == nil {
		return nil
	}

	references, err := json.Marshal(item.References)
	if err != nil {
		return fmt.Errorf("failed to marshal reference images: %w", err)
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

	query := `
		INSERT INTO image_generations (
			id, user_id, generation_batch_id, prompt, user_prompt, system_prompt,
			model_prompt, revised_prompt, storage_path, preview_url, preview_path,
			thumbnail_url, thumbnail_path, size, aspect_ratio, resolution, quality,
			reference_images, reference_count, image_model, image_width, image_height,
			original_bytes, visibility, funding_source, credit_cost, credit_transaction_id,
			expires_at, generated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
			$11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
			$21, $22, $23, $24, $25, $26, $27, $28, $29
		)
		ON CONFLICT (id) DO UPDATE SET
			prompt = EXCLUDED.prompt,
			storage_path = EXCLUDED.storage_path,
			preview_url = EXCLUDED.preview_url,
			reference_images = EXCLUDED.reference_images,
			reference_count = EXCLUDED.reference_count
	`

	_, err = s.pool.Exec(ctx, query,
		item.ID, nullableString(userID), nullableString(item.GenerationBatchID),
		item.Prompt, nullableString(firstNonEmpty(item.UserPrompt, item.Prompt)),
		nullableString(item.SystemPrompt), nullableString(firstNonEmpty(item.ModelPrompt, item.Prompt)),
		nullableString(item.RevisedPrompt), nullableString(item.StoragePath),
		nullableString(item.PreviewURL), nullableString(item.PreviewPath),
		nullableString(item.ThumbnailURL), nullableString(item.ThumbnailPath),
		item.Size, nullableString(item.AspectRatio), nullableString(item.Resolution),
		nullableString(item.Quality), references, referenceCount, nullableString(item.ImageModel),
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
			WHERE user_id = $1 AND visibility = 'private'
			  AND (expires_at IS NULL OR expires_at > now())
			ORDER BY generated_at DESC
			LIMIT $2 OFFSET $3
		`
		countQuery = `SELECT COUNT(*) FROM image_generations WHERE user_id = $1 AND visibility = 'private' AND (expires_at IS NULL OR expires_at > now())`
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
		s.pool.QueryRow(ctx, countQuery, userID).Scan(&total)
	} else {
		s.pool.QueryRow(ctx, countQuery).Scan(&total)
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
			WHERE id = $1 AND user_id = $2 AND visibility = 'private'
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

// DeleteImageHistory deletes an image history item
func (s *StorageService) DeleteImageHistory(ctx context.Context, id, userID string) (bool, error) {
	if s.pool == nil {
		return false, nil
	}

	query := `DELETE FROM image_generations WHERE id = $1 AND user_id = $2`
	result, err := s.pool.Exec(ctx, query, id, userID)
	if err != nil {
		return false, err
	}

	return result.RowsAffected() > 0, nil
}

// ClearImageHistory clears all image history for a user
func (s *StorageService) ClearImageHistory(ctx context.Context, userID string) (int64, error) {
	if s.pool == nil {
		return 0, nil
	}

	query := `DELETE FROM image_generations WHERE user_id = $1`
	result, err := s.pool.Exec(ctx, query, userID)
	if err != nil {
		return 0, err
	}

	return result.RowsAffected(), nil
}

// Helper functions

func (s *StorageService) getPublicURL(storagePath string) string {
	if storagePath == "" {
		return ""
	}
	// Use direct Supabase Storage public URL if configured
	if config.SupabaseURL != "" && config.SupabaseImageBucket != "" {
		return fmt.Sprintf("%s/storage/v1/object/public/%s/%s",
			strings.TrimRight(config.SupabaseURL, "/"),
			config.SupabaseImageBucket,
			storagePath,
		)
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
	return fmt.Sprintf("images/%d_%d.%s", time.Now().UnixNano(), rand.Int63(), extension)
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
