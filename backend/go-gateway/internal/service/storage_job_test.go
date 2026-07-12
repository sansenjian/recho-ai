package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Keep one oversized fixture for the limit tests so the package does not
// allocate another 100 MB buffer for every assertion.
var oversizedImageFixture = bytes.Repeat([]byte{0x5a}, maxImageSize+1)

type storageUploadCall struct {
	path string
	mime string
	data []byte
}

type fakeStorageObjectStore struct {
	uploads      []storageUploadCall
	deletes      []string
	deleteErrors map[string]error
	mutateUpload bool
}

func (f *fakeStorageObjectStore) Upload(_ context.Context, storagePath string, data []byte, mime string) (string, error) {
	if err := f.deleteErrors["upload"]; err != nil {
		return "", err
	}
	f.uploads = append(f.uploads, storageUploadCall{
		path: storagePath,
		mime: mime,
		data: append([]byte(nil), data...),
	})
	if f.mutateUpload {
		for i := range data {
			data[i] = 0
		}
	}
	return "https://storage.example.test/" + storagePath, nil
}

func (f *fakeStorageObjectStore) Delete(_ context.Context, storagePath string) error {
	f.deletes = append(f.deletes, storagePath)
	if err := f.deleteErrors[storagePath]; err != nil {
		return err
	}
	return nil
}

func (f *fakeStorageObjectStore) PublicURL(storagePath string) string {
	return "https://storage.example.test/" + storagePath
}

type fakeStorageRow struct {
	values []string
	err    error
}

func (r fakeStorageRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != len(r.values) {
		return errors.New("unexpected scan destination count")
	}
	for i, target := range dest {
		value, ok := target.(*string)
		if !ok {
			return errors.New("unexpected scan destination type")
		}
		*value = r.values[i]
	}
	return nil
}

type fakeStorageDB struct {
	querySQL  string
	queryArgs []any
	queryRow  pgx.Row
	execSQL   string
	execArgs  []any
	execErr   error
}

func (f *fakeStorageDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execSQL = sql
	f.execArgs = append([]any(nil), args...)
	if f.execErr != nil {
		return pgconn.CommandTag{}, f.execErr
	}
	return pgconn.NewCommandTag("DELETE 1"), nil
}

func (f *fakeStorageDB) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.querySQL = sql
	f.queryArgs = append([]any(nil), args...)
	return f.queryRow
}

func TestStageFromBufferRejectsOversizedImage(t *testing.T) {
	store := &fakeStorageObjectStore{deleteErrors: map[string]error{}}
	service := &StorageService{objectStore: store}

	_, err := service.StageFromBuffer(context.Background(), oversizedImageFixture, "image/png", "images/too-large.png")
	if err == nil {
		t.Fatal("StageFromBuffer accepted an image larger than maxImageSize")
	}
	if len(store.uploads) != 0 {
		t.Fatalf("oversized image was uploaded: %d uploads", len(store.uploads))
	}
}

func TestStageFromURLRejectsBodyLargerThanLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(oversizedImageFixture)
	}))
	defer server.Close()

	store := &fakeStorageObjectStore{deleteErrors: map[string]error{}}
	service := &StorageService{client: server.Client(), objectStore: store}

	_, err := service.StageFromURL(context.Background(), server.URL, "images/too-large.png")
	if err == nil {
		t.Fatal("StageFromURL accepted a response body larger than maxImageSize")
	}
	if len(store.uploads) != 0 {
		t.Fatalf("oversized response was uploaded: %d uploads", len(store.uploads))
	}
}

func TestStageFromBufferReturnsChecksumAndExactPath(t *testing.T) {
	data := []byte("raw image bytes that must not be transformed")
	store := &fakeStorageObjectStore{
		deleteErrors: map[string]error{},
		mutateUpload: true,
	}
	service := &StorageService{objectStore: store}

	got, err := service.StageFromBuffer(context.Background(), data, "image/webp", "exact/path/output.webp")
	if err != nil {
		t.Fatalf("StageFromBuffer returned error: %v", err)
	}
	if got == nil {
		t.Fatal("StageFromBuffer returned nil result")
	}
	wantSum := sha256.Sum256(data)
	if got.SHA256 != hex.EncodeToString(wantSum[:]) {
		t.Fatalf("checksum = %q, want %q", got.SHA256, hex.EncodeToString(wantSum[:]))
	}
	if got.StoragePath != "exact/path/output.webp" {
		t.Fatalf("storage path = %q, want exact supplied path", got.StoragePath)
	}
	if got.Mime != "image/webp" {
		t.Fatalf("mime = %q, want image/webp", got.Mime)
	}
	if got.Bytes != len(data) {
		t.Fatalf("byte count = %d, want %d", got.Bytes, len(data))
	}
	if len(store.uploads) != 1 {
		t.Fatalf("uploads = %d, want 1", len(store.uploads))
	}
	if store.uploads[0].path != "exact/path/output.webp" {
		t.Fatalf("uploaded path = %q, want exact supplied path", store.uploads[0].path)
	}
	if store.uploads[0].mime != "image/webp" {
		t.Fatalf("uploaded mime = %q, want image/webp", store.uploads[0].mime)
	}
	if !bytes.Equal(store.uploads[0].data, data) {
		t.Fatal("uploaded bytes were transformed")
	}
}

