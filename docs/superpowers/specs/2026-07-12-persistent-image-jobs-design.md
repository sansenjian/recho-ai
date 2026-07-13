# Persistent Image Jobs Design

> Status: approved for item 5 of `docs/optimization-plan-1-3-4-5-6.md`.

## Goal

Replace the image pipeline's goroutine-only persistence phase with a durable PostgreSQL job and a recoverable Go worker, while preserving the current HTTP request and response shape.

## Boundary

This design makes the post-Provider staging, persistence, history, idempotency completion, and terminal refund work recoverable. It does not yet combine idempotency acquisition, job creation, and credit reservation into one database transaction; that is item 1. It also does not add reconciliation or admin UI.

## Selected Architecture

PostgreSQL is the business job source of truth. Provider URLs and Base64 payloads remain request-local and are synchronously copied to staging objects. PostgreSQL stores only compact metadata, staging object references, checksums, progress, credit linkage, and the final permanent response.

A provisional `staging` job is inserted before the first staging upload. This closes the previous upload-before-enqueue crash gap: if the request process exits during staging, a worker can claim the expired staging lease, clean known objects, fail idempotency, and persist a refund outcome.

External Provider, download, image processing, and object-storage calls never run inside a database transaction or while a row lock is held.

## State Model

```text
staging -----------------------------> persistence_pending
   |                                           |
   | expired request lease                     | worker claim
   v                                           v
refund_pending <-------------------- persistence_processing
   |                                           |
   | retry refund                              +--> persistence_pending (retry)
   v                                           +--> completed
refunded                                       +--> failed
                                               +--> refund_pending
```

`staging` is owned by the request until all Provider images have durable staging references. `persistence_processing` is owned by a worker. `refund_pending` remains claimable until compensation succeeds. A canceled process does not mark work failed; its lease expires and another process recovers it.

## Database Model

`public.image_generation_jobs` contains:

- `id uuid primary key default gen_random_uuid()`
- `generation_batch_id text not null unique`
- `request_id text not null`
- nullable `user_id uuid references auth.users(id) on delete set null`
- nullable `idempotency_key text` and `request_hash text`
- `status text not null`
- nullable `credit_transaction_id uuid references public.credit_transactions(id) on delete set null`
- `reserved_amount numeric(12,2) not null default 0`
- `refunded_amount numeric(12,2) not null default 0`
- `requested_count integer not null` and `returned_count integer not null`
- `result_manifest jsonb not null`
- nullable `response_body jsonb`, written only with permanent results
- `retry_count integer not null default 0` and `max_attempts integer not null default 5`
- `next_attempt_at timestamptz not null default now()`
- nullable `locked_by text`, `lease_token uuid`, and `locked_until timestamptz`
- nullable `last_error_code text` and `last_error_detail text`
- `created_at`, `updated_at`, and nullable `completed_at`

Constraints enforce the state set, non-negative amounts, `refunded_amount <= reserved_amount`, valid counts, JSON objects, paired idempotency fields, a lowercase 64-character SHA-256 request hash, and an all-null or all-present lease tuple.

Indexes are:

- a partial claim index on `(next_attempt_at, created_at)` for `persistence_pending` and `refund_pending`
- a partial lease recovery index on `(locked_until, created_at)` for `staging` and `persistence_processing`
- a partial user/time index on `(user_id, created_at desc)`
- a partial credit transaction index
- a partial unique active-idempotency index on `(user_id, idempotency_key)` for non-terminal jobs

Time comparisons stay in the claim query. Partial-index predicates do not use `now()`, because PostgreSQL index predicates require immutable expressions.

The table is in `public`, so RLS is enabled and forced. `public`, `anon`, and `authenticated` receive no privileges. `service_role` receives only `select`, `insert`, and `update`; no browser policy and no `delete` privilege are created. The direct pgx connection remains the runtime access path, so deployment verification must confirm its database role can access the table.

## Durable Manifest

The manifest is versioned and contains no Provider URL, Provider Base64, data URL, or staging public URL:

```json
{
  "version": 1,
  "metadata": {
    "creditCost": 0.5,
    "totalCost": 1,
    "creditBalance": 9
  },
  "images": [
    {
      "result": {
        "id": "img_...",
        "persistenceStatus": "processing"
      },
      "stagedPath": "staging/image-jobs/batch_.../img_....source",
      "stagedMime": "image/png",
      "stagedBytes": 1234,
      "stagedSha256": "...",
      "phase": "staged"
    }
  ]
}
```

Allowed per-image phases are `awaiting_stage`, `staged`, `stored`, and `history_saved`. When an image reaches `stored`, `result` contains only permanent object paths and URLs; `TemporaryURL` and `DataURL` are empty. The worker persists the manifest after each phase transition.

Final object paths are deterministic from the image ID, and image history uses a full `ON CONFLICT (id) DO UPDATE`, so repeating an interrupted phase is safe.

## Request Flow

1. Existing idempotency acquisition, credit reservation, Provider call, and partial refund behavior runs.
2. The orchestrator prepares stable batch/image IDs and a scrubbed manifest with `awaiting_stage` entries.
3. It creates a `staging` job with a request-owned `lease_token` before uploading any source bytes.
4. Each Provider URL is downloaded with a strict size limit, and each Base64 payload is decoded. Raw bytes are uploaded to a deterministic staging path.
5. After each upload, the manifest records path, MIME, byte count, checksum, and `staged` phase through a lease-token-guarded update that also renews the staging lease.
6. After every image is staged, the request atomically transitions the job from `staging` to `persistence_pending` and clears the lease.
7. Only after that transition succeeds does `Generate` return the existing temporary response.

If provisional job creation fails, the request uses the existing immediate refund/fail path. If staging or activation fails after job creation, the request transitions the durable job into compensation instead of reporting success.

## Claiming, Leases, and Fencing

Workers claim one eligible row with one `UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING` statement. The candidate set includes ready `persistence_pending` and `refund_pending` rows plus expired `staging` and `persistence_processing` rows.

Every claim receives a new random `lease_token`. Manifest writes, lease renewal, retry release, and terminal transitions use all of:

```sql
where id = $job_id
  and status = $expected_status
  and locked_by = $worker_id
  and lease_token = $lease_token
```

`lease_token` is the fencing token. `locked_until` alone is not sufficient because an expired worker could otherwise overwrite a newly claimed job. A heartbeat renews the lease while external work runs. Losing the lease cancels the processing context and the stale worker performs no cleanup, refund, or terminal transition.

## Worker Flow

`RunOnce` claims one job and makes tests deterministic. `Run` only performs cancellable polling.

For `staging` with an expired request lease, the worker treats the request as abandoned and runs terminal compensation from the manifest.

For `persistence_processing`, each image resumes from its persisted phase:

1. `staged`: download and checksum the staged bytes, process/upload deterministic final variants, scrub temporary fields, then persist `stored`.
2. `stored`: upsert the complete image history row, then persist `history_saved`.
3. `history_saved`: skip.

After every image reaches `history_saved`, the worker builds a permanent `GenResponse`, calls idempotency `Complete`, and only then marks the job `completed` with `response_body`. Staging cleanup occurs after the terminal transition, so a stale worker cannot delete input needed by a replacement worker.

## Retry and Terminal Compensation

Transient persistence errors release the job to `persistence_pending` with exponential backoff while `retry_count < max_attempts`.

On final persistence failure, or when recovering abandoned staging, the current lease owner first performs a token-guarded transition to `refund_pending`, records the error, clears its lease, and returns. A later claim then performs compensation from that durable state:

1. Attempt the remaining full credit refund using the recorded transaction and amount.
2. Call idempotency `Fail` and require an observable error result.
3. Mark `refunded` only after both required actions succeed.
4. Mark `failed` when no credit refund is required and idempotency failure is durable.
5. Release back to `refund_pending` with backoff when refund or idempotency compensation cannot be confirmed.
6. Clean known history rows and object paths only after the terminal transition. Cleanup failures are logged for later reconciliation and do not reverse a successful refund.

