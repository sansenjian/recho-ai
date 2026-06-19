package repository

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestRedeemRepositoryErrorMapsPgErrors(t *testing.T) {
	cases := []struct {
		name string
		msg  string
		want error
	}{
		{name: "invalid", msg: "invalid_code", want: ErrInvalidCode},
		{name: "disabled", msg: "code_disabled", want: ErrCodeDisabled},
		{name: "expired", msg: "code_expired", want: ErrCodeExpired},
		{name: "redeemed", msg: "code_already_redeemed", want: ErrCodeAlreadyRedeemed},
		{name: "exhausted", msg: "code_exhausted", want: ErrCodeExhausted},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := redeemRepositoryError(&pgconn.PgError{
				Code:    plpgsqlRaiseExceptionSQLState,
				Message: tc.msg,
			})
			if !errors.Is(err, tc.want) {
				t.Fatalf("expected %v, got %v", tc.want, err)
			}
		})
	}
}

func TestCreditErrorRequiresStructuredPgError(t *testing.T) {
	if isCreditError(errors.New("insufficient_credits"), "insufficient_credits") {
		t.Fatal("plain string errors should not be classified as credit errors")
	}
	if !isCreditError(&pgconn.PgError{
		Code:    plpgsqlRaiseExceptionSQLState,
		Message: "insufficient_credits",
	}, "insufficient_credits") {
		t.Fatal("expected structured PG error to match")
	}
}
