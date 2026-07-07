package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"

	"go-gateway/internal/config"
	"go-gateway/internal/repository"
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

func TestCreditServiceReserveCreditsFailsWhenAppSettingsUnavailable(t *testing.T) {
	creditSvc := NewCreditService(
		repository.NewCreditRepository(nil),
		stubImageCreditCostProvider{cost: 0.75, err: errors.New("db unavailable")},
	)

	_, _, _, _, err := creditSvc.ReserveCredits(context.Background(), "00000000-0000-0000-0000-000000000001", 1)

	if err == nil {
		t.Fatal("expected reserve to fail when app settings are unavailable")
	}
	if !strings.Contains(err.Error(), "image credit cost") {
		t.Fatalf("expected image credit cost error, got %v", err)
	}
}

func TestCreditServiceReserveCreditsFailsForInvalidAppSettingsPrice(t *testing.T) {
	creditSvc := NewCreditService(
		repository.NewCreditRepository(nil),
		stubImageCreditCostProvider{cost: math.NaN()},
	)

	_, _, _, _, err := creditSvc.ReserveCredits(context.Background(), "00000000-0000-0000-0000-000000000001", 1)

	if err == nil {
		t.Fatal("expected reserve to fail when app settings price is invalid")
	}
	if !strings.Contains(err.Error(), "image credit cost") || !strings.Contains(err.Error(), "NaN") {
		t.Fatalf("expected image credit cost error with rejected value, got %v", err)
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
