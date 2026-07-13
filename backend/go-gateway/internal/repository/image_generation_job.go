package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// imageJobDB is the narrow database surface needed by the job repository.
// Keeping this interface small makes the fencing rules testable without a
// database mock dependency.
type imageJobDB interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

var (
	ErrJobLeaseLost         = errors.New("image generation job lease lost")
	ErrInvalidJobTransition = errors.New("invalid image generation job transition")
)

// ImageGenerationJob is the durable state for one image-generation request.
type ImageGenerationJob struct {
	ID                  string
	GenerationBatchID   string
	RequestID           string
	Status              string
	UserID              *string
	IdempotencyKey      *string
	RequestHash         *string
	CreditTransactionID *string
	ReservedAmount      float64
	RefundedAmount      float64
	RequestedCount      int
	ReturnedCount       int
	RetryCount          int
	MaxAttempts         int
	ResultManifest      json.RawMessage
	ResponseBody        json.RawMessage
	NextAttemptAt       time.Time
	LockedBy            *string
	LeaseToken          *string
	LockedUntil         *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
	CompletedAt         *time.Time
}

// CreateImageGenerationJob contains the data needed to create a fenced
// staging row. Provider payloads are intentionally not part of this type.
type CreateImageGenerationJob struct {
	GenerationBatchID   string
	RequestID           string
	UserID              *string
	IdempotencyKey      *string
	RequestHash         *string
	CreditTransactionID *string
	ReservedAmount      float64
	RequestedCount      int
	ReturnedCount       int
	MaxAttempts         int
	ResultManifest      json.RawMessage
	LockOwner           string
	LeaseDuration       time.Duration
}

// StartImageGenerationJobInput contains the data atomically bound to an
// existing processing idempotency claim and a new credit reservation.
type StartImageGenerationJobInput struct {
	UserID            string
	IdempotencyKey    string
	RequestHash       string
	GenerationBatchID string
	RequestID         string
	RequestedCount    int
	ReservedAmount    float64
	CreditMetadata    map[string]any
	ResultManifest    json.RawMessage
	LockOwner         string
	LeaseDuration     time.Duration
}

// ImageGenerationJobStart is returned by the atomic start RPC.
type ImageGenerationJobStart struct {
	Job           *ImageGenerationJob
	Balance       float64
	TransactionID string
}

// ImageGenerationJobRepository implements token-fenced job transitions.
type ImageGenerationJobRepository struct {
	db imageJobDB
}

// NewImageGenerationJobRepository creates a repository backed by a pgx pool.
func NewImageGenerationJobRepository(pool *pgxpool.Pool) *ImageGenerationJobRepository {
	return &ImageGenerationJobRepository{db: pool}
}

// StartWithCredit atomically validates the processing idempotency claim,
// reserves credits, and creates the initial staging job.
func (r *ImageGenerationJobRepository) StartWithCredit(
	ctx context.Context,
	input StartImageGenerationJobInput,
) (*ImageGenerationJobStart, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("image generation job database client is nil")
	}
	manifest := input.ResultManifest
	if len(manifest) == 0 {
		manifest = json.RawMessage(`{}`)
	}
	metadata, err := marshalMetadata(input.CreditMetadata)
	if err != nil {
		return nil, err
	}
	leaseSeconds := int(input.LeaseDuration / time.Second)
	if leaseSeconds <= 0 {
		leaseSeconds = 1
	}

	query := `
		SELECT job_id, status, lease_token, locked_until, balance, transaction_id
		FROM public.start_image_generation_job(
			$1::uuid, $2, $3, $4, $5, $6, $7::numeric,
			$8::jsonb, $9::jsonb, $10, $11
		)
	`
	var (
		jobID         string
		status        string
		leaseToken    *string
		lockedUntil   *time.Time
		balance       float64
		transactionID string
	)
	if err := r.db.QueryRow(
		ctx,
		query,
		input.UserID,
		input.IdempotencyKey,
		input.RequestHash,
		input.GenerationBatchID,
		input.RequestID,
		input.RequestedCount,
		input.ReservedAmount,
		metadata,
		string(manifest),
		input.LockOwner,
		leaseSeconds,
	).Scan(&jobID, &status, &leaseToken, &lockedUntil, &balance, &transactionID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) || isCreditError(err, "insufficient_credits") {
			return nil, ErrInsufficientCredits
		}
		return nil, fmt.Errorf("start image generation job: %w", err)
	}

	userID := input.UserID
	idempotencyKey := input.IdempotencyKey
	requestHash := input.RequestHash
	creditTransactionID := transactionID
	return &ImageGenerationJobStart{
		Job: &ImageGenerationJob{
			ID:                  jobID,
			GenerationBatchID:   input.GenerationBatchID,
			RequestID:           input.RequestID,
			Status:              status,
			UserID:              &userID,
			IdempotencyKey:      &idempotencyKey,
			RequestHash:         &requestHash,
			CreditTransactionID: &creditTransactionID,
			ReservedAmount:      input.ReservedAmount,
			RequestedCount:      input.RequestedCount,
			ReturnedCount:       0,
			MaxAttempts:         5,
			ResultManifest:      append(json.RawMessage(nil), manifest...),
			LockedBy:            optionalRepositoryString(input.LockOwner),
			LeaseToken:          leaseToken,
			LockedUntil:         lockedUntil,
		},
		Balance:       balance,
		TransactionID: transactionID,
	}, nil
}

