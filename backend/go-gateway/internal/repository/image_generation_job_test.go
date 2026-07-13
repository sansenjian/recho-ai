package repository

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type fakeImageJobRow struct {
	scan func(...any) error
}

func (r fakeImageJobRow) Scan(dest ...any) error {
	if r.scan == nil {
		return nil
	}
	return r.scan(dest...)
}

type fakeImageJobDB struct {
	queryRow pgx.Row
	querySQL []string
	queryArg [][]any
	execSQL  []string
	execArg  [][]any
	execTag  pgconn.CommandTag
	execErr  error
}

func (f *fakeImageJobDB) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	f.querySQL = append(f.querySQL, sql)
	f.queryArg = append(f.queryArg, args)
	if f.queryRow == nil {
		return fakeImageJobRow{scan: func(...any) error { return pgx.ErrNoRows }}
	}
	return f.queryRow
}

func (f *fakeImageJobDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execSQL = append(f.execSQL, sql)
	f.execArg = append(f.execArg, args)
	return f.execTag, f.execErr
}

func normalizedSQL(sql string) string {
	return strings.ToLower(strings.Join(strings.Fields(sql), " "))
}

func assignScanValue(dst any, value any) error {
	target := reflect.ValueOf(dst)
	if target.Kind() != reflect.Pointer || target.IsNil() {
		return errors.New("scan destination must be a non-nil pointer")
	}
	target = target.Elem()
	if value == nil {
		target.Set(reflect.Zero(target.Type()))
		return nil
	}
	source := reflect.ValueOf(value)
	if source.Type().AssignableTo(target.Type()) {
		target.Set(source)
		return nil
	}
	if target.Kind() == reflect.Pointer && source.Type().AssignableTo(target.Type().Elem()) {
		ptr := reflect.New(target.Type().Elem())
		ptr.Elem().Set(source)
		target.Set(ptr)
		return nil
	}
	if source.Type().ConvertibleTo(target.Type()) {
		target.Set(source.Convert(target.Type()))
		return nil
	}
	if target.Kind() == reflect.Pointer && source.Type().ConvertibleTo(target.Type().Elem()) {
		ptr := reflect.New(target.Type().Elem())
		ptr.Elem().Set(source.Convert(target.Type().Elem()))
		target.Set(ptr)
		return nil
	}
	return errors.New("unsupported scan value type")
}

func scanClaimedJob(dest ...any) error {
	if len(dest) != 23 {
		return errors.New("unexpected image job column count")
	}
	values := []any{
		"job-1", "batch-1", "request-1", "persistence_processing",
		"user-1", "idem-1", "hash-1", "credit-1",
		float64(2), float64(0), 2, 0, 1, 5,
		json.RawMessage(`{"images":[]}`), nil,
		time.Unix(100, 0).UTC(), "worker-1", "lease-1", time.Unix(101, 0).UTC(),
		time.Unix(90, 0).UTC(), time.Unix(100, 0).UTC(), nil,
	}
	for i, value := range values {
		if err := assignScanValue(dest[i], value); err != nil {
			return err
		}
	}
	return nil
}

func requireSQLFragments(t *testing.T, sql string, fragments ...string) {
	t.Helper()
	for _, fragment := range fragments {
		if !strings.Contains(sql, fragment) {
			t.Errorf("SQL missing %q: %s", fragment, sql)
		}
	}
}

func TestClaimNextUsesSkipLockedAndReturnsLeaseToken(t *testing.T) {
	db := &fakeImageJobDB{queryRow: fakeImageJobRow{scan: scanClaimedJob}}
	repo := &ImageGenerationJobRepository{db: db}

	job, err := repo.ClaimNext(context.Background(), "worker-1", 2*time.Minute)
	if err != nil {
		t.Fatalf("ClaimNext() error = %v", err)
	}
	if job == nil {
		t.Fatal("ClaimNext() returned nil job")
	}
	if job.LeaseToken == nil || *job.LeaseToken != "lease-1" {
		t.Fatalf("LeaseToken = %#v, want lease-1", job.LeaseToken)
	}
	if len(db.querySQL) != 1 || len(db.execSQL) != 0 {
		t.Fatalf("expected one QueryRow and no Exec calls, got query=%d exec=%d", len(db.querySQL), len(db.execSQL))
	}
	sql := normalizedSQL(db.querySQL[0])
	requireSQLFragments(t, sql,
		"for update skip locked",
		"gen_random_uuid()",
		"status in ('persistence_pending', 'refund_pending')",
		"refund_pending",
		"now()",
	)
}

