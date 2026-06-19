package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"go-gateway/internal/repository"
)

var (
	ErrInvalidCode         = errors.New("invalid_code")
	ErrCodeDisabled        = errors.New("code_disabled")
	ErrCodeExpired         = errors.New("code_expired")
	ErrCodeAlreadyRedeemed = errors.New("code_already_redeemed")
	ErrCodeExhausted       = errors.New("code_exhausted")
)

// RedeemService consumes credit codes through the same Supabase RPC used by Node.
type RedeemService struct {
	repo *repository.RedeemRepository
}

func NewRedeemService(repo *repository.RedeemRepository) *RedeemService {
	return &RedeemService{repo: repo}
}

type RedeemResult struct {
	Balance         float64 `json:"balance"`
	RedeemedCredits int     `json:"redeemedCredits"`
}

func (s *RedeemService) Redeem(ctx context.Context, userID, code string) (*RedeemResult, error) {
	result, err := s.repo.Redeem(ctx, userID, code)
	if err != nil {
		return nil, redeemError(err)
	}
	return &RedeemResult{
		Balance:         result.Balance,
		RedeemedCredits: result.Credits,
	}, nil
}

func redeemError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidCode
	}
	message := err.Error()
	switch {
	case strings.Contains(message, "invalid_code"):
		return ErrInvalidCode
	case strings.Contains(message, "code_disabled"):
		return ErrCodeDisabled
	case strings.Contains(message, "code_expired"):
		return ErrCodeExpired
	case strings.Contains(message, "code_already_redeemed"):
		return ErrCodeAlreadyRedeemed
	case strings.Contains(message, "code_exhausted"):
		return ErrCodeExhausted
	default:
		return fmt.Errorf("failed to redeem credit code: %w", err)
	}
}
