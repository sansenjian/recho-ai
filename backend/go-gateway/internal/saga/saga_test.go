package saga

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestRunnerRunsAllStepsInOrder(t *testing.T) {
	var order []string
	r := NewRunner(nil)
	r.Add(Step{Name: "a", Do: func(ctx context.Context) error { order = append(order, "a"); return nil }})
	r.Add(Step{Name: "b", Do: func(ctx context.Context) error { order = append(order, "b"); return nil }})
	r.Add(Step{Name: "c", Do: func(ctx context.Context) error { order = append(order, "c"); return nil }})

	if err := r.Run(context.Background()); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if got, want := strings.Join(order, ""), "abc"; got != want {
		t.Fatalf("order = %q, want %q", got, want)
	}
}

func TestRunnerCompensatesInReverseOrderOnFailure(t *testing.T) {
	var order []string
	boom := errors.New("boom")
	r := NewRunner(nil)
	r.Add(Step{
		Name: "a",
		Do:   func(ctx context.Context) error { order = append(order, "do-a"); return nil },
		Compensate: func(ctx context.Context) error { order = append(order, "undo-a"); return nil },
	})
	r.Add(Step{
		Name: "b",
		Do:   func(ctx context.Context) error { order = append(order, "do-b"); return nil },
		Compensate: func(ctx context.Context) error { order = append(order, "undo-b"); return nil },
	})
	r.Add(Step{
		Name: "c",
		Do:   func(ctx context.Context) error { order = append(order, "do-c"); return boom },
		Compensate: func(ctx context.Context) error { order = append(order, "undo-c"); return nil },
	})

	err := r.Run(context.Background())
	if !errors.Is(err, ErrStepFailed) {
		t.Fatalf("expected ErrStepFailed, got %v", err)
	}
	// c 失败时未完成，不应触发 undo-c；只反向补偿 a、b
	got := strings.Join(order, ",")
	want := "do-a,do-b,do-c,undo-b,undo-a"
	if got != want {
		t.Fatalf("order = %q, want %q", got, want)
	}
}

func TestRunnerSkipsNilCompensate(t *testing.T) {
	var order []string
	r := NewRunner(nil)
	r.Add(Step{
		Name:       "irreversible",
		Do:         func(ctx context.Context) error { order = append(order, "do-irr"); return nil },
		Compensate: nil, // 不可逆步骤
	})
	r.Add(Step{
		Name: "b",
		Do:   func(ctx context.Context) error { order = append(order, "do-b"); return nil },
		Compensate: func(ctx context.Context) error { order = append(order, "undo-b"); return nil },
	})
	r.Add(Step{
		Name: "fail",
		Do:   func(ctx context.Context) error { order = append(order, "do-fail"); return errors.New("nope") },
	})

	_ = r.Run(context.Background())
	got := strings.Join(order, ",")
	want := "do-irr,do-b,do-fail,undo-b"
	if got != want {
		t.Fatalf("order = %q, want %q", got, want)
	}
}

func TestRunnerContinuesCompensationAfterCompensateError(t *testing.T) {
	var order []string
	r := NewRunner(nil)
	r.Add(Step{
		Name: "a",
		Do:   func(ctx context.Context) error { order = append(order, "do-a"); return nil },
		Compensate: func(ctx context.Context) error {
			order = append(order, "undo-a-fail")
			return errors.New("compensate a failed")
		},
	})
	r.Add(Step{
		Name: "b",
		Do:   func(ctx context.Context) error { order = append(order, "do-b"); return nil },
		Compensate: func(ctx context.Context) error { order = append(order, "undo-b"); return nil },
	})
	r.Add(Step{
		Name: "c",
		Do:   func(ctx context.Context) error { order = append(order, "do-c"); return errors.New("c failed") },
	})

	err := r.Run(context.Background())
	if !errors.Is(err, ErrStepFailed) {
		t.Fatalf("expected ErrStepFailed, got %v", err)
	}
	if !errors.Is(err, ErrCompensationFailed) {
		t.Fatalf("expected wrapped ErrCompensationFailed, got %v", err)
	}
	got := strings.Join(order, ",")
	// 即便 undo-a 失败，undo-b 仍应执行
	want := "do-a,do-b,do-c,undo-b,undo-a-fail"
	if got != want {
		t.Fatalf("order = %q, want %q", got, want)
	}
}

func TestRunnerRespectsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 提前取消

	r := NewRunner(nil)
	r.Add(Step{
		Name: "a",
		Do: func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		},
	})

	err := r.Run(ctx)
	if !errors.Is(err, ErrStepFailed) {
		t.Fatalf("expected ErrStepFailed wrapping ctx err, got %v", err)
	}
}

func TestRunnerEmptySucceeds(t *testing.T) {
	r := NewRunner(nil)
	if err := r.Run(context.Background()); err != nil {
		t.Fatalf("expected nil for empty saga, got %v", err)
	}
}
