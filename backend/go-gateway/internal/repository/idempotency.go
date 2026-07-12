package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// idempotencyDB is the narrow database surface needed by idempotency
// operations. Keeping the seam small makes ordering and failure behavior
// testable without coupling tests to a live pool.
type idempotencyDB interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

// IdempotencyRecord represents a stored idempotency entry
type IdempotencyRecord struct {
	ID            string          `json:"id"`
	UserID        string          `json:"user_id"`
	Key           string          `json:"idem_key"`
	Scope         string          `json:"scope"`
	RequestHash   string          `json:"request_hash"`
	Status        string          `json:"status"`
	ResponseCode  *int16          `json:"response_code,omitempty"`
	ResponseBody  json.RawMessage `json:"response_body,omitempty"`
	TransactionID *string         `json:"transaction_id,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	ExpiresAt     time.Time       `json:"expires_at"`
}

// IdempotencyRepository handles idempotency key database operations
type IdempotencyRepository struct {
	pool *pgxpool.Pool
	db   idempotencyDB
}

// NewIdempotencyRepository creates a new idempotency repository
func NewIdempotencyRepository(pool *pgxpool.Pool) *IdempotencyRepository {
	return &IdempotencyRepository{pool: pool}
}

// processingTimeout is how long a pre-job "processing" record is considered
// valid. Once a durable image job exists, its staging lease owns liveness.
const processingTimeout = 15 * time.Minute

func (r *IdempotencyRepository) databaseClient() idempotencyDB {
	if r.db != nil {
		return r.db
	}
	return r.pool
}

// AcquireResult describes the outcome of an Acquire call
type AcquireResult struct {
	// Status: "new" (proceed), "replay" (return cached), "conflict" (reject 409)
	Status string
	// Record is populated when Status is "replay"
	Record *IdempotencyRecord
}

// Acquire attempts to claim an idempotency key for the given user and scope.
//
// Returns:
//   - AcquireResult{Status: "new"}    — key claimed, caller should proceed with the operation
//   - AcquireResult{Status: "replay"} — key already completed with matching fingerprint,
//     Record contains the cached response
//   - AcquireResult{Status: "conflict"} — key exists with a DIFFERENT fingerprint,
//     the same key is being reused for a different request (caller should return 409)
//
// Stale "processing" records (older than processingTimeout) are reclaimed automatically.
func (r *IdempotencyRepository) Acquire(
	ctx context.Context,
	userID, idemKey, scope, requestHash string,
) (*AcquireResult, error) {
	db := r.databaseClient()
	if db == nil {
		return nil, errors.New("idempotency database client is nil")
	}

	// Try INSERT first — the common path for new requests
	insertQuery := `
		INSERT INTO idempotency_keys (user_id, idem_key, scope, request_hash, status)
		VALUES ($1::uuid, $2, $3, $4, 'processing')
		ON CONFLICT (user_id, idem_key, scope) DO NOTHING
		RETURNING id
	`

	var newID string
	err := db.QueryRow(ctx, insertQuery, userID, idemKey, scope, requestHash).Scan(&newID)
	if err == nil {
		// INSERT succeeded — new key claimed
		return &AcquireResult{Status: "new"}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("idempotency insert failed: %w", err)
	}

	// INSERT was suppressed by ON CONFLICT — look up the existing record
	existing, err := r.findByUserKeyScope(ctx, userID, idemKey, scope)
	if err != nil {
		return nil, fmt.Errorf("idempotency lookup failed: %w", err)
	}
	if existing == nil {
		// Should not happen (conflict fired but record not found), treat as new
		return &AcquireResult{Status: "new"}, nil
	}

	// A key is bound to its request body for every record state. Check this
	// before expiry, stale, or failed-record handling so a different body can
	// never reclaim the existing row.
	if existing.RequestHash != requestHash {
		return &AcquireResult{Status: "conflict"}, nil
	}

	// Completed matching requests replay the stored response regardless of the
	// idempotency row's expiry timestamp.
	if existing.Status == "completed" {
		return &AcquireResult{Status: "replay", Record: existing}, nil
	}

	if existing.Status == "processing" {
		expired := time.Now().After(existing.ExpiresAt)
		stale := time.Since(existing.CreatedAt) > processingTimeout
		if !expired && !stale {
			return &AcquireResult{Status: "conflict"}, nil
		}

		if scope == "image_generate" {
			active, err := r.hasActiveImageJob(ctx, userID, idemKey, requestHash)
			if err != nil {
				return nil, fmt.Errorf("active image job lookup failed: %w", err)
			}
			if active {
				return &AcquireResult{Status: "conflict"}, nil
			}
		}

		if err := r.reclaim(ctx, existing.ID, requestHash); err != nil {
			return nil, fmt.Errorf("idempotency reclaim failed: %w", err)
		}
		return &AcquireResult{Status: "new"}, nil
	}

	// Failed records may be retried with the same request body.
	if existing.Status == "failed" {
		if err := r.reclaim(ctx, existing.ID, requestHash); err != nil {
			return nil, fmt.Errorf("idempotency reclaim failed: %w", err)
		}
		return &AcquireResult{Status: "new"}, nil
	}

	return &AcquireResult{Status: "conflict"}, nil
}

// Complete marks an idempotency record as completed with the response to cache.
func (r *IdempotencyRepository) Complete(
	ctx context.Context,
	userID, idemKey, scope string,
	responseCode int16,
	responseBody any,
	transactionID string,
) error {
	bodyJSON, err := json.Marshal(responseBody)
	if err != nil {
		return fmt.Errorf("failed to marshal response body: %w", err)
	}

	var txID *string
	if transactionID != "" {
		txID = &transactionID
	}

	query := `
		UPDATE idempotency_keys
		SET status = 'completed',
		    response_code = $4,
		    response_body = $5,
		    transaction_id = $6::uuid
		WHERE user_id = $1::uuid AND idem_key = $2 AND scope = $3
		  AND status = 'processing'
	`

	db := r.databaseClient()
	if db == nil {
		return errors.New("idempotency database client is nil")
	}
	result, err := db.Exec(ctx, query, userID, idemKey, scope, responseCode, bodyJSON, txID)
	if err != nil {
		return fmt.Errorf("failed to complete idempotency record: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("idempotency record was not completed because it was missing or not processing")
	}
	return nil
}

// Fail marks an idempotency record as failed, allowing future retries with the same key.
func (r *IdempotencyRepository) Fail(
	ctx context.Context,
	userID, idemKey, scope string,
) error {
	query := `
		UPDATE idempotency_keys
		SET status = 'failed'
		WHERE user_id = $1::uuid AND idem_key = $2 AND scope = $3
		  AND status = 'processing'
	`

	db := r.databaseClient()
	if db == nil {
		return errors.New("idempotency database client is nil")
	}
	result, err := db.Exec(ctx, query, userID, idemKey, scope)
	if err != nil {
		return fmt.Errorf("failed to mark idempotency record as failed: %w", err)
	}
	if result.RowsAffected() == 0 {
		return errors.New("idempotency record was not marked as failed because it was missing or not processing")
	}
	return nil
}

// findByUserKeyScope looks up an existing idempotency record
func (r *IdempotencyRepository) findByUserKeyScope(
	ctx context.Context,
	userID, idemKey, scope string,
) (*IdempotencyRecord, error) {
	query := `
		SELECT id, user_id, idem_key, scope, request_hash, status,
		       response_code, response_body, transaction_id, created_at, expires_at
		FROM idempotency_keys
		WHERE user_id = $1::uuid AND idem_key = $2 AND scope = $3
	`

	var rec IdempotencyRecord
	db := r.databaseClient()
	if db == nil {
		return nil, errors.New("idempotency database client is nil")
	}
	err := db.QueryRow(ctx, query, userID, idemKey, scope).Scan(
		&rec.ID, &rec.UserID, &rec.Key, &rec.Scope, &rec.RequestHash, &rec.Status,
		&rec.ResponseCode, &rec.ResponseBody, &rec.TransactionID, &rec.CreatedAt, &rec.ExpiresAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

// reclaim resets an existing record for reuse (expired, stale, or failed)
func (r *IdempotencyRepository) reclaim(ctx context.Context, recordID, newRequestHash string) error {
	query := `
		UPDATE idempotency_keys
		SET status = 'processing',
		    request_hash = $2,
		    response_code = NULL,
		    response_body = NULL,
		    transaction_id = NULL,
		    created_at = now(),
		    expires_at = now() + interval '24 hours'
		WHERE id = $1
	`

	db := r.databaseClient()
	if db == nil {
		return errors.New("idempotency database client is nil")
	}
	_, err := db.Exec(ctx, query, recordID, newRequestHash)
	return err
}

// hasActiveImageJob checks whether durable image-generation work still owns
// this idempotency key. A completed job is included because the stale
// idempotency row cannot safely reconstruct its cached HTTP response.
func (r *IdempotencyRepository) hasActiveImageJob(
	ctx context.Context,
	userID, idemKey, requestHash string,
) (bool, error) {
	query := `
		SELECT 1
		FROM public.image_generation_jobs
		WHERE user_id = $1::uuid
		  AND idempotency_key = $2
		  AND request_hash = $3
		  AND status IN (
			'staging',
			'persistence_pending',
			'persistence_processing',
			'completed',
			'refund_pending'
		  )
		LIMIT 1
	`

	var marker int
	db := r.databaseClient()
	if db == nil {
		return false, errors.New("idempotency database client is nil")
	}
	err := db.QueryRow(ctx, query, userID, idemKey, requestHash).Scan(&marker)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
