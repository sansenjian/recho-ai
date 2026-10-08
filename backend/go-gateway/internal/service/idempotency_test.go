package service

import (
	"context"
	"errors"
	"testing"

	"go-gateway/internal/repository"
)

type idempotencyRepositoryFake struct {
	completeErr error
	failErr     error
	record      *repository.IdempotencyRecord
}

func (f *idempotencyRepositoryFake) Acquire(context.Context, string, string, string, string) (*repository.AcquireResult, error) {
	return nil, nil
}

func (f *idempotencyRepositoryFake) Complete(context.Context, string, string, string, int16, any, string) error {
	return f.completeErr
}

// Lookup 只读探测：假实现按已保存的记录返回，供跨时间桶的用例使用。
func (f *idempotencyRepositoryFake) Lookup(_ context.Context, userID, idemKey, scope string) (*repository.IdempotencyRecord, error) {
	if f.record == nil || f.record.UserID != userID || f.record.Key != idemKey || f.record.Scope != scope {
		return nil, nil
	}
	return f.record, nil
}

func (f *idempotencyRepositoryFake) Fail(context.Context, string, string, string) error {
	return f.failErr
}

func TestIdempotencyServiceCompleteAndFailReturnRepositoryErrors(t *testing.T) {
	completeErr := errors.New("complete write failed")
	failErr := errors.New("fail write failed")
	svc := newIdempotencyService(&idempotencyRepositoryFake{
		completeErr: completeErr,
		failErr:     failErr,
	})

	if err := svc.Complete(context.Background(), "user-4", "key-4", "image_generate", 200, map[string]string{"ok": "true"}, ""); !errors.Is(err, completeErr) {
		t.Fatalf("Complete error = %v, want %v", err, completeErr)
	}
	if err := svc.Fail(context.Background(), "user-4", "key-4", "image_generate"); !errors.Is(err, failErr) {
		t.Fatalf("Fail error = %v, want %v", err, failErr)
	}
}