func TestClaimNextReturnsNilForPgxNoRows(t *testing.T) {
	db := &fakeImageJobDB{queryRow: fakeImageJobRow{scan: func(...any) error { return pgx.ErrNoRows }}}
	repo := &ImageGenerationJobRepository{db: db}

	job, err := repo.ClaimNext(context.Background(), "worker-1", time.Minute)
	if err != nil {
		t.Fatalf("ClaimNext() error = %v", err)
	}
	if job != nil {
		t.Fatalf("ClaimNext() job = %#v, want nil", job)
	}
}

func TestClaimNextDoesNotClaimRefundPendingWithActiveLease(t *testing.T) {
	db := &fakeImageJobDB{queryRow: fakeImageJobRow{scan: func(...any) error { return pgx.ErrNoRows }}}
	repo := &ImageGenerationJobRepository{db: db}

	if _, err := repo.ClaimNext(context.Background(), "worker-1", time.Minute); err != nil {
		t.Fatalf("ClaimNext() error = %v", err)
	}
	sql := normalizedSQL(db.querySQL[0])
	readyStart := strings.Index(sql, "status in ('persistence_pending', 'refund_pending')")
	if readyStart < 0 {
		t.Fatalf("ClaimNext() SQL has no ready status branch: %s", sql)
	}
	readyEnd := strings.Index(sql[readyStart:], ") or (")
	if readyEnd < 0 {
		t.Fatalf("ClaimNext() SQL has no expired-lease branch: %s", sql)
	}
	readyBranch := sql[readyStart : readyStart+readyEnd]
	requireSQLFragments(t, readyBranch,
		"locked_until is null",
		"locked_until <= now()",
		"next_attempt_at <= now()",
	)
}

func TestSaveManifestReturnsErrJobLeaseLostWhenNoRowMatches(t *testing.T) {
	db := &fakeImageJobDB{execTag: pgconn.NewCommandTag("UPDATE 0")}
	repo := &ImageGenerationJobRepository{db: db}

	err := repo.SaveStagingManifest(context.Background(), "job-1", "worker-1", "lease-1", json.RawMessage(`{"images":[]}`), time.Minute)
	if !errors.Is(err, ErrJobLeaseLost) {
		t.Fatalf("SaveStagingManifest() error = %v, want ErrJobLeaseLost", err)
	}
	if len(db.execSQL) != 1 {
		t.Fatalf("expected one Exec call, got %d", len(db.execSQL))
	}
	sql := normalizedSQL(db.execSQL[0])
	requireSQLFragments(t, sql, "status = 'staging'", "locked_by", "lease_token", "locked_until > now()")
}

func TestSaveStagingManifestPassesJSONAsText(t *testing.T) {
	db := &fakeImageJobDB{execTag: pgconn.NewCommandTag("UPDATE 1")}
	repo := &ImageGenerationJobRepository{db: db}

	if err := repo.SaveStagingManifest(context.Background(), "job-1", "worker-1", "lease-1", json.RawMessage(`{"images":[]}`), time.Minute); err != nil {
		t.Fatalf("SaveStagingManifest() error = %v", err)
	}
	if len(db.execArg) != 1 || len(db.execArg[0]) < 4 {
		t.Fatalf("unexpected Exec args: %#v", db.execArg)
	}
	if _, ok := db.execArg[0][3].(string); !ok {
		t.Fatalf("manifest arg type = %T, want string for jsonb cast", db.execArg[0][3])
	}
}

func TestRecordStagingRefundUsesLeaseFenceAndUpdatesReturnedCount(t *testing.T) {
	db := &fakeImageJobDB{execTag: pgconn.NewCommandTag("UPDATE 1")}
	repo := &ImageGenerationJobRepository{db: db}

	if err := repo.RecordStagingRefund(context.Background(), "job-1", "worker-1", "lease-1", 1.25, 1, time.Minute); err != nil {
		t.Fatalf("RecordStagingRefund() error = %v", err)
	}
	requireSQLFragments(t, normalizedSQL(db.execSQL[0]),
		"refunded_amount = least(reserved_amount, refunded_amount + $4)",
		"returned_count = $5",
		"status = 'staging'",
		"locked_by",
		"lease_token",
		"locked_until > now()",
	)
}

