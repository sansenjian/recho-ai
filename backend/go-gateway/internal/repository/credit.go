package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CreditRepository handles credit-related database operations
type CreditRepository struct {
	pool *pgxpool.Pool
}

// NewCreditRepository creates a new credit repository
func NewCreditRepository(pool *pgxpool.Pool) *CreditRepository {
	return &CreditRepository{pool: pool}
}

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

// marshalMetadata serializes metadata map to JSON bytes, returning nil for nil input
func marshalMetadata(metadata map[string]any) ([]byte, error) {
	if metadata == nil {
		return nil, nil
	}
	data, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal metadata: %w", err)
	}
	return data, nil
}

// ReserveCredits reserves credits for image generation
// Returns the transaction ID and new balance
func (r *CreditRepository) ReserveCredits(
	ctx context.Context,
	userID string,
	amount float64,
	metadata map[string]any,
) (transactionID string, newBalance float64, err error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Atomic update: deduct only when balance is sufficient
	query := `
		UPDATE user_credit_balances
		SET balance = balance - $1,
		    total_spent = total_spent + $1,
		    updated_at = NOW()
		WHERE user_id = $2
		AND balance >= $1
		RETURNING balance
	`

	err = tx.QueryRow(ctx, query, amount, userID).Scan(&newBalance)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", 0, fmt.Errorf("insufficient credits")
		}
		return "", 0, fmt.Errorf("failed to reserve credits: %w", err)
	}

	// Serialize metadata properly
	metaJSON, err := marshalMetadata(metadata)
	if err != nil {
		return "", 0, err
	}

	// Create transaction record
	txQuery := `
		INSERT INTO credit_transactions (user_id, amount, balance_after, reason, metadata)
		VALUES ($1, -$2, $3, 'image_generation', $4)
		RETURNING id
	`

	err = tx.QueryRow(ctx, txQuery, userID, amount, newBalance, metaJSON).Scan(&transactionID)
	if err != nil {
		return "", 0, fmt.Errorf("failed to create transaction: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", 0, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return transactionID, newBalance, nil
}

// RefundCredits refunds reserved credits with double-refund protection
func (r *CreditRepository) RefundCredits(
	ctx context.Context,
	userID string,
	amount float64,
	relatedTransactionID string,
	metadata map[string]any,
) (newBalance float64, err error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Double-refund protection: check if this transaction was already refunded
	if relatedTransactionID != "" {
		var existingRefund int
		checkQuery := `
			SELECT COUNT(*) FROM credit_transactions
			WHERE related_transaction_id = $1
			AND reason = 'refund'
		`
		err = tx.QueryRow(ctx, checkQuery, relatedTransactionID).Scan(&existingRefund)
		if err != nil {
			return 0, fmt.Errorf("failed to check existing refund: %w", err)
		}
		if existingRefund > 0 {
			return 0, fmt.Errorf("double_refund: transaction %s was already refunded", relatedTransactionID)
		}
	}

	// Update balance
	query := `
		UPDATE user_credit_balances
		SET balance = balance + $1,
		    total_spent = GREATEST(total_spent - $1, 0),
		    updated_at = NOW()
		WHERE user_id = $2
		RETURNING balance
	`

	err = tx.QueryRow(ctx, query, amount, userID).Scan(&newBalance)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Create balance record if it doesn't exist
			insertQuery := `
				INSERT INTO user_credit_balances (user_id, balance, total_redeemed, total_spent)
				VALUES ($1, $2, 0, 0)
				ON CONFLICT (user_id) DO NOTHING
				RETURNING balance
			`
			err = tx.QueryRow(ctx, insertQuery, userID, amount).Scan(&newBalance)
			if err != nil {
				return 0, fmt.Errorf("failed to create balance record: %w", err)
			}
		} else {
			return 0, fmt.Errorf("failed to refund credits: %w", err)
		}
	}

	// Serialize metadata properly
	metaJSON, err := marshalMetadata(metadata)
	if err != nil {
		return 0, err
	}

	// Create refund transaction record
	txQuery := `
		INSERT INTO credit_transactions (user_id, amount, balance_after, reason, related_transaction_id, metadata)
		VALUES ($1, $2, $3, 'refund', $4, $5)
	`

	_, err = tx.Exec(ctx, txQuery, userID, amount, newBalance, relatedTransactionID, metaJSON)
	if err != nil {
		return 0, fmt.Errorf("failed to create refund transaction: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("failed to commit transaction: %w", err)
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
		VALUES ($1, $2, $3, 'redemption', $4)
		RETURNING id
	`

	_, err = tx.Exec(ctx, txQuery, userID, amount, newBalance, metaJSON)
	if err != nil {
		return 0, fmt.Errorf("failed to create transaction: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return newBalance, nil
}
