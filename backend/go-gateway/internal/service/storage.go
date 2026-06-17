package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"go-gateway/internal/config"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CreditReservation holds credit reservation info
type CreditReservation struct {
	TransactionID string
	Amount       float64
	Balance      float64
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
			Timeout: 30 * time.Second,
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
}

// ImageHistory represents image history data
type ImageHistory struct {
	Images []ImageHistoryItem
	Total  int
}

// ImageHistoryItem represents an image history item
type ImageHistoryItem struct {
	ID             string    `json:"id"`
	Prompt         string    `json:"prompt"`
	StoragePath    string    `json:"storagePath,omitempty"`
	URL            string    `json:"url,omitempty"`
	PreviewURL     string    `json:"previewUrl,omitempty"`
	ThumbnailURL   string    `json:"thumbnailUrl,omitempty"`
	Size           string    `json:"size,omitempty"`
	AspectRatio    string    `json:"aspectRatio,omitempty"`
	Resolution     string    `json:"resolution,omitempty"`
	Quality        string    `json:"quality,omitempty"`
	ImageModel     string    `json:"imageModel,omitempty"`
	Width          int       `json:"width,omitempty"`
	Height         int       `json:"height,omitempty"`
	Timestamp      time.Time `json:"timestamp"`
	ReferenceCount int       `json:"referenceCount,omitempty"`
	Visibility     string    `json:"visibility,omitempty"`
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
	// Generate storage path
	timestamp := time.Now().UnixNano()
	random := rand.Int63()
	extension := getExtension(mime)
	storagePath := fmt.Sprintf("images/%d_%d.%s", timestamp, random, extension)

	// Upload to Supabase Storage if configured
	if config.SupabaseURL != "" && config.SupabaseServiceRoleKey != "" && config.SupabaseImageBucket != "" {
		publicURL, err := s.uploadToSupabaseStorage(ctx, data, storagePath, mime)
		if err != nil {
			return nil, fmt.Errorf("failed to upload to storage: %w", err)
		}
		return &StoredImage{
			PublicURL:   publicURL,
			StoragePath: storagePath,
			Bytes:       len(data),
		}, nil
	}

	// Fallback: return a proxy URL (storage not configured)
	return &StoredImage{
		PublicURL:   "/api/image/storage/" + storagePath,
		StoragePath: storagePath,
		Bytes:       len(data),
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

// SaveImageHistory saves an image generation to history
func (s *StorageService) SaveImageHistory(ctx context.Context, item *ImageHistoryItem, userID string) error {
	if s.pool == nil {
		return nil
	}

	query := `
		INSERT INTO image_generations (
			id, user_id, prompt, storage_path, preview_url, preview_path,
			thumbnail_url, thumbnail_path, size, aspect_ratio, resolution,
			quality, image_model, image_width, image_height, visibility,
			funding_source, credit_cost, generated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
		ON CONFLICT (id) DO UPDATE SET
			prompt = EXCLUDED.prompt,
			storage_path = EXCLUDED.storage_path
	`

	_, err := s.pool.Exec(ctx, query,
		item.ID, userID, item.Prompt, item.StoragePath,
		item.PreviewURL, "", item.ThumbnailURL, "",
		item.Size, item.AspectRatio, item.Resolution, item.Quality,
		item.ImageModel, item.Width, item.Height, item.Visibility,
		"credits", 0.5, item.Timestamp,
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
			SELECT id, prompt, storage_path, preview_url, thumbnail_url,
			       size, aspect_ratio, resolution, quality, image_model,
			       image_width, image_height, generated_at, visibility
			FROM image_generations
			WHERE user_id = $1 AND visibility = 'private'
			ORDER BY generated_at DESC
			LIMIT $2 OFFSET $3
		`
		countQuery = `SELECT COUNT(*) FROM image_generations WHERE user_id = $1 AND visibility = 'private'`
		args = []any{userID, limit, offset}
	} else {
		query = `
			SELECT id, prompt, storage_path, preview_url, thumbnail_url,
			       size, aspect_ratio, resolution, quality, image_model,
			       image_width, image_height, generated_at, visibility
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
		err := rows.Scan(
			&item.ID, &item.Prompt, &item.StoragePath,
			&item.PreviewURL, &item.ThumbnailURL,
			&item.Size, &item.AspectRatio, &item.Resolution,
			&item.Quality, &item.ImageModel,
			&item.Width, &item.Height, &generatedAt, &item.Visibility,
		)
		if err != nil {
			continue
		}
		item.Timestamp = generatedAt
		if item.StoragePath != "" {
			item.URL = s.getPublicURL(item.StoragePath)
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
			SELECT id, prompt, storage_path, preview_url, thumbnail_url,
			       size, aspect_ratio, resolution, quality, image_model,
			       image_width, image_height, generated_at, visibility
			FROM image_generations
			WHERE id = $1 AND user_id = $2 AND visibility = 'private'
		`
		args = []any{id, userID}
	} else {
		query = `
			SELECT id, prompt, storage_path, preview_url, thumbnail_url,
			       size, aspect_ratio, resolution, quality, image_model,
			       image_width, image_height, generated_at, visibility
			FROM image_generations
			WHERE id = $1 AND visibility = 'public'
		`
		args = []any{id}
	}

	var item ImageHistoryItem
	var generatedAt time.Time
	err := s.pool.QueryRow(ctx, query, args...).Scan(
		&item.ID, &item.Prompt, &item.StoragePath,
		&item.PreviewURL, &item.ThumbnailURL,
		&item.Size, &item.AspectRatio, &item.Resolution,
		&item.Quality, &item.ImageModel,
		&item.Width, &item.Height, &generatedAt, &item.Visibility,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	item.Timestamp = generatedAt
	if item.StoragePath != "" {
		item.URL = s.getPublicURL(item.StoragePath)
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
