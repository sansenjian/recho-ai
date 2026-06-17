package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
}

// NewIdempotencyRepository creates a new idempotency repository
func NewIdempotencyRepository(pool *pgxpool.Pool) *IdempotencyRepository {
	return &IdempotencyRepository{pool: pool}
}

// processingTimeout is how long a "processing" record is considered valid.
// After this duration, a stuck record is treated as failed and can be reclaimed.
const processingTimeout = 5 * time.Minute

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
	// Try INSERT first — the common path for new requests
	insertQuery := `
		INSERT INTO idempotency_keys (user_id, idem_key, scope, request_hash, status)
		VALUES ($1, $2, $3, $4, 'processing')
		ON CONFLICT (user_id, idem_key, scope) DO NOTHING
		RETURNING id
	`

	var newID string
	err := r.pool.QueryRow(ctx, insertQuery, userID, idemKey, scope, requestHash).Scan(&newID)
	if err == nil {
		// INSERT succeeded — new key claimed
		return &AcquireResult{Status: "new"}, nil
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

	// Expired record — reclaim it
	if time.Now().After(existing.ExpiresAt) {
		if err := r.reclaim(ctx, existing.ID, requestHash); err != nil {
			return nil, fmt.Errorf("idempotency reclaim failed: %w", err)
		}
		return &AcquireResult{Status: "new"}, nil
	}

	// Stale "processing" record (handler crashed or timed out) — reclaim
	if existing.Status == "processing" && time.Since(existing.CreatedAt) > processingTimeout {
		if err := r.reclaim(ctx, existing.ID, requestHash); err != nil {
			return nil, fmt.Errorf("idempotency reclaim failed: %w", err)
		}
		return &AcquireResult{Status: "new"}, nil
	}

	// Still processing — tell caller to come back later
	if existing.Status == "processing" {
		return &AcquireResult{Status: "conflict"}, nil
	}

	// Failed record — allow retry
	if existing.Status == "failed" {
		if err := r.reclaim(ctx, existing.ID, requestHash); err != nil {
			return nil, fmt.Errorf("idempotency reclaim failed: %w", err)
		}
		return &AcquireResult{Status: "new"}, nil
	}

	// Completed — check fingerprint for replay vs conflict
	if existing.Status == "completed" {
		if existing.RequestHash == requestHash {
			return &AcquireResult{Status: "replay", Record: existing}, nil
		}
		// Same key, different request body — conflict
		return &AcquireResult{Status: "conflict"}, nil
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
		    transaction_id = $6
		WHERE user_id = $1 AND idem_key = $2 AND scope = $3
		  AND status = 'processing'
	`

	_, err = r.pool.Exec(ctx, query, userID, idemKey, scope, responseCode, bodyJSON, txID)
	if err != nil {
		return fmt.Errorf("failed to complete idempotency record: %w", err)
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
		WHERE user_id = $1 AND idem_key = $2 AND scope = $3
		  AND status = 'processing'
	`

	_, err := r.pool.Exec(ctx, query, userID, idemKey, scope)
	if err != nil {
		return fmt.Errorf("failed to mark idempotency record as failed: %w", err)
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
		WHERE user_id = $1 AND idem_key = $2 AND scope = $3
	`

	var rec IdempotencyRecord
	err := r.pool.QueryRow(ctx, query, userID, idemKey, scope).Scan(
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

	_, err := r.pool.Exec(ctx, query, recordID, newRequestHash)
	return err
}
