package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"

	"go-gateway/internal/repository"
)

// IdempotencyOutcome describes what the handler should do after calling Acquire
type IdempotencyOutcome struct {
	// Proceed is true when the handler should execute the normal operation
	Proceed bool
	// ReplayBody is the cached JSON response to return when Proceed is false and status is "replay"
	ReplayBody json.RawMessage
	// ReplayCode is the cached HTTP status code for replay
	ReplayCode int16
	// Conflict is true when the same key is used for a different request (return 409)
	Conflict bool
	// Processing is true when the same key is still being processed by another request (return 409)
	Processing bool
}

// IdempotencyService provides idempotency for credit-consuming operations
type IdempotencyService struct {
	repo *repository.IdempotencyRepository
}

// NewIdempotencyService creates a new idempotency service
func NewIdempotencyService(repo *repository.IdempotencyRepository) *IdempotencyService {
	return &IdempotencyService{repo: repo}
}

// HashBody computes a SHA-256 hex fingerprint of the raw request body
func HashBody(body []byte) string {
	h := sha256.Sum256(body)
	return hex.EncodeToString(h[:])
}

// Acquire checks or claims the idempotency key for a given request.
//
// Parameters:
//   - userID: the authenticated user's ID
//   - idemKey: client-supplied idempotency key (from Idempotency-Key header)
//   - scope: endpoint scope ("image_generate" or "credit_redeem")
//   - body: raw request body bytes (used for fingerprint)
//
// Returns an outcome telling the handler whether to proceed or replay.
func (s *IdempotencyService) Acquire(
	ctx context.Context,
	userID, idemKey, scope string,
	body []byte,
) (*IdempotencyOutcome, error) {
	hash := HashBody(body)

	result, err := s.repo.Acquire(ctx, userID, idemKey, scope, hash)
	if err != nil {
		return nil, err
	}

	switch result.Status {
	case "new":
		return &IdempotencyOutcome{Proceed: true}, nil

	case "replay":
		rec := result.Record
		code := int16(200)
		if rec.ResponseCode != nil {
			code = *rec.ResponseCode
		}
		return &IdempotencyOutcome{
			Proceed:    false,
			ReplayBody: rec.ResponseBody,
			ReplayCode: code,
		}, nil

	case "conflict":
		return &IdempotencyOutcome{
			Proceed:    false,
			Conflict:   true,
			Processing: true,
		}, nil

	default:
		return &IdempotencyOutcome{Proceed: true}, nil
	}
}

// Complete stores the successful response for future replays.
// Called after the handler finishes processing (including any refund adjustments).
func (s *IdempotencyService) Complete(
	ctx context.Context,
	userID, idemKey, scope string,
	responseCode int16,
	responseBody any,
	transactionID string,
) {
	if err := s.repo.Complete(ctx, userID, idemKey, scope, responseCode, responseBody, transactionID); err != nil {
		log.Printf("[idempotency] failed to store response for key=%s scope=%s: %v", idemKey, scope, err)
	}
}

// Fail marks the idempotency record as failed, allowing future retries with the same key.
// Called when the handler encounters an error.
func (s *IdempotencyService) Fail(
	ctx context.Context,
	userID, idemKey, scope string,
) {
	if err := s.repo.Fail(ctx, userID, idemKey, scope); err != nil {
		log.Printf("[idempotency] failed to mark failure for key=%s scope=%s: %v", idemKey, scope, err)
	}
}
