# Persistent Image Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace goroutine-only image persistence with a PostgreSQL-backed staging job and a lease-fenced recoverable Go worker without changing the public image-generation response shape.

**Architecture:** `ImageOrchestrator.Generate` creates a provisional `staging` row, copies Provider outputs to deterministic staging objects, and activates the row only after every source is durable. A single Go worker claims jobs with `FOR UPDATE SKIP LOCKED`, renews a fencing-token lease, persists each manifest phase, completes idempotency, and records retry/refund terminal states.

**Tech Stack:** Go 1.25, pgx v5, PostgreSQL/Supabase migrations, S3-compatible object storage, Vitest, Go tests.

---

## File Structure

- Create `tests/image-generation-jobs-migration.test.ts`: static migration contract while local Supabase Docker is unavailable.
- Modify `supabase/migrations/20260712072117_add_image_generation_jobs.sql`: job schema, constraints, indexes, RLS, and grants.
- Create `backend/go-gateway/internal/repository/image_generation_job.go`: persistence types and token-guarded SQL transitions.
- Create `backend/go-gateway/internal/repository/image_generation_job_test.go`: repository SQL and transition tests through a narrow fake DB.
- Modify `backend/go-gateway/internal/service/storage.go`: strict staging/delete APIs and complete history upsert.
- Create `backend/go-gateway/internal/service/storage_job_test.go`: staging limits, checksums, delete propagation, and history SQL coverage.
- Modify `backend/go-gateway/internal/service/idempotency.go`: return `Complete`/`Fail` errors.
- Modify `backend/go-gateway/internal/repository/idempotency.go`: hash-first reclaim rules and active-job protection.
- Create `backend/go-gateway/internal/repository/idempotency_job_test.go`: active-job and stale-reclaim regression tests.
- Modify `backend/go-gateway/internal/orchestrator/types.go`: job store/staging interfaces and manifest types.
- Modify `backend/go-gateway/internal/orchestrator/image_generate.go`: provisional job, staging, activation, and durable failure path.
- Modify `backend/go-gateway/internal/orchestrator/image_generate_test.go`: request-flow TDD coverage.
- Create `backend/go-gateway/internal/orchestrator/image_job_processor.go`: resumable per-image processing and terminal compensation.
- Create `backend/go-gateway/internal/orchestrator/image_job_processor_test.go`: phase-resume and compensation tests.
- Create `backend/go-gateway/internal/orchestrator/image_job_worker.go`: claim/poll/heartbeat/retry loop.
- Create `backend/go-gateway/internal/orchestrator/image_job_worker_test.go`: deterministic `RunOnce` and cancellation tests.
- Modify `backend/go-gateway/internal/handler/image.go`: configure job store and construct the worker without starting it.
- Modify `backend/go-gateway/internal/handler/image_test.go`: durable enqueue behavior at the HTTP boundary.
- Modify `backend/go-gateway/internal/config/config.go`: worker option environment values.
- Modify `backend/go-gateway/internal/config/config_test.go`: worker option defaults and overrides.
- Modify `backend/go-gateway/cmd/server/main.go`: app context, worker lifecycle, and graceful shutdown.
- Modify `scripts/start-render-backend.sh`: forward TERM and wait for both child processes.
- Modify `docs/optimization-plan-1-3-4-5-6.md`: record item 5 implementation and verification.

### Task 1: Add the Durable Job Migration

**Files:**
- Create: `tests/image-generation-jobs-migration.test.ts`
- Modify: `supabase/migrations/20260712072117_add_image_generation_jobs.sql`

- [ ] **Step 1: Write the failing migration contract test**

Create a Vitest test that reads the exact migration and asserts the table, seven statuses, `lease_token`, JSON-object checks, amount/count checks, the two partial claim indexes, forced RLS, browser-role revokes, and service-role non-delete grant:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve('supabase/migrations/20260712072117_add_image_generation_jobs.sql'),
  'utf8',
).toLowerCase()