Persisting `refund_pending` before the external refund call makes the compensation intent crash-safe. If a process exits after the refund RPC but before the terminal job update, the next sequential retry is harmless because the existing RPC returns without adding credit once the original transaction has been fully refunded. Item 1 still must make that check concurrency-safe.

The existing refund RPC remains the item 1 limitation: its cumulative check is not yet protected by the job transaction boundary. Item 1 will add atomic reservation/refund rules.

## Idempotency Interaction

`IdempotencyService.Complete` and `Fail` return errors instead of swallowing them. A job cannot enter a terminal success/failure state until the matching idempotency write is confirmed.

`Acquire` checks request hashes before reclaiming failed or stale records. For `image_generate`, an active matching job blocks stale reclaim. The pre-job processing timeout is increased beyond the maximum Provider timeout so a long Provider request is not duplicated before the provisional job exists.

## Storage and History Changes

`StorageService` gains strict staging operations that return errors:

- stage URL or raw bytes at a deterministic path
- download staged bytes through the existing private S3 client path
- delete an explicit object list with error propagation

The existing best-effort `CleanupObjects` remains for non-state-machine callers.

`SaveImageHistory` updates every permanent URL/path, dimension, byte count, metadata, visibility, and credit field on conflict. An internal delete-by-image-ID method supports anonymous-job compensation without casting an empty user ID to UUID.

## Go Boundaries

- `repository.ImageGenerationJobRepository` owns SQL and conditional transitions.
- `orchestrator.ImageJobEnqueuer` is the request-path subset; `orchestrator.ImageJobStore` adds claim, lease, retry, and terminal methods for the worker.
- `orchestrator.ImageJobWorker` owns polling, claim, heartbeat, retry timing, and lease handling.
- `ImageOrchestrator` owns provisional enqueue, staging, manifest processing, permanent response construction, idempotency, and terminal compensation.
- `StorageService` owns raw staging and final image operations.
- `ImageHandler` exposes job configuration/factory wiring; it does not start goroutines.

## Startup and Shutdown

The Go server uses `signal.NotifyContext` as the application context. `main` starts one worker with a unique worker ID and a `WaitGroup`. Shutdown cancels the worker first, shuts down HTTP, waits for worker exit, then closes PostgreSQL and libvips.

`context.Canceled` does not trigger retry, refund, or cleanup. The current lease remains until expiry for another process to recover. Server goroutines return errors through a channel instead of calling `log.Fatalf`, so deferred cleanup still runs.

Worker timings are injected options with environment-backed defaults. Initial concurrency is one.

## Testing

- migration contract test for table, constraints, RLS, revokes, grants, and partial indexes
- repository tests for atomic claim, token-guarded transitions, retry, and lease loss
- storage tests for strict size limits, raw staging, download, deletion, and full history upsert
- idempotency tests for returned write errors, hash conflicts, and active-job stale protection
- orchestrator tests proving response waits for provisional enqueue, all staging, and activation
- manifest tests proving Provider URL/Base64 never enters PostgreSQL JSON
- processor tests for every phase resume point and no duplicate history
- worker tests for no-job polling, retry, heartbeat, lease loss, abandoned staging, refund pending, and cancellation
- main/config tests for lifecycle options
- existing Handler, Sidecar, contract, and full Go suites

Local Supabase SQL execution requires Docker, which is not currently running in this workspace. The migration receives a static contract test now and must also be applied to a local or preview Supabase database before merge.

## Success Criteria

- A response is never returned before a durable job exists and every Provider output has a staging reference.
- Killing the Go process after the response does not lose the persistence task.
- Killing it during staging leaves a recoverable compensation job.
- Another worker can claim expired work without blocking.
- A stale worker cannot update state, clean objects, or refund after losing its fencing token.
- Reprocessing resumes from persisted phases without duplicate history.
- Provider URL and Base64 data never enter job JSONB.
- Browser roles cannot access job rows.
- Terminal persistence failure leaves an explicit durable refund/idempotency outcome.