func TestCreateStagingCanRecoverAnAmbiguousBatchInsert(t *testing.T) {
	db := &fakeImageJobDB{queryRow: fakeImageJobRow{scan: scanClaimedJob}}
	repo := &ImageGenerationJobRepository{db: db}

	_, err := repo.CreateStaging(context.Background(), CreateImageGenerationJob{
		GenerationBatchID: "batch-1",
		RequestID:         "request-1",
		RequestedCount:    1,
		ReturnedCount:     1,
		MaxAttempts:       3,
		LockOwner:         "request-1",
		LeaseDuration:     time.Minute,
		ResultManifest:    json.RawMessage(`{"images":[]}`),
	})
	if err != nil {
		t.Fatalf("CreateStaging() error = %v", err)
	}
	if len(db.querySQL) != 1 {
		t.Fatalf("expected one QueryRow call, got %d", len(db.querySQL))
	}
	requireSQLFragments(t, normalizedSQL(db.querySQL[0]),
		"on conflict (generation_batch_id) do update",
		"set generation_batch_id = excluded.generation_batch_id",
	)
}

func TestStartWithCreditUsesAtomicImageJobRPC(t *testing.T) {
	db := &fakeImageJobDB{queryRow: fakeImageJobRow{scan: func(dest ...any) error {
		if len(dest) != 6 {
			return errors.New("unexpected start result column count")
		}
		values := []any{
			"job-1", "staging", "lease-1", time.Unix(101, 0).UTC(), float64(9), "tx-1",
		}
		for i, value := range values {
			if err := assignScanValue(dest[i], value); err != nil {
				return err
			}
		}
		return nil
	}}}
	repo := &ImageGenerationJobRepository{db: db}

	started, err := repo.StartWithCredit(context.Background(), StartImageGenerationJobInput{
		UserID:            "user-1",
		IdempotencyKey:    "idem-1",
		RequestHash:       strings.Repeat("a", 64),
		GenerationBatchID: "batch-1",
		RequestID:         "request-1",
		RequestedCount:    1,
		ReservedAmount:    1,
		ResultManifest:    json.RawMessage(`{"version":1,"images":[]}`),
		LockOwner:         "request-1",
		LeaseDuration:     time.Minute,
	})
	if err != nil {
		t.Fatalf("StartWithCredit() error = %v", err)
	}
	if started == nil || started.Job == nil || started.Job.ID != "job-1" || started.TransactionID != "tx-1" {
		t.Fatalf("StartWithCredit() result = %#v", started)
	}
	if len(db.querySQL) != 1 {
		t.Fatalf("expected one QueryRow call, got %d", len(db.querySQL))
	}
	sql := normalizedSQL(db.querySQL[0])
	if !strings.Contains(sql, "public.start_image_generation_job") {
		t.Fatalf("expected atomic RPC call, got %s", sql)
	}
}

func TestFindStartByIdentityLoadsDurableAtomicResult(t *testing.T) {
	lease := "lease-existing"
	lockedUntil := time.Now().Add(time.Minute)
	db := &fakeImageJobDB{queryRow: fakeImageJobRow{scan: func(dest ...any) error {
		if len(dest) != 24 {
			return errors.New("unexpected durable start result column count")
		}
		values := []any{
			"job-existing", "batch-existing", "request-existing", "staging",
			"user-existing", "idem-existing", strings.Repeat("a", 64), "tx-existing",
			float64(1), float64(0), 1, 0, 0, 5,
			json.RawMessage(`{"version":1}`), nil,
			time.Now(), "request-existing", lease, lockedUntil,
			time.Now(), time.Now(), nil, float64(99),
		}
		for i, value := range values {
			if err := assignScanValue(dest[i], value); err != nil {
				return err
			}
		}
		return nil
	}}}
	repo := &ImageGenerationJobRepository{db: db}

	started, err := repo.FindStartByIdentity(
		context.Background(),
		"batch-existing",
		"user-existing",
		"idem-existing",
		strings.Repeat("a", 64),
	)
	if err != nil {
		t.Fatalf("FindStartByIdentity() error = %v", err)
	}
	if started == nil || started.Job == nil || started.Job.ID != "job-existing" || started.TransactionID != "tx-existing" || started.Balance != 99 {
		t.Fatalf("FindStartByIdentity() = %#v", started)
	}
	if len(db.querySQL) != 1 {
		t.Fatalf("queries = %#v, want one durable identity lookup", db.querySQL)
	}
	query := strings.ToLower(db.querySQL[0])
	for _, predicate := range []string{"generation_batch_id = $1", "user_id = $2::uuid", "idempotency_key = $3", "request_hash = $4"} {
		if !strings.Contains(query, predicate) {
			t.Fatalf("identity lookup missing %q: %s", predicate, db.querySQL[0])
		}
	}
}

