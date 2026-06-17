package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"go-gateway/internal/repository"
)

type RedeemService struct {
	repo     *repository.RedeemRepository
	creditSvc *CreditService
}

func NewRedeemService(repo *repository.RedeemRepository, creditSvc *CreditService) *RedeemService {
	return &RedeemService{
		repo:     repo,
		creditSvc: creditSvc,
	}
}

// RedeemCode represents a redemption code
type RedeemCode = repository.RedeemCode

// RedeemResult represents the result of a redemption
type RedeemResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Credits int    `json:"credits,omitempty"`
}

// GenerateCode generates a new redemption code
func (s *RedeemService) GenerateCode(ctx context.Context, credits int, expiresAt time.Time) (*RedeemCode, error) {
	code, err := generateSecureCode(16)
	if err != nil {
		return nil, fmt.Errorf("failed to generate code: %w", err)
	}

	redeemCode := &RedeemCode{
		Code:      code,
		Credits:   credits,
		ExpiresAt: expiresAt,
		CreatedAt: time.Now(),
	}

	if err := s.repo.Create(ctx, redeemCode); err != nil {
		return nil, fmt.Errorf("failed to create code: %w", err)
	}

	return redeemCode, nil
}

// Redeem consumes a redemption code and credits the user's account
func (s *RedeemService) Redeem(ctx context.Context, userID, code string) (*RedeemResult, error) {
	// Find the code
	redeemCode, err := s.repo.FindByCode(ctx, code)
	if err != nil {
		return &RedeemResult{
			Success: false,
			Message: "Invalid redemption code",
		}, nil
	}

	// Check if expired
	if time.Now().After(redeemCode.ExpiresAt) {
		return &RedeemResult{
			Success: false,
			Message: "This code has expired",
		}, nil
	}

	// Check if already used
	if redeemCode.UsedBy != nil {
		return &RedeemResult{
			Success: false,
			Message: "This code has already been used",
		}, nil
	}

	// Mark as used (atomic: WHERE used_by IS NULL prevents double-spend)
	rowsAffected, err := s.repo.MarkAsUsed(ctx, redeemCode.ID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to mark code as used: %w", err)
	}
	if rowsAffected == 0 {
		// Another concurrent request already consumed this code
		return &RedeemResult{
			Success: false,
			Message: "This code has already been used",
		}, nil
	}

	// Credit the user's account
	if err := s.creditSvc.AddCredits(ctx, userID, redeemCode.Credits, "redeem", redeemCode.ID); err != nil {
		// Rollback the mark as used
		s.repo.MarkAsUnused(ctx, redeemCode.ID)
		return nil, fmt.Errorf("failed to credit user: %w", err)
	}

	return &RedeemResult{
		Success: true,
		Message: fmt.Sprintf("Successfully redeemed %d credits", redeemCode.Credits),
		Credits: redeemCode.Credits,
	}, nil
}

// generateSecureCode generates a cryptographically secure random code
func generateSecureCode(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes)[:length], nil
}
