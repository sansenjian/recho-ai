package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/unicode/norm"
)

const (
	maxCreditCodeLength = 120
)

var (
	ErrInvalidCode         = errors.New("invalid_code")
	ErrCodeDisabled        = errors.New("code_disabled")
	ErrCodeExpired         = errors.New("code_expired")
	ErrCodeAlreadyRedeemed = errors.New("code_already_redeemed")
	ErrCodeExhausted       = errors.New("code_exhausted")
)

type RedeemRepository struct {
	pool *pgxpool.Pool
}

func NewRedeemRepository(pool *pgxpool.Pool) *RedeemRepository {
	return &RedeemRepository{pool: pool}
}

type RedeemResult struct {
	Balance float64
	Credits int
}

func NormalizeCreditCode(value string) string {
	replacer := strings.NewReplacer(" ", "", "\t", "", "\n", "", "\r", "", "-", "")
	normalized := norm.NFKC.String(value)
	normalized = strings.ToUpper(strings.TrimSpace(normalized))
	normalized = replacer.Replace(normalized)
	if len(normalized) > maxCreditCodeLength {
		return normalized[:maxCreditCodeLength]
	}
	return normalized
}

func CreditCodeHash(value string) string {
	normalized := NormalizeCreditCode(value)
	if normalized == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func (r *RedeemRepository) Redeem(ctx context.Context, userID, rawCode string) (*RedeemResult, error) {
	codeHash := CreditCodeHash(rawCode)
	if codeHash == "" {
		return nil, pgx.ErrNoRows
	}

	query := `
		SELECT balance, credits
		FROM public.redeem_credit_code($1::uuid, $2::text)
	`

	var result RedeemResult
	if err := r.pool.QueryRow(ctx, query, userID, codeHash).Scan(&result.Balance, &result.Credits); err != nil {
		return nil, redeemRepositoryError(err)
	}
	return &result, nil
}

func redeemRepositoryError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidCode
	}

	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != plpgsqlRaiseExceptionSQLState {
		return err
	}

	switch pgErr.Message {
	case "invalid_code":
		return ErrInvalidCode
	case "code_disabled":
		return ErrCodeDisabled
	case "code_expired":
		return ErrCodeExpired
	case "code_already_redeemed":
		return ErrCodeAlreadyRedeemed
	case "code_exhausted":
		return ErrCodeExhausted
	default:
		return err
	}
}
