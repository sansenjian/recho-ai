package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"testing"

	"go-gateway/internal/config"
)

type stubImageCreditCostProvider struct {
	cost float64
	err  error
}

func (s stubImageCreditCostProvider) ImageCreditCostPerImage(ctx context.Context) (float64, error) {
	return s.cost, s.err
}

func TestCreditServiceUsesAppSettingsPrice(t *testing.T) {
	creditSvc := NewCreditService(nil, stubImageCreditCostProvider{cost: 0.75})

	costPerImage, totalCost := creditSvc.GetCreditCost(context.Background(), 2)

	if costPerImage != 0.75 {
		t.Fatalf("expected cost per image 0.75, got %v", costPerImage)
	}
	if totalCost != 1.5 {
		t.Fatalf("expected total cost 1.5, got %v", totalCost)
	}
}

func TestCreditServiceFallsBackWhenAppSettingsUnavailable(t *testing.T) {
	creditSvc := NewCreditService(nil, stubImageCreditCostProvider{cost: 0.75, err: errors.New("db unavailable")})

	costPerImage, totalCost := creditSvc.GetCreditCost(context.Background(), 2)

	if costPerImage <= 0 {
		t.Fatalf("expected positive fallback cost, got %v", costPerImage)
	}
	if totalCost <= 0 {
		t.Fatalf("expected positive fallback total, got %v", totalCost)
	}
}

func TestCreditServiceFallsBackForInvalidAppSettingsPrices(t *testing.T) {
	original := config.ImageCreditCostPerImage
	config.ImageCreditCostPerImage = 0.75
	t.Cleanup(func() {
		config.ImageCreditCostPerImage = original
	})

	tests := []float64{0, -1, math.NaN(), math.Inf(1)}
	for _, dynamicCost := range tests {
		t.Run(formatFloatForTestName(dynamicCost), func(t *testing.T) {
			creditSvc := NewCreditService(nil, stubImageCreditCostProvider{cost: dynamicCost})

			costPerImage, totalCost := creditSvc.GetCreditCost(context.Background(), 2)

			if costPerImage != 0.75 {
				t.Fatalf("expected fallback cost 0.75 for %v, got %v", dynamicCost, costPerImage)
			}
			if totalCost != 1.5 {
				t.Fatalf("expected fallback total 1.5 for %v, got %v", dynamicCost, totalCost)
			}
		})
	}
}

func formatFloatForTestName(value float64) string {
	switch {
	case math.IsNaN(value):
		return "NaN"
	case math.IsInf(value, 1):
		return "Inf"
	case math.IsInf(value, -1):
		return "-Inf"
	default:
		return fmt.Sprintf("%g", value)
	}
}
