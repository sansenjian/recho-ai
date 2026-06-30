package service

import (
	"context"
	"errors"
	"testing"
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
