package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/unicode/norm"
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
	if len(normalized) > 120 {
		return normalized[:120]
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
		return nil, err
	}
	return &result, nil
}
