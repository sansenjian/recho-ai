package service

import (
	"context"
	"math"

	"go-gateway/internal/config"
	"go-gateway/internal/repository"
)

// CreditService handles credit business logic
type CreditService struct {
	repo *repository.CreditRepository
}

// CreditReservation holds credit reservation info for a generation request.
type CreditReservation struct {
	TransactionID string
	Amount        float64
	Balance       float64
}

// NewCreditService creates a new credit service
func NewCreditService(repo *repository.CreditRepository) *CreditService {
	return &CreditService{repo: repo}
}

// GetBalance retrieves a user's credit balance
func (s *CreditService) GetBalance(ctx context.Context, userID string) (float64, error) {
	balance, err := s.repo.GetBalance(ctx, userID)
	if err != nil {
		return 0, err
	}
	if balance == nil {
		return 0, nil // No balance record
	}
	return balance.Balance, nil
}

// ReserveCredits reserves credits for image generation
func (s *CreditService) ReserveCredits(
	ctx context.Context,
	userID string,
	imageCount int,
) (transactionID string, newBalance float64, creditCostPerImage float64, totalCost float64, err error) {
	creditCostPerImage = config.ImageCreditCostPerImage
	totalCost = roundToTwoDecimals(float64(imageCount) * creditCostPerImage)

	if totalCost <= 0 {
		return "", 0, creditCostPerImage, 0, nil // No cost, no reservation needed
	}

	metadata := map[string]any{
		"count":              imageCount,
		"creditCostPerImage": creditCostPerImage,
		"totalCost":          totalCost,
	}

	txID, balance, err := s.repo.ReserveCredits(ctx, userID, totalCost, metadata)
	if err != nil {
		return "", 0, creditCostPerImage, 0, err
	}

	return txID, balance, creditCostPerImage, totalCost, nil
}

// RefundCredits refunds credits for failed or partial image generation
func (s *CreditService) RefundCredits(
	ctx context.Context,
	userID string,
	transactionID string,
	refundAmount float64,
	reason string,
) (float64, error) {
	if refundAmount <= 0 {
		return 0, nil
	}

	metadata := map[string]any{
		"reason": reason,
	}

	return s.repo.RefundCredits(ctx, userID, refundAmount, transactionID, metadata)
}

// AddCredits adds credits to a user's account (for redemptions, admin bonuses, etc.)
func (s *CreditService) AddCredits(
	ctx context.Context,
	userID string,
	credits int,
	source string,
	referenceID string,
) error {
	metadata := map[string]any{
		"source":       source,
		"reference_id": referenceID,
	}

	_, err := s.repo.AddCredits(ctx, userID, float64(credits), metadata)
	return err
}

// GetCreditCost calculates the credit cost for image generation
func (s *CreditService) GetCreditCost(imageCount int) (costPerImage, totalCost float64) {
	costPerImage = config.ImageCreditCostPerImage
	totalCost = roundToTwoDecimals(float64(imageCount) * costPerImage)
	return costPerImage, totalCost
}

// ReserveAmount reserves a specific credit amount (e.g. for chat model costs).
// Returns the transaction ID and new balance.
func (s *CreditService) ReserveAmount(
	ctx context.Context,
	userID string,
	amount float64,
	metadata map[string]any,
) (transactionID string, newBalance float64, err error) {
	if amount <= 0 {
		return "", 0, nil
	}
	return s.repo.ReserveCredits(ctx, userID, amount, metadata)
}

// roundToTwoDecimals rounds a float to two decimal places
func roundToTwoDecimals(val float64) float64 {
	return math.Round(val*100) / 100
}