describe('image generation jobs migration', () => {
  it('defines a fenced private durable queue', () => {
    expect(sql).toContain('create table public.image_generation_jobs')
    for (const status of ['staging', 'persistence_pending', 'persistence_processing', 'completed', 'failed', 'refund_pending', 'refunded']) {
      expect(sql).toContain(`'${status}'`)
    }
    expect(sql).toContain('lease_token uuid')
    expect(sql).toMatch(/jsonb_typeof\(result_manifest\)\s*=\s*'object'/)
    expect(sql).toContain('refunded_amount <= reserved_amount')
    expect(sql).toContain('returned_count <= requested_count')
    expect(sql).toContain('where status in (\'persistence_pending\', \'refund_pending\')')
    expect(sql).toContain('where status in (\'staging\', \'persistence_processing\')')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('force row level security')
    expect(sql).toContain('revoke all on table public.image_generation_jobs from public, anon, authenticated')
    expect(sql).toContain('grant select, insert, update on table public.image_generation_jobs to service_role')
    expect(sql).not.toContain('grant select, insert, update, delete on table public.image_generation_jobs')
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/image-generation-jobs-migration.test.ts`

Expected: FAIL because the generated migration file is empty.

- [ ] **Step 3: Implement the schema**

Create `public.image_generation_jobs` with the columns and constraints from the design. Use immutable partial-index predicates:

```sql
create index image_generation_jobs_ready_claim_idx
  on public.image_generation_jobs (next_attempt_at, created_at)
  where status in ('persistence_pending', 'refund_pending');

create index image_generation_jobs_expired_lease_idx
  on public.image_generation_jobs (locked_until, created_at)
  where status in ('staging', 'persistence_processing');
```

Add the active idempotency guard:

```sql
create unique index image_generation_jobs_active_idempotency_idx
  on public.image_generation_jobs (user_id, idempotency_key)
  where idempotency_key is not null
    and status in ('staging', 'persistence_pending', 'persistence_processing', 'completed', 'refund_pending');
```

Finish with explicit RLS and privileges:

```sql
alter table public.image_generation_jobs enable row level security;
alter table public.image_generation_jobs force row level security;
revoke all on table public.image_generation_jobs from public, anon, authenticated;
grant select, insert, update on table public.image_generation_jobs to service_role;
```

- [ ] **Step 4: Run the migration contract test and verify GREEN**

Run: `npm test -- tests/image-generation-jobs-migration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add tests/image-generation-jobs-migration.test.ts supabase/migrations/20260712072117_add_image_generation_jobs.sql
git commit -m "feat(db): add durable image generation jobs"
```

### Task 2: Implement the Job Repository and Fencing Rules

**Files:**
- Create: `backend/go-gateway/internal/repository/image_generation_job.go`
- Create: `backend/go-gateway/internal/repository/image_generation_job_test.go`

- [ ] **Step 1: Write failing tests for claim and lease loss**

Define a narrow fake around:

```go
type imageJobDB interface {
    QueryRow(context.Context, string, ...any) pgx.Row
    Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}
```

Tests must assert:

```go
func TestClaimNextUsesSkipLockedAndReturnsLeaseToken(t *testing.T)
func TestSaveManifestReturnsErrJobLeaseLostWhenNoRowMatches(t *testing.T)
func TestMarkCompletedRequiresProcessingStatusAndLeaseToken(t *testing.T)
func TestClaimNextReturnsNilForPgxNoRows(t *testing.T)
```

The fake captures SQL and arguments; `RowsAffected()==0` must produce `ErrJobLeaseLost`.

- [ ] **Step 2: Run repository tests and verify RED**

Run: `cd backend/go-gateway; go test ./internal/repository -run 'Test(ClaimNext|SaveManifest|MarkCompleted)' -count=1`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Add persistence types and explicit methods**

Implement:

```go
var ErrJobLeaseLost = errors.New("image generation job lease lost")

type ImageGenerationJob struct {
    ID, GenerationBatchID, RequestID, Status string
    UserID, IdempotencyKey, RequestHash, CreditTransactionID *string
    ReservedAmount, RefundedAmount float64
    RequestedCount, ReturnedCount, RetryCount, MaxAttempts int
    ResultManifest, ResponseBody json.RawMessage
    NextAttemptAt time.Time
    LockedBy, LeaseToken *string
    LockedUntil *time.Time
}

type CreateImageGenerationJob struct {
    GenerationBatchID, RequestID string
    UserID, IdempotencyKey, RequestHash, CreditTransactionID *string
    ReservedAmount float64
    RequestedCount, ReturnedCount, MaxAttempts int
    ResultManifest json.RawMessage
    LockOwner string
    LeaseDuration time.Duration
}
```

Add methods:

```go
CreateStaging(context.Context, CreateImageGenerationJob) (*ImageGenerationJob, error)
SaveStagingManifest(context.Context, jobID, leaseToken string, manifest json.RawMessage, lease time.Duration) error
Activate(context.Context, jobID, leaseToken string) error
ClaimNext(context.Context, workerID string, lease time.Duration) (*ImageGenerationJob, error)
RenewLease(context.Context, jobID, workerID, leaseToken string, lease time.Duration) error
SaveProcessingManifest(context.Context, jobID, workerID, leaseToken string, manifest json.RawMessage, lease time.Duration) error
SchedulePersistenceRetry(context.Context, jobID, workerID, leaseToken string, next time.Time, code, detail string) error
QueueCompensation(context.Context, jobID, ownerID, leaseToken, code, detail string) error
ScheduleCompensationRetry(context.Context, jobID, workerID, leaseToken string, next time.Time, code, detail string) error
MarkCompleted(context.Context, jobID, workerID, leaseToken string, manifest, response json.RawMessage) error
MarkFailed(context.Context, jobID, workerID, leaseToken, code, detail string) error
MarkRefunded(context.Context, jobID, workerID, leaseToken string, refundedAmount float64) error
```

Claim with one statement:

```sql
with candidate as (
  select id
  from public.image_generation_jobs
  where (
      status in ('persistence_pending', 'refund_pending')
      and next_attempt_at <= now()
    ) or (
      status in ('staging', 'persistence_processing')
      and locked_until <= now()
    )
  order by next_attempt_at, created_at
  for update skip locked
  limit 1
)
update public.image_generation_jobs j
set status = case when j.status = 'persistence_pending' then 'persistence_processing' else j.status end,
    locked_by = $1,
    lease_token = gen_random_uuid(),
    locked_until = now() + make_interval(secs => $2),
    retry_count = retry_count + 1,
    updated_at = now()
from candidate c
where j.id = c.id
returning ...;
```

- [ ] **Step 4: Run repository tests and verify GREEN**

Run: `cd backend/go-gateway; go test ./internal/repository -run 'Test(ClaimNext|SaveManifest|MarkCompleted)' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/go-gateway/internal/repository/image_generation_job.go backend/go-gateway/internal/repository/image_generation_job_test.go
git commit -m "feat(go-gateway): add fenced image job repository"
```

### Task 3: Add Strict Staging Storage and Complete History Upserts

**Files:**
- Modify: `backend/go-gateway/internal/service/storage.go`
- Create: `backend/go-gateway/internal/service/storage_job_test.go`

- [ ] **Step 1: Write failing storage behavior tests**

Cover:

```go
func TestStageFromBufferRejectsOversizedImage(t *testing.T)
func TestStageFromURLRejectsBodyLargerThanLimit(t *testing.T)
func TestStageFromBufferReturnsChecksumAndExactPath(t *testing.T)
func TestDeleteObjectsReturnsUploaderError(t *testing.T)
func TestSaveImageHistoryConflictUpdatesAllPermanentFields(t *testing.T)
```

Use an injected uploader interface in `StorageService` so tests do not require S3.

- [ ] **Step 2: Run storage tests and verify RED**

Run: `cd backend/go-gateway; go test ./internal/service -run 'Test(Stage|DeleteObjects|SaveImageHistoryConflict)' -count=1`

Expected: FAIL because strict staging methods and uploader injection are absent.

- [ ] **Step 3: Implement strict staging APIs**

Add:

```go
type StagedImage struct {
    StoragePath string
    Mime string
    Bytes int
    SHA256 string
}

func (s *StorageService) StageFromURL(ctx context.Context, sourceURL, storagePath string) (*StagedImage, error)
func (s *StorageService) StageFromBuffer(ctx context.Context, data []byte, mime, storagePath string) (*StagedImage, error)
func (s *StorageService) DeleteObjects(ctx context.Context, paths ...string) error
func (s *StorageService) DeleteImageHistoryByID(ctx context.Context, id string) error
```

Read URL bodies with `io.LimitReader(resp.Body, maxImageSize+1)` and reject `len(data) > maxImageSize`; do not silently truncate. Compute SHA-256 over staged bytes. Keep `CleanupObjects` for existing best-effort callers.

Expand `ON CONFLICT (id) DO UPDATE` to update all permanent paths/URLs, dimensions, bytes, prompts, model fields, references, visibility, funding, credit fields, expiry, and generated time.

- [ ] **Step 4: Run storage tests and verify GREEN**

Run: `cd backend/go-gateway; go test ./internal/service -run 'Test(Stage|DeleteObjects|SaveImageHistoryConflict)' -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/go-gateway/internal/service/storage.go backend/go-gateway/internal/service/storage_job_test.go
git commit -m "feat(go-gateway): add durable image staging storage"
```

### Task 4: Make Idempotency Writes Observable and Protect Active Jobs

**Files:**
- Modify: `backend/go-gateway/internal/service/idempotency.go`
- Modify: `backend/go-gateway/internal/repository/idempotency.go`
- Create: `backend/go-gateway/internal/repository/idempotency_job_test.go`
- Modify: affected Go test doubles under `backend/go-gateway/internal/handler` and `backend/go-gateway/internal/orchestrator`

- [ ] **Step 1: Write failing idempotency regression tests**

Add tests proving:

```go
func TestAcquireConflictsBeforeReclaimWhenRequestHashDiffers(t *testing.T)
func TestAcquireDoesNotReclaimStaleImageKeyWithActiveJob(t *testing.T)
func TestIdempotencyCompleteReturnsRepositoryError(t *testing.T)
func TestIdempotencyFailReturnsRepositoryError(t *testing.T)
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd backend/go-gateway; go test ./internal/repository ./internal/service -run 'Test(Acquire|Idempotency)' -count=1`

Expected: FAIL because hashes are checked after stale reclaim and service writes return no error.

- [ ] **Step 3: Implement the behavior**

Change the interface and concrete service:

```go
Complete(ctx context.Context, userID, idemKey, scope string, responseCode int16, responseBody any, transactionID string) error
Fail(ctx context.Context, userID, idemKey, scope string) error
```

In `Acquire`, reject a different request hash before expiry/stale/failed reclaim. For stale `image_generate` records, query active `image_generation_jobs` with the same user/key/hash and return conflict while one exists. Increase the pre-job timeout beyond the 360-second Provider timeout.

Make repository `Fail` check `RowsAffected()` and return an error when the processing record was not updated.

- [ ] **Step 4: Update test doubles and verify GREEN**

Run: `cd backend/go-gateway; go test ./internal/repository ./internal/service ./internal/orchestrator ./internal/handler -count=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/go-gateway/internal/service/idempotency.go backend/go-gateway/internal/repository/idempotency.go backend/go-gateway/internal/repository/idempotency_job_test.go backend/go-gateway/internal/orchestrator backend/go-gateway/internal/handler
git commit -m "fix(go-gateway): keep active image jobs idempotent"
```

### Task 5: Replace Goroutine Persistence with Provisional Staging Jobs

**Files:**
- Modify: `backend/go-gateway/internal/orchestrator/types.go`
- Modify: `backend/go-gateway/internal/orchestrator/image_generate.go`
- Modify: `backend/go-gateway/internal/orchestrator/image_generate_test.go`

- [ ] **Step 1: Replace old async tests with failing durable-enqueue tests**

Add tests:

```go
func TestGenerateCreatesStagingJobBeforeUploadingSources(t *testing.T)
func TestGenerateWaitsForEveryStageAndActivationBeforeReturning(t *testing.T)
func TestGenerateJobManifestOmitsProviderURLAndBase64(t *testing.T)
func TestGenerateStagingFailureTransitionsDurableCompensation(t *testing.T)
func TestGenerateActivationFailureDoesNotReturnSuccess(t *testing.T)
```

Delete the test that asserts the in-memory Saga goroutine completes persistence.

- [ ] **Step 2: Run orchestrator tests and verify RED**

Run: `cd backend/go-gateway; go test ./internal/orchestrator -run 'TestGenerate' -count=1`

Expected: FAIL because `Generate` still calls `persistAsyncSaga`.

- [ ] **Step 3: Add job interfaces and manifest types**

Add to `types.go`:

```go
type ImageJobEnqueuer interface {
    CreateStaging(context.Context, repository.CreateImageGenerationJob) (*repository.ImageGenerationJob, error)
    SaveStagingManifest(context.Context, jobID, leaseToken string, manifest json.RawMessage, lease time.Duration) error
    Activate(context.Context, jobID, leaseToken string) error
    QueueCompensation(context.Context, jobID, ownerID, leaseToken, code, detail string) error
}

type ImageJobStore interface {
    ImageJobEnqueuer
    ClaimNext(context.Context, workerID string, lease time.Duration) (*repository.ImageGenerationJob, error)
    RenewLease(context.Context, jobID, workerID, leaseToken string, lease time.Duration) error
    SaveProcessingManifest(context.Context, jobID, workerID, leaseToken string, manifest json.RawMessage, lease time.Duration) error
    SchedulePersistenceRetry(context.Context, jobID, workerID, leaseToken string, next time.Time, code, detail string) error
    ScheduleCompensationRetry(context.Context, jobID, workerID, leaseToken string, next time.Time, code, detail string) error
    MarkCompleted(context.Context, jobID, workerID, leaseToken string, manifest, response json.RawMessage) error
    MarkFailed(context.Context, jobID, workerID, leaseToken, code, detail string) error
    MarkRefunded(context.Context, jobID, workerID, leaseToken string, refundedAmount float64) error
}

type ImageJobManifest struct {
    Version int `json:"version"`
    Metadata ImageJobResponseMetadata `json:"metadata"`
    Images []ImageJobManifestImage `json:"images"`
}

type ImageJobManifestImage struct {
    Result ImageResult `json:"result"`
    StagedPath string `json:"stagedPath,omitempty"`
    StagedMime string `json:"stagedMime,omitempty"`
    StagedBytes int `json:"stagedBytes,omitempty"`
    StagedSHA256 string `json:"stagedSha256,omitempty"`
    Phase string `json:"phase"`
}
```

- [ ] **Step 4: Implement provisional staging**

Add `WithImageJobStore`. In `Generate`, create scrubbed `awaiting_stage` entries, call `CreateStaging`, stage each request-local source at `staging/image-jobs/<batch>/<image>.source`, persist each manifest update, and call `Activate` before returning.

Do not marshal `generatedImageRecord.source` or the temporary `GenResponse` into the job. On staging or activation failure, call `QueueCompensation` before returning an error. Remove `persistAsyncSaga` and its in-memory Saga rollback path after the new tests cover equivalent failure behavior.

- [ ] **Step 5: Run orchestrator tests and verify GREEN**

Run: `cd backend/go-gateway; go test ./internal/orchestrator -count=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/go-gateway/internal/orchestrator/types.go backend/go-gateway/internal/orchestrator/image_generate.go backend/go-gateway/internal/orchestrator/image_generate_test.go
git commit -m "feat(go-gateway): enqueue staged image persistence jobs"
```

### Task 6: Implement the Resumable Processor and Worker

**Files:**
- Create: `backend/go-gateway/internal/orchestrator/image_job_processor.go`
- Create: `backend/go-gateway/internal/orchestrator/image_job_processor_test.go`
- Create: `backend/go-gateway/internal/orchestrator/image_job_worker.go`
- Create: `backend/go-gateway/internal/orchestrator/image_job_worker_test.go`
- Modify: `backend/go-gateway/internal/orchestrator/types.go`

- [ ] **Step 1: Write failing processor phase tests**

Cover `staged -> stored`, `stored -> history_saved`, resume after every manifest write, checksum mismatch, full permanent response construction, `Complete` error preventing completion, and anonymous history cleanup.

- [ ] **Step 2: Run processor tests and verify RED**

Run: `cd backend/go-gateway; go test ./internal/orchestrator -run 'TestImageJobProcessor' -count=1`

Expected: FAIL because the processor does not exist.

- [ ] **Step 3: Implement resumable processing**

For each manifest image:

```go
switch image.Phase {
case "staged":
    // download, verify checksum, StoreFromBufferAtPath("generated/"+id),
    // clear TemporaryURL/DataURL, set permanent fields, save phase "stored"
case "stored":
    // SaveImageHistory with full upsert, save phase "history_saved"
case "history_saved":
    // no-op
}
```

After all images are `history_saved`, build permanent `GenResponse`, require idempotency `Complete` success, and return the response JSON for the repository terminal transition.

- [ ] **Step 4: Write failing worker control tests**

Cover:

```go
func TestImageJobWorkerRunOnceReturnsFalseWhenNoJob(t *testing.T)
func TestImageJobWorkerSchedulesRetryBeforeMaxAttempts(t *testing.T)
func TestImageJobWorkerMovesRefundFailureToRefundPending(t *testing.T)
func TestImageJobWorkerRetriesRefundPendingUntilRefunded(t *testing.T)
func TestImageJobWorkerCancelsProcessingWhenLeaseRenewalFails(t *testing.T)
func TestImageJobWorkerDoesNothingTerminalAfterContextCancellation(t *testing.T)
```

- [ ] **Step 5: Implement `RunOnce`, heartbeat, and polling**

Define injected options:

```go
type ImageJobWorkerOptions struct {
    WorkerID string
    PollInterval time.Duration
    LeaseDuration time.Duration
    HeartbeatInterval time.Duration
    JobTimeout time.Duration
}
```

`RunOnce` claims, creates a child context, starts a heartbeat, processes, waits for heartbeat exit, and then performs exactly one token-guarded retry or transition. When persistence reaches its final attempt, it calls `QueueCompensation` and returns; a later `refund_pending` claim performs refund plus idempotency failure, then marks `refunded` or `failed`. Compensation errors use `ScheduleCompensationRetry`. `context.Canceled` and `ErrJobLeaseLost` cause no compensation. `Run` loops with a cancellable timer.

- [ ] **Step 6: Run processor and worker tests and verify GREEN**

Run: `cd backend/go-gateway; go test ./internal/orchestrator -count=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add backend/go-gateway/internal/orchestrator/image_job_processor.go backend/go-gateway/internal/orchestrator/image_job_processor_test.go backend/go-gateway/internal/orchestrator/image_job_worker.go backend/go-gateway/internal/orchestrator/image_job_worker_test.go backend/go-gateway/internal/orchestrator/types.go
git commit -m "feat(go-gateway): recover persistent image jobs"
```

### Task 7: Wire Worker Configuration and Graceful Shutdown

**Files:**
- Modify: `backend/go-gateway/internal/handler/image.go`
- Modify: `backend/go-gateway/internal/handler/image_test.go`
- Modify: `backend/go-gateway/internal/config/config.go`
- Modify: `backend/go-gateway/internal/config/config_test.go`
- Modify: `backend/go-gateway/cmd/server/main.go`
- Modify: `scripts/start-render-backend.sh`

- [ ] **Step 1: Write failing config and handler wiring tests**

Test default worker enabled, positive timing defaults, environment overrides, and that the handler configures enqueue/processor dependencies without starting a goroutine.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd backend/go-gateway; go test ./internal/config ./internal/handler -count=1`

Expected: FAIL because worker configuration and handler factory methods do not exist.

- [ ] **Step 3: Implement configuration and handler factory**

Add environment-backed values:

```go
ImageJobWorkerEnabled
ImageJobPollInterval
ImageJobLeaseDuration
ImageJobHeartbeatInterval
ImageJobTimeout
ImageJobMaxAttempts
```

Add a handler method that configures the orchestrator and returns a worker; it must not launch one.

- [ ] **Step 4: Refactor main lifecycle**

Use `signal.NotifyContext`, create `ImageGenerationJobRepository`, configure the handler, start one worker under a `WaitGroup`, cancel workers before HTTP shutdown, wait for exit, and avoid `log.Fatalf` inside goroutines.

Update `scripts/start-render-backend.sh` so TERM is forwarded to both Node and Go children and the script waits for them before exiting.

- [ ] **Step 5: Run focused tests and builds**

Run:

```powershell
cd backend/go-gateway
go test ./internal/config ./internal/handler ./internal/orchestrator -count=1
$env:CGO_ENABLED='0'; go build ./cmd/server/...
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/go-gateway/internal/handler/image.go backend/go-gateway/internal/handler/image_test.go backend/go-gateway/internal/config/config.go backend/go-gateway/internal/config/config_test.go backend/go-gateway/cmd/server/main.go scripts/start-render-backend.sh
git commit -m "feat(go-gateway): run image job worker gracefully"
```

### Task 8: Update Rollout Documentation and Verify Item 5

**Files:**
- Modify: `docs/optimization-plan-1-3-4-5-6.md`

- [ ] **Step 1: Run formatting and focused suites**

Run:

```powershell
gofmt -w backend/go-gateway/internal/repository/image_generation_job.go backend/go-gateway/internal/repository/image_generation_job_test.go backend/go-gateway/internal/service/storage.go backend/go-gateway/internal/service/storage_job_test.go backend/go-gateway/internal/service/idempotency.go backend/go-gateway/internal/repository/idempotency.go backend/go-gateway/internal/repository/idempotency_job_test.go backend/go-gateway/internal/orchestrator/types.go backend/go-gateway/internal/orchestrator/image_generate.go backend/go-gateway/internal/orchestrator/image_generate_test.go backend/go-gateway/internal/orchestrator/image_job_processor.go backend/go-gateway/internal/orchestrator/image_job_processor_test.go backend/go-gateway/internal/orchestrator/image_job_worker.go backend/go-gateway/internal/orchestrator/image_job_worker_test.go backend/go-gateway/internal/handler/image.go backend/go-gateway/internal/handler/image_test.go backend/go-gateway/internal/config/config.go backend/go-gateway/internal/config/config_test.go backend/go-gateway/cmd/server/main.go
npm test -- tests/image-generation-jobs-migration.test.ts
cd backend/go-gateway
go test ./... -count=1
$env:CGO_ENABLED='0'; go build ./cmd/server/...
```

Expected: migration contract PASS, all Go tests PASS, server build PASS.

- [ ] **Step 2: Run repository-wide regression checks**

Run:

```powershell
cd D:\Desktop\Web\recho-ai
npm run test:contracts
cd backend/gateway
npm run typecheck
npm run build
cd ..\..
npm run build
npm test
```

Expected: contract, Node typecheck/build, root build pass. Root Vitest may retain only the already-known unrelated `tests/admin-images.test.ts` failure; do not modify it in this item.

- [ ] **Step 3: Record implementation evidence**

Update item 5 in `docs/optimization-plan-1-3-4-5-6.md` with the migration path, state model, staging guarantee, lease fencing, worker lifecycle, test commands, and the local Supabase Docker limitation.

- [ ] **Step 4: Check protected workspace state**

Run: `git status --short`

Expected: no changes to `.playwright-mcp/`, `.trae/`, `recho-login-redesign/`, `recho-image-sidebar-after-authenticated-image.png`, or the existing CORS stash.

- [ ] **Step 5: Commit**

```powershell
git add docs/optimization-plan-1-3-4-5-6.md
git commit -m "docs: track persistent image job rollout"
```

## Plan Self-Review

- Spec coverage: provisional staging, no Provider payloads in JSONB, fencing, renewal, resumable phases, durable compensation, idempotency confirmation, RLS, lifecycle, and verification each map to a task.
- Placeholder scan: no deferred implementation placeholders remain.
- Type consistency: repository methods use `leaseToken`; orchestrator manifest phases are `awaiting_stage`, `staged`, `stored`, and `history_saved`; job statuses match the migration.
- Environment constraint: local Supabase execution is unavailable because Docker Desktop is not running, so the plan includes a static SQL contract and requires preview/local database application before merge.
