package repository

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type scriptedDBCall struct {
	kind  string
	query string
	args  []any
}

type scriptedDB struct {
	queryRows []pgx.Row
	queryErrs []error
	execTags  []pgconn.CommandTag
	execErrs  []error
	calls     []scriptedDBCall
}

func (db *scriptedDB) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	db.calls = append(db.calls, scriptedDBCall{kind: "query", query: query, args: append([]any(nil), args...)})
	row := scriptedRow{err: pgx.ErrNoRows}
	if len(db.queryRows) > 0 {
		row = db.queryRows[0].(scriptedRow)
		db.queryRows = db.queryRows[1:]
	}
	if len(db.queryErrs) > 0 {
		row.err = db.queryErrs[0]
		db.queryErrs = db.queryErrs[1:]
	}
	return row
}

func (db *scriptedDB) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	db.calls = append(db.calls, scriptedDBCall{kind: "exec", query: query, args: append([]any(nil), args...)})
	tag := pgconn.NewCommandTag("UPDATE 1")
	if len(db.execTags) > 0 {
		tag = db.execTags[0]
		db.execTags = db.execTags[1:]
	}
	var err error
	if len(db.execErrs) > 0 {
		err = db.execErrs[0]
		db.execErrs = db.execErrs[1:]
	}
	return tag, err
}

type scriptedRow struct {
	scan func(...any) error
	err  error
}

func (r scriptedRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if r.scan != nil {
		return r.scan(dest...)
	}
	return nil
}

func idempotencyRecordRow(record IdempotencyRecord) scriptedRow {
	return scriptedRow{scan: func(dest ...any) error {
		if len(dest) != 11 {
			return errors.New("unexpected idempotency record scan shape")
		}
		*(dest[0].(*string)) = record.ID
		*(dest[1].(*string)) = record.UserID
		*(dest[2].(*string)) = record.Key
		*(dest[3].(*string)) = record.Scope
		*(dest[4].(*string)) = record.RequestHash
		*(dest[5].(*string)) = record.Status
		*(dest[6].(**int16)) = record.ResponseCode
		*(dest[7].(*json.RawMessage)) = record.ResponseBody
		*(dest[8].(**string)) = record.TransactionID
		*(dest[9].(*time.Time)) = record.CreatedAt
		*(dest[10].(*time.Time)) = record.ExpiresAt
		return nil
	}}
}

func TestAcquireConflictingHashIsNotReclaimed(t *testing.T) {
	now := time.Now()
	db := &scriptedDB{
		queryRows: []pgx.Row{
			scriptedRow{err: pgx.ErrNoRows},
			idempotencyRecordRow(IdempotencyRecord{
				ID:          "record-1",
				UserID:      "user-1",
				Key:         "key-1",
				Scope:       "image_generate",
				RequestHash: "different-hash",
				Status:      "processing",
				CreatedAt:   now.Add(-time.Hour),
				ExpiresAt:   now.Add(-time.Minute),
			}),
		},
	}

	repo := &IdempotencyRepository{db: db}
	result, err := repo.Acquire(context.Background(), "user-1", "key-1", "image_generate", "request-hash")
	if err != nil {
		t.Fatalf("Acquire returned error: %v", err)
	}
	if result.Status != "conflict" {
		t.Fatalf("expected conflict, got %q", result.Status)
	}
	if len(db.calls) != 2 {
		t.Fatalf("expected insert and lookup only, got %d calls", len(db.calls))
	}
	for _, call := range db.calls {
		if call.kind == "exec" && strings.Contains(call.query, "UPDATE idempotency_keys") {
			t.Fatal("conflicting request hash must not reclaim the existing record")
		}
	}
}

func TestAcquireStaleImageKeyWithActiveJobReturnsConflict(t *testing.T) {
	now := time.Now()
	db := &scriptedDB{
		queryRows: []pgx.Row{
			scriptedRow{err: pgx.ErrNoRows},
			idempotencyRecordRow(IdempotencyRecord{
				ID:          "record-2",
				UserID:      "user-2",
				Key:         "key-2",
				Scope:       "image_generate",
				RequestHash: "request-hash",
				Status:      "processing",
				CreatedAt:   now.Add(-time.Hour),
				ExpiresAt:   now.Add(-time.Minute),
			}),
			scriptedRow{},
		},
	}

	repo := &IdempotencyRepository{db: db}
	result, err := repo.Acquire(context.Background(), "user-2", "key-2", "image_generate", "request-hash")
	if err != nil {
		t.Fatalf("Acquire returned error: %v", err)
	}
	if result.Status != "conflict" {
		t.Fatalf("expected conflict while active job exists, got %q", result.Status)
	}
	if len(db.calls) != 3 {
		t.Fatalf("expected insert, lookup, and active-job query, got %d calls", len(db.calls))
	}
	active := db.calls[2]
	if !strings.Contains(active.query, "public.image_generation_jobs") ||
		!strings.Contains(active.query, "staging") ||
		!strings.Contains(active.query, "persistence_pending") ||
		!strings.Contains(active.query, "persistence_processing") ||
		!strings.Contains(active.query, "completed") ||
		!strings.Contains(active.query, "refund_pending") {
		t.Fatalf("active-job query is missing required table/status predicates: %s", active.query)
	}
	if len(active.args) != 3 || active.args[0] != "user-2" || active.args[1] != "key-2" || active.args[2] != "request-hash" {
		t.Fatalf("active-job query must be parameterized by user, key, and hash; args=%#v", active.args)
	}
	if len(db.calls) > 3 {
		t.Fatal("active job must prevent reclaim")
	}
}

