package service

import (
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"time"

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
	pool *pgxpool.Pool
}

// NewStorageService creates a new storage service
func NewStorageService(pool *pgxpool.Pool) *StorageService {
	return &StorageService{pool: pool}
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
	// Download image
	resp, err := http.Get(url)
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

// StoreFromBuffer stores image data directly
func (s *StorageService) StoreFromBuffer(ctx context.Context, data []byte, mime, hint string) (*StoredImage, error) {
	// Generate storage path
	timestamp := time.Now().UnixNano()
	random := rand.Int63()
	extension := getExtension(mime)
	storagePath := fmt.Sprintf("images/%d_%d.%s", timestamp, random, extension)

	// In production, this would upload to Supabase Storage or COS
	// For now, we'll store in database as base64
	publicURL := s.getPublicURL(storagePath)

	return &StoredImage{
		PublicURL:   publicURL,
		StoragePath: storagePath,
		Width:       0,
		Height:      0,
		Bytes:       len(data),
	}, nil
}

// SaveImageHistory saves an image generation to history
func (s *StorageService) SaveImageHistory(ctx context.Context, item *ImageHistoryItem, userID string) error {
	if s.pool == nil {
		return nil // No database connection
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
	var args []any

	if scope == "mine" && userID != "" {
		query = `
			SELECT id, prompt, storage_path, preview_url, thumbnail_url,
			       size, aspect_ratio, resolution, quality, image_model,
			       image_width, image_height, generated_at, visibility
			FROM image_generations
			WHERE user_id = $1
			ORDER BY generated_at DESC
			LIMIT $2 OFFSET $3
		`
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

	// Get total count
	var total int
	countQuery := `SELECT COUNT(*) FROM image_generations WHERE ` + getScopeWhere(scope, userID)
	s.pool.QueryRow(ctx, countQuery, getScopeArgs(scope, userID)...).Scan(&total)

	return &ImageHistory{Images: images, Total: total}, nil
}

// GetImageHistory gets a single image history item
func (s *StorageService) GetImageHistory(ctx context.Context, id, userID, scope string) (*ImageHistoryItem, error) {
	if s.pool == nil {
		return nil, nil
	}

	query := `
		SELECT id, prompt, storage_path, preview_url, thumbnail_url,
		       size, aspect_ratio, resolution, quality, image_model,
		       image_width, image_height, generated_at, visibility
		FROM image_generations
		WHERE id = $1 AND ` + getScopeWhere(scope, userID)

	var item ImageHistoryItem
	var generatedAt time.Time
	err := s.pool.QueryRow(ctx, query, id, userID).Scan(
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
	// Return proxied URL - in production this would be Supabase Storage URL
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

func getScopeWhere(scope, userID string) string {
	if scope == "mine" && userID != "" {
		return "user_id = $2 AND visibility = 'private'"
	}
	return "visibility = 'public'"
}

func getScopeArgs(scope, userID string) []any {
	if scope == "mine" && userID != "" {
		return []any{userID}
	}
	return []any{}
}
