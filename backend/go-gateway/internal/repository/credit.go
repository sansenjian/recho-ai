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

// CreditRepository handles credit-related database operations
type CreditRepository struct {
	pool *pgxpool.Pool
}

// ErrInsufficientCredits is returned when the user's balance is too low
var ErrInsufficientCredits = errors.New("insufficient credits")

// NewCreditRepository creates a new credit repository
func NewCreditRepository(pool *pgxpool.Pool) *CreditRepository {
	return &CreditRepository{pool: pool}
}

const plpgsqlRaiseExceptionSQLState = "P0001"

// UserBalance represents a user's credit balance record
type UserBalance struct {
	UserID        string    `json:"user_id"`
	Balance       float64   `json:"balance"`
	TotalRedeemed float64   `json:"total_redeemed"`
	TotalSpent    float64   `json:"total_spent"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// GetBalance retrieves a user's credit balance
func (r *CreditRepository) GetBalance(ctx context.Context, userID string) (*UserBalance, error) {
	query := `
		SELECT user_id, balance, total_redeemed, total_spent, created_at, updated_at
		FROM user_credit_balances
		WHERE user_id = $1
	`

	var balance UserBalance
	err := r.pool.QueryRow(ctx, query, userID).Scan(
		&balance.UserID,
		&balance.Balance,
		&balance.TotalRedeemed,
		&balance.TotalSpent,
		&balance.CreatedAt,
		&balance.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil // User has no balance record
		}
		return nil, fmt.Errorf("failed to get balance: %w", err)
	}
	return &balance, nil
}

// CreditTransaction represents a credit transaction record
type CreditTransaction struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Amount       float64   `json:"amount"`
	BalanceAfter float64   `json:"balance_after"`
	Reason       string    `json:"reason"`
	CreatedAt    time.Time `json:"created_at"`
}

// marshalMetadata serializes metadata for jsonb RPC parameters.
func marshalMetadata(metadata map[string]any) (string, error) {
	if metadata == nil {
		return "{}", nil
	}
	data, err := json.Marshal(metadata)
	if err != nil {
		return "", fmt.Errorf("failed to marshal metadata: %w", err)
	}
	return string(data), nil
}

func isCreditError(err error, message string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == plpgsqlRaiseExceptionSQLState && pgErr.Message == message
}

// ReserveCredits reserves credits for image generation
// Returns the transaction ID and new balance
func (r *CreditRepository) ReserveCredits(
	ctx context.Context,
	userID string,
	amount float64,
	metadata map[string]any,
) (transactionID string, newBalance float64, err error) {
	metaJSON, err := marshalMetadata(metadata)
	if err != nil {
		return "", 0, err
	}

	query := `
		SELECT balance, transaction_id
		FROM public.reserve_user_credits($1::uuid, $2::numeric, $3::jsonb)
	`
	err = r.pool.QueryRow(ctx, query, userID, amount, metaJSON).Scan(&newBalance, &transactionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isCreditError(err, "insufficient_credits") {
			return "", 0, ErrInsufficientCredits
		}
		return "", 0, fmt.Errorf("failed to reserve credits: %w", err)
	}

	return transactionID, newBalance, nil
}

// RefundCredits refunds reserved credits with cumulative double-refund protection.
//
// Instead of blocking after the first refund, this allows multiple partial refunds
// as long as the cumulative refunded amount does not exceed the original charge.
// A non-unique index on (related_transaction_id, reason) supports the SUM lookup.
func (r *CreditRepository) RefundCredits(
	ctx context.Context,
	userID string,
	amount float64,
	relatedTransactionID string,
	metadata map[string]any,
) (newBalance float64, err error) {
	metaJSON, err := marshalMetadata(metadata)
	if err != nil {
		return 0, err
	}

	query := `
		SELECT balance
		FROM public.refund_user_credits($1::uuid, $2::numeric, nullif($3, '')::uuid, $4::jsonb)
	`
	err = r.pool.QueryRow(ctx, query, userID, amount, relatedTransactionID, metaJSON).Scan(&newBalance)
	if err != nil {
		return 0, fmt.Errorf("failed to refund credits: %w", err)
	}

	return newBalance, nil
}

// AddCredits adds credits to a user's balance (for redemptions, admin bonuses, etc.)
func (r *CreditRepository) AddCredits(
	ctx context.Context,
	userID string,
	amount float64,
	metadata map[string]any,
) (newBalance float64, err error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Upsert balance - add credits to existing or create new
	query := `
		INSERT INTO user_credit_balances (user_id, balance, total_redeemed, total_spent)
		VALUES ($1, $2, $2, 0)
		ON CONFLICT (user_id)
		DO UPDATE SET 
			balance = user_credit_balances.balance + $2,
			total_redeemed = user_credit_balances.total_redeemed + $2,
			updated_at = NOW()
		RETURNING balance
	`

	err = tx.QueryRow(ctx, query, userID, amount).Scan(&newBalance)
	if err != nil {
		return 0, fmt.Errorf("failed to add credits: %w", err)
	}

	// Serialize metadata properly
	metaJSON, err := marshalMetadata(metadata)
	if err != nil {
		return 0, err
	}

	// Create transaction record — reason must be 'redemption' to match DB CHECK constraint
	txQuery := `
		INSERT INTO credit_transactions (user_id, amount, balance_after, reason, metadata)
		VALUES ($1, $2, $3, 'redemption', $4::jsonb)
		RETURNING id
	`

	var txID string
	err = tx.QueryRow(ctx, txQuery, userID, amount, newBalance, metaJSON).Scan(&txID)
	if err != nil {
		return 0, fmt.Errorf("failed to create transaction: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return newBalance, nil
}