func TestDeleteObjectsReturnsUploaderError(t *testing.T) {
	uploaderErr := errors.New("delete failed")
	store := &fakeStorageObjectStore{
		deleteErrors: map[string]error{"bad/object.png": uploaderErr},
	}
	service := &StorageService{objectStore: store}

	err := service.DeleteObjects(context.Background(), "", "bad/object.png", "good/object.png")
	if err == nil {
		t.Fatal("DeleteObjects returned nil after an object-store delete failure")
	}
	if !strings.Contains(err.Error(), uploaderErr.Error()) {
		t.Fatalf("DeleteObjects error = %v, want %q", err, uploaderErr)
	}
	if got, want := strings.Join(store.deletes, ","), "bad/object.png,good/object.png"; got != want {
		t.Fatalf("delete calls = %q, want %q", got, want)
	}
}

func TestSaveImageHistoryConflictUpdatesAllPermanentFields(t *testing.T) {
	db := &fakeStorageDB{}
	service := &StorageService{db: db}
	generatedAt := time.Date(2026, 7, 12, 3, 4, 5, 0, time.UTC)
	item := &ImageHistoryItem{
		ID:                  "generation-1",
		GenerationBatchID:   "batch-1",
		Prompt:              "display prompt",
		UserPrompt:          "user prompt",
		SystemPrompt:        "system prompt",
		ModelPrompt:         "model prompt",
		RevisedPrompt:       "revised prompt",
		URL:                 "https://cdn.example.test/original.png",
		StoragePath:         "images/original.png",
		PreviewURL:          "https://cdn.example.test/preview.webp",
		PreviewPath:         "images/preview.webp",
		ThumbnailURL:        "https://cdn.example.test/thumb.webp",
		ThumbnailPath:       "images/thumb.webp",
		Size:                "1024x1024",
		AspectRatio:         "1:1",
		Resolution:          "1024",
		Quality:             "high",
		ImageModel:          "image-model",
		References:          []ImageHistoryReference{{ID: "ref-1"}},
		ReferenceCount:      1,
		Width:               1024,
		Height:              1024,
		Bytes:               12345,
		Visibility:          "private",
		FundingSource:       "credit",
		CreditCost:          2.5,
		CreditTransactionID: "11111111-1111-1111-1111-111111111111",
		Timestamp:           generatedAt,
	}

	err := service.SaveImageHistory(context.Background(), item, "22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatalf("SaveImageHistory returned error: %v", err)
	}
	normalized := strings.Join(strings.Fields(strings.ToLower(db.execSQL)), " ")
	if !strings.Contains(normalized, "on conflict (id) do update set") {
		t.Fatalf("history query has no conflict update clause: %s", db.execSQL)
	}
	representativeAssignments := []string{
		"user_id = excluded.user_id",
		"generation_batch_id = excluded.generation_batch_id",
		"prompt = excluded.prompt",
		"user_prompt = excluded.user_prompt",
		"system_prompt = excluded.system_prompt",
		"model_prompt = excluded.model_prompt",
		"revised_prompt = excluded.revised_prompt",
		"data_url = excluded.data_url",
		"storage_path = excluded.storage_path",
		"preview_url = excluded.preview_url",
		"preview_path = excluded.preview_path",
		"thumbnail_url = excluded.thumbnail_url",
		"thumbnail_path = excluded.thumbnail_path",
		"size = excluded.size",
		"aspect_ratio = excluded.aspect_ratio",
		"resolution = excluded.resolution",
		"quality = excluded.quality",
		"image_model = excluded.image_model",
		"reference_images = excluded.reference_images",
		"reference_count = excluded.reference_count",
		"image_width = excluded.image_width",
		"image_height = excluded.image_height",
		"original_bytes = excluded.original_bytes",
		"visibility = excluded.visibility",
		"funding_source = excluded.funding_source",
		"credit_cost = excluded.credit_cost",
		"credit_transaction_id = excluded.credit_transaction_id",
		"expires_at = excluded.expires_at",
		"generated_at = excluded.generated_at",
	}
	for _, assignment := range representativeAssignments {
		if !strings.Contains(normalized, assignment) {
			t.Errorf("history conflict update missing %q", assignment)
		}
	}
	if !containsStorageDBArg(db.execArgs, item.URL) {
		t.Fatalf("history insert did not pass original URL as data_url: %#v", db.execArgs)
	}
}

func TestDeleteImageHistoryByIDDoesNotCastEmptyUserID(t *testing.T) {
	db := &fakeStorageDB{
		queryRow: fakeStorageRow{values: []string{"images/original.png", "images/preview.webp", "images/thumb.webp"}},
	}
	store := &fakeStorageObjectStore{deleteErrors: map[string]error{}}
	service := &StorageService{db: db, objectStore: store}

	if err := service.DeleteImageHistoryByID(context.Background(), "generation-1"); err != nil {
		t.Fatalf("DeleteImageHistoryByID returned error: %v", err)
	}
	normalizedDelete := strings.Join(strings.Fields(strings.ToLower(db.execSQL)), " ")
	if !strings.Contains(normalizedDelete, "delete from image_generations where id = $1") {
		t.Fatalf("delete query = %q, want only id predicate", db.execSQL)
	}
	if strings.Contains(normalizedDelete, "$2::uuid") {
		t.Fatalf("delete query unexpectedly casts an empty user id: %q", db.execSQL)
	}
	if len(db.execArgs) != 1 || db.execArgs[0] != "generation-1" {
		t.Fatalf("delete args = %#v, want only generation id", db.execArgs)
	}
	if got, want := strings.Join(store.deletes, ","), "images/original.png,images/preview.webp,images/thumb.webp"; got != want {
		t.Fatalf("deleted objects = %q, want %q", got, want)
	}
}

func containsStorageDBArg(args []any, want string) bool {
	for _, arg := range args {
		if value, ok := arg.(string); ok && value == want {
			return true
		}
	}
	return false
}
