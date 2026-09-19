package service

import (
	"context"
	"fmt"
	"math"
	"strings"

	"go-gateway/internal/config"
	"go-gateway/internal/repository"
)

type ImageCreditCostProvider interface {
	ImageCreditCostPerImage(ctx context.Context) (float64, error)
	// ImageCreditCostPerModel 返回按模型定价后的每张单价；
	// 该模型未配置覆盖价时返回兜底价（与 ImageCreditCostPerImage 一致）。
	ImageCreditCostPerModel(ctx context.Context, model string) (float64, error)
}

// CreditService handles credit business logic
type CreditService struct {
	repo         *repository.CreditRepository
	costProvider ImageCreditCostProvider
}

// CreditReservation holds credit reservation info for a generation request.
type CreditReservation struct {
	TransactionID string
	Amount        float64
	Balance       float64
}

// NewCreditService creates a new credit service
func NewCreditService(repo *repository.CreditRepository, providers ...ImageCreditCostProvider) *CreditService {
	var provider ImageCreditCostProvider
	if len(providers) > 0 {
		provider = providers[0]
	}
	return &CreditService{repo: repo, costProvider: provider}
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
	model string,
	imageCount int,
) (transactionID string, newBalance float64, creditCostPerImage float64, totalCost float64, err error) {
	creditCostPerImage, err = s.reserveImageCreditCostPerModel(ctx, model)
	if err != nil {
		return "", 0, 0, 0, err
	}
	totalCost = roundToTwoDecimals(float64(imageCount) * creditCostPerImage)

	if totalCost <= 0 {
		return "", 0, creditCostPerImage, 0, nil // No cost, no reservation needed
	}

	metadata := map[string]any{
		"count":              imageCount,
		"creditCostPerImage": creditCostPerImage,
		"totalCost":          totalCost,
	}
	// 记录计费所用模型，便于对账时解释单价来源（覆盖价 vs 兜底价）。
	if normalized := strings.TrimSpace(model); normalized != "" {
		metadata["model"] = normalized
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

// GetCreditCost calculates the credit cost for image generation.
// model 必须是本次生成实际会使用的模型，用于命中「按模型定价」的覆盖价。
func (s *CreditService) GetCreditCost(ctx context.Context, model string, imageCount int) (costPerImage, totalCost float64) {
	costPerImage = s.imageCreditCostPerModel(ctx, model)
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

// imageCreditCostPerModel 用于「展示/预估」：取价失败时回退兜底价，不阻断生成。
func (s *CreditService) imageCreditCostPerModel(ctx context.Context, model string) float64 {
	fallback := normalizeImageCreditCostPerImage(config.ImageCreditCostPerImage)
	cost, err := s.normalizedImageCreditCostPerModel(ctx, model)
	if err != nil {
		return fallback
	}
	return cost
}

// reserveImageCreditCostPerModel 用于「扣费」：取价失败必须 fail closed，
// 否则会按未知单价扣款（宁可拒绝也不能按错的价扣）。
func (s *CreditService) reserveImageCreditCostPerModel(ctx context.Context, model string) (float64, error) {
	return s.normalizedImageCreditCostPerModel(ctx, model)
}

func (s *CreditService) normalizedImageCreditCostPerModel(ctx context.Context, model string) (float64, error) {
	fallback := normalizeImageCreditCostPerImage(config.ImageCreditCostPerImage)
	if s == nil || s.costProvider == nil {
		return fallback, nil
	}
	cost, err := s.costProvider.ImageCreditCostPerModel(ctx, model)
	if err != nil {
		return 0, fmt.Errorf("image credit cost unavailable: %w", err)
	}
	if math.IsNaN(cost) || math.IsInf(cost, 0) || cost <= 0 {
		return 0, fmt.Errorf("image credit cost invalid: %v", cost)
	}
	return normalizeImageCreditCostPerImageWithFallback(cost, fallback), nil
}

// roundToTwoDecimals rounds a float to two decimal places
func roundToTwoDecimals(val float64) float64 {
	return math.Round(val*100) / 100
}