// FindStartByIdentity resolves a possibly committed atomic start without
// reserving credits again. It is used only after StartWithCredit returned an
// ambiguous transport/database error.
func (r *ImageGenerationJobRepository) FindStartByIdentity(
	ctx context.Context,
	generationBatchID,
	userID,
	idempotencyKey,
	requestHash string,
) (*ImageGenerationJobStart, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("image generation job database client is nil")
	}
	query := fmt.Sprintf(`
		SELECT %s,
		       COALESCE((
		           SELECT balance
		           FROM public.user_credit_balances
		           WHERE user_id = j.user_id
		       ), 0)
		FROM public.image_generation_jobs AS j
		WHERE generation_batch_id = $1
		  AND user_id = $2::uuid
		  AND idempotency_key = $3
		  AND request_hash = $4
		LIMIT 1
	`, imageGenerationJobColumns)

	var job ImageGenerationJob
	var balance float64
	err := r.db.QueryRow(ctx, query, generationBatchID, userID, idempotencyKey, requestHash).Scan(
		&job.ID,
		&job.GenerationBatchID,
		&job.RequestID,
		&job.Status,
		&job.UserID,
		&job.IdempotencyKey,
		&job.RequestHash,
		&job.CreditTransactionID,
		&job.ReservedAmount,
		&job.RefundedAmount,
		&job.RequestedCount,
		&job.ReturnedCount,
		&job.RetryCount,
		&job.MaxAttempts,
		&job.ResultManifest,
		&job.ResponseBody,
		&job.NextAttemptAt,
		&job.LockedBy,
		&job.LeaseToken,
		&job.LockedUntil,
		&job.CreatedAt,
		&job.UpdatedAt,
		&job.CompletedAt,
		&balance,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find atomic image generation job: %w", err)
	}
	transactionID := ""
	if job.CreditTransactionID != nil {
		transactionID = *job.CreditTransactionID
	}
	return &ImageGenerationJobStart{
		Job:           &job,
		Balance:       balance,
		TransactionID: transactionID,
	}, nil
}

func optionalRepositoryString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

const imageGenerationJobColumns = `
    id,
    generation_batch_id,
    request_id,
    status,
    user_id,
    idempotency_key,
    request_hash,
    credit_transaction_id,
    reserved_amount,
    refunded_amount,
    requested_count,
    returned_count,
    retry_count,
    max_attempts,
    result_manifest,
    response_body,
    next_attempt_at,
    locked_by,
    lease_token,
    locked_until,
    created_at,
    updated_at,
    completed_at`

func scanImageGenerationJob(row pgx.Row) (*ImageGenerationJob, error) {
	var job ImageGenerationJob
	if err := row.Scan(
		&job.ID,
		&job.GenerationBatchID,
		&job.RequestID,
		&job.Status,
		&job.UserID,
		&job.IdempotencyKey,
		&job.RequestHash,
		&job.CreditTransactionID,
		&job.ReservedAmount,
		&job.RefundedAmount,
		&job.RequestedCount,
		&job.ReturnedCount,
		&job.RetryCount,
		&job.MaxAttempts,
		&job.ResultManifest,
		&job.ResponseBody,
		&job.NextAttemptAt,
		&job.LockedBy,
		&job.LeaseToken,
		&job.LockedUntil,
		&job.CreatedAt,
		&job.UpdatedAt,
		&job.CompletedAt,
	); err != nil {
		return nil, err
	}
	return &job, nil
}