func TestAcquireStaleImageKeyWithoutActiveJobReclaims(t *testing.T) {
	now := time.Now()
	db := &scriptedDB{
		queryRows: []pgx.Row{
			scriptedRow{err: pgx.ErrNoRows},
			idempotencyRecordRow(IdempotencyRecord{
				ID:          "record-3",
				UserID:      "user-3",
				Key:         "key-3",
				Scope:       "image_generate",
				RequestHash: "request-hash",
				Status:      "processing",
				CreatedAt:   now.Add(-time.Hour),
				ExpiresAt:   now.Add(-time.Minute),
			}),
			scriptedRow{err: pgx.ErrNoRows},
		},
	}

	repo := &IdempotencyRepository{db: db}
	result, err := repo.Acquire(context.Background(), "user-3", "key-3", "image_generate", "request-hash")
	if err != nil {
		t.Fatalf("Acquire returned error: %v", err)
	}
	if result.Status != "new" {
		t.Fatalf("expected new after reclaim, got %q", result.Status)
	}
	if len(db.calls) != 4 || db.calls[3].kind != "exec" || !strings.Contains(db.calls[3].query, "UPDATE idempotency_keys") {
		t.Fatalf("expected active-job lookup followed by reclaim update, calls=%#v", db.calls)
	}
	if len(db.calls[3].args) < 2 || db.calls[3].args[0] != "record-3" || db.calls[3].args[1] != "request-hash" {
		t.Fatalf("reclaim must use record id and new request hash, args=%#v", db.calls[3].args)
	}
}

func TestAcquireReturnsConflictWhenConcurrentReclaimUpdatesNoRows(t *testing.T) {
	now := time.Now()
	db := &scriptedDB{
		queryRows: []pgx.Row{
			scriptedRow{err: pgx.ErrNoRows},
			idempotencyRecordRow(IdempotencyRecord{
				ID: "record-race", UserID: "user-race", Key: "key-race",
				Scope: "credit_redeem", RequestHash: "request-hash", Status: "failed",
				CreatedAt: now.Add(-time.Hour), ExpiresAt: now.Add(-time.Minute),
			}),
		},
		execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 0")},
	}

	repo := &IdempotencyRepository{db: db}
	result, err := repo.Acquire(context.Background(), "user-race", "key-race", "credit_redeem", "request-hash")
	if err != nil {
		t.Fatalf("Acquire returned error: %v", err)
	}
	if result.Status != "conflict" {
		t.Fatalf("Acquire status = %q, want conflict after lost reclaim race", result.Status)
	}
	if len(db.calls) != 3 {
		t.Fatalf("Acquire calls = %#v, want insert, lookup, reclaim", db.calls)
	}
	normalized := strings.Join(strings.Fields(strings.ToLower(db.calls[2].query)), " ")
	if !strings.Contains(normalized, "status in ('processing', 'failed')") {
		t.Fatalf("reclaim query is missing status predicate: %s", db.calls[2].query)
	}
	if !strings.Contains(normalized, "status = $3") || !strings.Contains(normalized, "created_at = $4") {
		t.Fatalf("reclaim query is missing observed-state CAS predicates: %s", db.calls[2].query)
	}
	if len(db.calls[2].args) != 4 || db.calls[2].args[2] != "failed" {
		t.Fatalf("reclaim args = %#v, want observed status and created_at", db.calls[2].args)
	}
}

func TestIdempotencyRepositoryNilPoolReturnsConfigurationError(t *testing.T) {
	repo := NewIdempotencyRepository(nil)
	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("Acquire panicked with nil pool: %v", recovered)
		}
	}()

	_, err := repo.Acquire(context.Background(), "user-1", "key-1", "image_generate", "hash")
	if err == nil || !strings.Contains(err.Error(), "database client is nil") {
		t.Fatalf("Acquire error = %v, want nil database client error", err)
	}
}

func TestFailReturnsErrorWhenNoProcessingRowWasUpdated(t *testing.T) {
	repo := &IdempotencyRepository{db: &scriptedDB{
		execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 0")},
	}}

	err := repo.Fail(context.Background(), "user-5", "key-5", "image_generate")
	if err == nil {
		t.Fatal("expected Fail to reject a zero-row update")
	}
	if !strings.Contains(err.Error(), "not marked as failed") {
		t.Fatalf("unexpected Fail error: %v", err)
	}
}