func TestMarkCompletedRequiresProcessingStatusAndLeaseToken(t *testing.T) {
	db := &fakeImageJobDB{execTag: pgconn.NewCommandTag("UPDATE 1")}
	repo := &ImageGenerationJobRepository{db: db}

	err := repo.MarkCompleted(
		context.Background(),
		"job-1",
		"worker-1",
		"lease-1",
		json.RawMessage(`{"images":[]}`),
		json.RawMessage(`{"ok":true}`),
	)
	if err != nil {
		t.Fatalf("MarkCompleted() error = %v", err)
	}
	sql := normalizedSQL(db.execSQL[0])
	requireSQLFragments(t, sql,
		"status = 'persistence_processing'",
		"locked_by",
		"lease_token",
		"locked_until > now()",
		"status = 'completed'",
	)
	if !containsStringArg(db.execArg[0], "worker-1") || !containsStringArg(db.execArg[0], "lease-1") {
		t.Fatalf("MarkCompleted() args = %#v, want worker and lease token", db.execArg[0])
	}
}

func TestQueueCompensationClearsLeaseAndPreservesError(t *testing.T) {
	db := &fakeImageJobDB{execTag: pgconn.NewCommandTag("UPDATE 1")}
	repo := &ImageGenerationJobRepository{db: db}

	err := repo.QueueCompensation(context.Background(), "job-1", "worker-1", "lease-1", json.RawMessage(`{"images":[]}`), "persist_failed", "storage unavailable")
	if err != nil {
		t.Fatalf("QueueCompensation() error = %v", err)
	}
	sql := normalizedSQL(db.execSQL[0])
	requireSQLFragments(t, sql,
		"status in ('staging', 'persistence_processing')",
		"result_manifest = $4::jsonb",
		"status = 'refund_pending'",
		"locked_by = null",
		"lease_token = null",
		"locked_until = null",
		"next_attempt_at = now()",
		"last_error_code",
		"last_error_detail",
		"locked_until > now()",
	)
	if !containsStringArg(db.execArg[0], "persist_failed") || !containsStringArg(db.execArg[0], "storage unavailable") {
		t.Fatalf("QueueCompensation() args = %#v, want error code/detail", db.execArg[0])
	}
}

func TestRenewLeaseRefusesExpiredLease(t *testing.T) {
	db := &fakeImageJobDB{execTag: pgconn.NewCommandTag("UPDATE 0")}
	repo := &ImageGenerationJobRepository{db: db}

	err := repo.RenewLease(context.Background(), "job-1", "worker-1", "lease-1", time.Minute)
	if !errors.Is(err, ErrJobLeaseLost) {
		t.Fatalf("RenewLease() error = %v, want ErrJobLeaseLost", err)
	}
	if len(db.execSQL) != 1 {
		t.Fatalf("expected one Exec call, got %d", len(db.execSQL))
	}
	requireSQLFragments(t, normalizedSQL(db.execSQL[0]), "locked_by", "lease_token", "locked_until > now()")
}

func TestRecordRefundUsesLeaseFenceAndCapsAtReservedAmount(t *testing.T) {
	db := &fakeImageJobDB{execTag: pgconn.NewCommandTag("UPDATE 1")}
	repo := &ImageGenerationJobRepository{db: db}

	if err := repo.RecordRefund(context.Background(), "job-1", "worker-1", "lease-1", 1.25); err != nil {
		t.Fatalf("RecordRefund() error = %v", err)
	}
	sql := normalizedSQL(db.execSQL[0])
	requireSQLFragments(t, sql,
		"refunded_amount = least(reserved_amount, refunded_amount + $4)",
		"status = 'refund_pending'",
		"locked_by",
		"lease_token",
		"locked_until > now()",
	)
}

func containsStringArg(args []any, want string) bool {
	for _, arg := range args {
		if value, ok := arg.(string); ok && value == want {
			return true
		}
	}
	return false
}