func (r *ImageGenerationJobRepository) execFenced(
	ctx context.Context,
	op string,
	query string,
	args ...any,
) error {
	tag, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("%s: %w", op, ErrJobLeaseLost)
	}
	return nil
}

// CreateStaging creates a staged job and assigns its initial DB-generated
// lease token. The result manifest contains storage references only.
func (r *ImageGenerationJobRepository) CreateStaging(
	ctx context.Context,
	input CreateImageGenerationJob,
) (*ImageGenerationJob, error) {
	manifest := input.ResultManifest
	if len(manifest) == 0 {
		manifest = json.RawMessage(`{}`)
	}

	query := fmt.Sprintf(`
        INSERT INTO public.image_generation_jobs (
            generation_batch_id,
            request_id,
            user_id,
            idempotency_key,
            request_hash,
            status,
            credit_transaction_id,
            reserved_amount,
            requested_count,
            returned_count,
            max_attempts,
            result_manifest,
            locked_by,
            lease_token,
            locked_until
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            'staging',
            $6,
            $7,
            $8,
            $9,
            $10,
            $11::jsonb,
            $12,
            gen_random_uuid(),
            now() + make_interval(secs => $13)
        )
        ON CONFLICT (generation_batch_id) DO UPDATE
        SET generation_batch_id = EXCLUDED.generation_batch_id
        RETURNING %s`, imageGenerationJobColumns)

	job, err := scanImageGenerationJob(r.db.QueryRow(
		ctx,
		query,
		input.GenerationBatchID,
		input.RequestID,
		input.UserID,
		input.IdempotencyKey,
		input.RequestHash,
		input.CreditTransactionID,
		input.ReservedAmount,
		input.RequestedCount,
		input.ReturnedCount,
		input.MaxAttempts,
		string(manifest),
		input.LockOwner,
		input.LeaseDuration.Seconds(),
	))
	if err != nil {
		return nil, fmt.Errorf("create image generation job: %w", err)
	}
	return job, nil
}

// SaveStagingManifest refreshes a staging lease using both owner and lease
// token as the fencing predicates.
func (r *ImageGenerationJobRepository) SaveStagingManifest(
	ctx context.Context,
	jobID string,
	ownerID string,
	leaseToken string,
	manifest json.RawMessage,
	lease time.Duration,
) error {
	query := `
        UPDATE public.image_generation_jobs
		SET result_manifest = $4::jsonb,
		    returned_count = jsonb_array_length(COALESCE($4::jsonb->'images', '[]'::jsonb)),
		    locked_until = now() + make_interval(secs => $5),
            updated_at = now()
        WHERE id = $1
          AND status = 'staging'
          AND locked_by = $2
          AND lease_token = $3
          AND locked_until > now()`
	return r.execFenced(ctx, "save staging manifest", query, jobID, ownerID, leaseToken, string(manifest), lease.Seconds())
}

// Activate moves a staged job into the persistence queue and releases its
// staging lease.
func (r *ImageGenerationJobRepository) Activate(ctx context.Context, jobID, ownerID, leaseToken string) error {
	query := `
        UPDATE public.image_generation_jobs
        SET status = 'persistence_pending',
            locked_by = NULL,
            lease_token = NULL,
            locked_until = NULL,
            next_attempt_at = now(),
            updated_at = now()
        WHERE id = $1
          AND status = 'staging'
          AND locked_by = $2
          AND lease_token = $3
          AND locked_until > now()`
	return r.execFenced(ctx, "activate image generation job", query, jobID, ownerID, leaseToken)
}

