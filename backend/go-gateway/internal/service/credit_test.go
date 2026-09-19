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
	cost       float64
	err        error
	modelCosts map[string]float64
}

func (s stubImageCreditCostProvider) ImageCreditCostPerImage(ctx context.Context) (float64, error) {
	return s.cost, s.err
}

func (s stubImageCreditCostProvider) ImageCreditCostPerModel(ctx context.Context, model string) (float64, error) {
	if s.err != nil {
		return 0, s.err
	}
	if cost, ok := s.modelCosts[model]; ok {
		return cost, nil
	}
	return s.cost, nil
}

func TestCreditServiceUsesAppSettingsPrice(t *testing.T) {
	creditSvc := NewCreditService(nil, stubImageCreditCostProvider{cost: 0.75})

	costPerImage, totalCost := creditSvc.GetCreditCost(context.Background(), "gpt-image-2", 2)

	if costPerImage != 0.75 {
		t.Fatalf("expected cost per image 0.75, got %v", costPerImage)
	}
	if totalCost != 1.5 {
		t.Fatalf("expected total cost 1.5, got %v", totalCost)
	}
}

func TestCreditServiceUsesPerModelPrice(t *testing.T) {
	creditSvc := NewCreditService(nil, stubImageCreditCostProvider{
		cost:       0.75,
		modelCosts: map[string]float64{"gpt-image-2": 3},
	})

	costPerImage, totalCost := creditSvc.GetCreditCost(context.Background(), "gpt-image-2", 2)
	if costPerImage != 3 {
		t.Fatalf("expected per-model cost 3, got %v", costPerImage)
	}
	if totalCost != 6 {
		t.Fatalf("expected per-model total 6, got %v", totalCost)
	}

	// 未配置覆盖价的模型仍回落兜底价，不能变成 0 或沿用别的模型的价格。
	fallbackPerImage, fallbackTotal := creditSvc.GetCreditCost(context.Background(), "unlisted-model", 2)
	if fallbackPerImage != 0.75 {
		t.Fatalf("expected fallback cost 0.75 for unlisted model, got %v", fallbackPerImage)
	}
	if fallbackTotal != 1.5 {
		t.Fatalf("expected fallback total 1.5 for unlisted model, got %v", fallbackTotal)
	}
}

func TestCreditServiceFallsBackWhenAppSettingsUnavailable(t *testing.T) {
	creditSvc := NewCreditService(nil, stubImageCreditCostProvider{cost: 0.75, err: errors.New("db unavailable")})

	costPerImage, totalCost := creditSvc.GetCreditCost(context.Background(), "", 2)

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

	_, _, _, _, err := creditSvc.ReserveCredits(context.Background(), "00000000-0000-0000-0000-000000000001", "", 1)

	if err == nil {
		t.Fatal("expected reserve to fail when app settings are unavailable")
	}
	if !strings.Contains(err.Error(), "image credit cost") {
		t.Fatalf("expected image credit cost error, got %v", err)
	}
}

func TestCreditServiceReserveCreditsFailsForInvalidPerModelPrice(t *testing.T) {
	creditSvc := NewCreditService(
		repository.NewCreditRepository(nil),
		stubImageCreditCostProvider{
			cost:       0.75,
			modelCosts: map[string]float64{"gpt-image-2": math.NaN()},
		},
	)

	_, _, _, _, err := creditSvc.ReserveCredits(context.Background(), "00000000-0000-0000-0000-000000000001", "gpt-image-2", 1)

	// 关键：覆盖价非法时必须走「取价失败」分支，而不是静默回落到 0.75 的兜底价。
	// 若实现忽略了 model 参数，这里会按 0.75 计价并继续走到 nil 仓库，错误信息将不含 "image credit cost"。
	if err == nil {
		t.Fatal("expected reserve to fail when per-model price is invalid")
	}
	if !strings.Contains(err.Error(), "image credit cost") || !strings.Contains(err.Error(), "NaN") {
		t.Fatalf("expected image credit cost error with rejected value, got %v", err)
	}
}

func TestCreditServiceReserveCreditsFailsForInvalidAppSettingsPrice(t *testing.T) {
	creditSvc := NewCreditService(
		repository.NewCreditRepository(nil),
		stubImageCreditCostProvider{cost: math.NaN()},
	)

	_, _, _, _, err := creditSvc.ReserveCredits(context.Background(), "00000000-0000-0000-0000-000000000001", "", 1)

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

			costPerImage, totalCost := creditSvc.GetCreditCost(context.Background(), "", 2)

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
