package repository

import (
	"context"
	"fmt"
	"time"

	"go-gateway/internal/pkg/supabase"

	"github.com/jackc/pgx/v5"
)

type RedeemRepository struct {
	db *supabase.Client
}

func NewRedeemRepository(db *supabase.Client) *RedeemRepository {
	return &RedeemRepository{db: db}
}

// RedeemCode represents a redemption code in the database
type RedeemCode struct {
	ID        string     `json:"id"`
	Code      string     `json:"code"`
	Credits   int        `json:"credits"`
	UsedBy    *string    `json:"used_by"`
	UsedAt    *time.Time `json:"used_at"`
	ExpiresAt time.Time  `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
}

const redeemTable = "redeem_codes"

// Create inserts a new redemption code
func (r *RedeemRepository) Create(ctx context.Context, code *RedeemCode) error {
	query := `
		INSERT INTO %s (code, credits, expires_at, created_at)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`
	query = fmt.Sprintf(query, redeemTable)

	err := r.db.Pool().QueryRow(ctx, query,
		code.Code,
		code.Credits,
		code.ExpiresAt,
		code.CreatedAt,
	).Scan(&code.ID)

	return err
}

// FindByCode finds a redemption code by its code string
func (r *RedeemRepository) FindByCode(ctx context.Context, code string) (*RedeemCode, error) {
	query := `
		SELECT id, code, credits, used_by, used_at, expires_at, created_at
		FROM %s
		WHERE code = $1
	`
	query = fmt.Sprintf(query, redeemTable)

	var rc RedeemCode
	err := r.db.Pool().QueryRow(ctx, query, code).Scan(
		&rc.ID,
		&rc.Code,
		&rc.Credits,
		&rc.UsedBy,
		&rc.UsedAt,
		&rc.ExpiresAt,
		&rc.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	return &rc, nil
}

// MarkAsUsed marks a code as used by a user.
// Returns the number of rows affected — 0 means the code was already consumed
// by a concurrent request (WHERE includes AND used_by IS NULL as a race guard).
func (r *RedeemRepository) MarkAsUsed(ctx context.Context, id, userID string) (rowsAffected int64, err error) {
	query := `
		UPDATE %s
		SET used_by = $1, used_at = $2
		WHERE id = $3 AND used_by IS NULL
	`
	query = fmt.Sprintf(query, redeemTable)

	result, err := r.db.Pool().Exec(ctx, query, userID, time.Now(), id)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}

// MarkAsUnused marks a code as unused (for rollback)
func (r *RedeemRepository) MarkAsUnused(ctx context.Context, id string) error {
	query := `
		UPDATE %s
		SET used_by = NULL, used_at = NULL
		WHERE id = $1
	`
	query = fmt.Sprintf(query, redeemTable)

	_, err := r.db.Pool().Exec(ctx, query, id)
	return err
}