// RecordStagingRefund persists a partial provider refund and returned count
// before the job is handed to the persistence worker.
func (r *ImageGenerationJobRepository) RecordStagingRefund(
	ctx context.Context,
	jobID,
	ownerID,
	leaseToken string,
	amount float64,
	returnedCount int,
	lease time.Duration,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET refunded_amount = LEAST(reserved_amount, refunded_amount + $4),
            returned_count = $5,
            locked_until = now() + make_interval(secs => $6),
            updated_at = now()
        WHERE id = $1
          AND status = 'staging'
          AND locked_by = $2
          AND lease_token = $3
          AND locked_until > now()`
	return r.execFenced(ctx, "record staging image refund", query, jobID, ownerID, leaseToken, amount, returnedCount, lease.Seconds())
}

// ClaimNext atomically claims the next ready or expired job. The CTE and
// SKIP LOCKED keep concurrent workers from claiming the same row.
func (r *ImageGenerationJobRepository) ClaimNext(
	ctx context.Context,
	workerID string,
	lease time.Duration,
) (*ImageGenerationJob, error) {
	query := fmt.Sprintf(`
        WITH candidate AS (
            SELECT id AS job_id
            FROM public.image_generation_jobs
            WHERE (
                status IN ('persistence_pending', 'refund_pending')
                AND (locked_until IS NULL OR locked_until <= now())
                AND next_attempt_at <= now()
            ) OR (
                status IN ('staging', 'persistence_processing')
                AND locked_until <= now()
            )
            ORDER BY next_attempt_at, created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE public.image_generation_jobs AS j
        SET status = CASE
                WHEN j.status = 'persistence_pending' THEN 'persistence_processing'
                ELSE j.status
            END,
            locked_by = $1,
            lease_token = gen_random_uuid(),
            locked_until = now() + make_interval(secs => $2),
            retry_count = retry_count + 1,
            updated_at = now()
        FROM candidate c
        WHERE j.id = c.job_id
        RETURNING %s`, imageGenerationJobColumns)

	job, err := scanImageGenerationJob(r.db.QueryRow(ctx, query, workerID, lease.Seconds()))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("claim image generation job: %w", err)
	}
	return job, nil
}

// RenewLease extends a lease while preserving its owner/token fence.
func (r *ImageGenerationJobRepository) RenewLease(
	ctx context.Context,
	jobID,
	workerID,
	leaseToken string,
	lease time.Duration,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET locked_until = now() + make_interval(secs => $4),
            updated_at = now()
        WHERE id = $1
          AND status IN ('staging', 'persistence_processing', 'refund_pending')
          AND locked_by = $2
		  AND lease_token = $3
		  AND locked_until > now()`
	return r.execFenced(ctx, "renew image generation job lease", query, jobID, workerID, leaseToken, lease.Seconds())
}

// SaveProcessingManifest persists a processing manifest and refreshes its
// lease under the owner/token fence.
func (r *ImageGenerationJobRepository) SaveProcessingManifest(
	ctx context.Context,
	jobID,
	workerID,
	leaseToken string,
	manifest json.RawMessage,
	lease time.Duration,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET result_manifest = $4::jsonb,
            locked_until = now() + make_interval(secs => $5),
            updated_at = now()
        WHERE id = $1
          AND status = 'persistence_processing'
          AND locked_by = $2
		  AND lease_token = $3
		  AND locked_until > now()`
	return r.execFenced(ctx, "save processing manifest", query, jobID, workerID, leaseToken, string(manifest), lease.Seconds())
}

// SchedulePersistenceRetry returns a processing job to the pending queue.
func (r *ImageGenerationJobRepository) SchedulePersistenceRetry(
	ctx context.Context,
	jobID,
	workerID,
	leaseToken string,
	next time.Time,
	code,
	detail string,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET status = 'persistence_pending',
            locked_by = NULL,
            lease_token = NULL,
            locked_until = NULL,
            next_attempt_at = $4,
            last_error_code = $5,
            last_error_detail = $6,
            updated_at = now()
        WHERE id = $1
          AND status = 'persistence_processing'
          AND locked_by = $2
		  AND lease_token = $3
		  AND locked_until > now()`
	return r.execFenced(ctx, "schedule persistence retry", query, jobID, workerID, leaseToken, next, code, detail)
}

// QueueCompensation durably records the need for a refund before external
// compensation is attempted.
func (r *ImageGenerationJobRepository) QueueCompensation(
	ctx context.Context,
	jobID string,
	ownerID string,
	leaseToken string,
	manifest json.RawMessage,
	code string,
	detail string,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET result_manifest = $4::jsonb,
            status = 'refund_pending',
            locked_by = NULL,
            lease_token = NULL,
            locked_until = NULL,
            next_attempt_at = now(),
            last_error_code = $5,
            last_error_detail = $6,
            updated_at = now()
        WHERE id = $1
          AND status IN ('staging', 'persistence_processing')
          AND locked_by = $2
          AND lease_token = $3
          AND locked_until > now()`
	if len(manifest) == 0 {
		manifest = json.RawMessage(`{}`)
	}
	return r.execFenced(ctx, "queue image generation compensation", query, jobID, ownerID, leaseToken, string(manifest), code, detail)
}

// ScheduleCompensationRetry releases a refund worker lease and leaves the job
// in the refund queue for a later attempt.
func (r *ImageGenerationJobRepository) ScheduleCompensationRetry(
	ctx context.Context,
	jobID,
	workerID,
	leaseToken string,
	next time.Time,
	code,
	detail string,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET status = 'refund_pending',
            locked_by = NULL,
            lease_token = NULL,
            locked_until = NULL,
            next_attempt_at = $4,
            last_error_code = $5,
            last_error_detail = $6,
            updated_at = now()
        WHERE id = $1
          AND status = 'refund_pending'
          AND locked_by = $2
		  AND lease_token = $3
		  AND locked_until > now()`
	return r.execFenced(ctx, "schedule compensation retry", query, jobID, workerID, leaseToken, next, code, detail)
}

// RecordRefund durably records an externally applied refund while retaining
// refund_pending status. This prevents a later retry (for example, when the
// idempotency service is unavailable) from issuing the same refund again.
func (r *ImageGenerationJobRepository) RecordRefund(
	ctx context.Context,
	jobID,
	workerID,
	leaseToken string,
	amount float64,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET refunded_amount = LEAST(reserved_amount, refunded_amount + $4),
            updated_at = now()
        WHERE id = $1
          AND status = 'refund_pending'
          AND locked_by = $2
		  AND lease_token = $3
		  AND locked_until > now()`
	return r.execFenced(ctx, "record image generation refund", query, jobID, workerID, leaseToken, amount)
}

// MarkCompleted records the final manifest/response and releases the lease.
func (r *ImageGenerationJobRepository) MarkCompleted(
	ctx context.Context,
	jobID,
	workerID,
	leaseToken string,
	manifest,
	response json.RawMessage,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET result_manifest = $4::jsonb,
            response_body = $5::jsonb,
            status = 'completed',
            locked_by = NULL,
            lease_token = NULL,
            locked_until = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE id = $1
          AND status = 'persistence_processing'
          AND locked_by = $2
		  AND lease_token = $3
		  AND locked_until > now()`
	return r.execFenced(ctx, "mark image generation job completed", query, jobID, workerID, leaseToken, string(manifest), string(response))
}

// MarkFailed marks a job failed after its compensation work is complete.
func (r *ImageGenerationJobRepository) MarkFailed(
	ctx context.Context,
	jobID,
	workerID,
	leaseToken,
	code,
	detail string,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET status = 'failed',
            locked_by = NULL,
            lease_token = NULL,
            locked_until = NULL,
            last_error_code = $4,
            last_error_detail = $5,
            completed_at = now(),
            updated_at = now()
        WHERE id = $1
          AND status = 'refund_pending'
          AND locked_by = $2
		  AND lease_token = $3
		  AND locked_until > now()`
	return r.execFenced(ctx, "mark image generation job failed", query, jobID, workerID, leaseToken, code, detail)
}

// MarkRefunded records a successful compensation and releases the lease.
func (r *ImageGenerationJobRepository) MarkRefunded(
	ctx context.Context,
	jobID,
	workerID,
	leaseToken string,
	refundedAmount float64,
) error {
	query := `
        UPDATE public.image_generation_jobs
        SET status = 'refunded',
            refunded_amount = $4,
            locked_by = NULL,
            lease_token = NULL,
            locked_until = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE id = $1
          AND status = 'refund_pending'
          AND locked_by = $2
		  AND lease_token = $3
		  AND locked_until > now()`
	return r.execFenced(ctx, "mark image generation job refunded", query, jobID, workerID, leaseToken, refundedAmount)
}
