create table if not exists public.image_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  generation_batch_id text not null unique,
  request_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  idempotency_key text,
  request_hash text,
  status text not null default 'staging',
  credit_transaction_id uuid references public.credit_transactions(id) on delete set null,
  reserved_amount numeric(12, 2) not null default 0,
  refunded_amount numeric(12, 2) not null default 0,
  requested_count integer not null,
  returned_count integer not null default 0,
  result_manifest jsonb not null default '{}'::jsonb,
  response_body jsonb,
  retry_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_by text,
  lease_token uuid,
  locked_until timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint image_generation_jobs_idempotency_pair_check check (
    (idempotency_key is null) = (request_hash is null)
  ),
  constraint image_generation_jobs_request_hash_check check (
    request_hash is null or request_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint image_generation_jobs_status_check check (
    status in (
      'staging',
      'persistence_pending',
      'persistence_processing',
      'completed',
      'failed',
      'refund_pending',
      'refunded'
    )
  ),
  constraint image_generation_jobs_reserved_amount_check check (
    reserved_amount >= 0
  ),
  constraint image_generation_jobs_refunded_amount_check check (
    refunded_amount >= 0
  ),
  constraint image_generation_jobs_refund_limit_check check (
    refunded_amount <= reserved_amount
  ),
  constraint image_generation_jobs_requested_count_check check (
    requested_count > 0
  ),
  constraint image_generation_jobs_returned_count_nonnegative_check check (
    returned_count >= 0
  ),
  constraint image_generation_jobs_returned_count_limit_check check (
    returned_count <= requested_count
  ),
  constraint image_generation_jobs_result_manifest_object_check check (
    jsonb_typeof(result_manifest) = 'object'
  ),
  constraint image_generation_jobs_response_body_object_check check (
    response_body is null or jsonb_typeof(response_body) = 'object'
  ),
  constraint image_generation_jobs_retry_count_check check (
    retry_count >= 0
  ),
  constraint image_generation_jobs_max_attempts_check check (
    max_attempts > 0
  ),
  constraint image_generation_jobs_lease_tuple_check check (
    num_nonnulls(locked_by, lease_token, locked_until) in (0, 3)
  )
);

create index if not exists image_generation_jobs_ready_claim_idx
  on public.image_generation_jobs (next_attempt_at, created_at)
  where status in ('persistence_pending', 'refund_pending');

create index if not exists image_generation_jobs_expired_lease_idx
  on public.image_generation_jobs (locked_until, created_at)
  where status in ('staging', 'persistence_processing');

create index if not exists image_generation_jobs_user_created_at_idx
  on public.image_generation_jobs (user_id, created_at desc)
  where user_id is not null;

create index if not exists image_generation_jobs_credit_transaction_idx
  on public.image_generation_jobs (credit_transaction_id)
  where credit_transaction_id is not null;

create unique index if not exists image_generation_jobs_active_idempotency_idx
  on public.image_generation_jobs (user_id, idempotency_key)
  where idempotency_key is not null
    and status in (
      'staging',
      'persistence_pending',
      'persistence_processing',
      'completed',
      'refund_pending'
    );

alter table public.image_generation_jobs enable row level security;
alter table public.image_generation_jobs force row level security;

revoke all on table public.image_generation_jobs from public, anon, authenticated;
grant select, insert, update on table public.image_generation_jobs to service_role;

comment on table public.image_generation_jobs is
  'Durable image-generation workflow state; result manifests contain storage references, not provider URLs or base64 payloads.';
