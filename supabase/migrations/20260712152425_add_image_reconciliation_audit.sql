create table if not exists public.image_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stale_jobs integer not null default 0,
  orphan_objects integer not null default 0,
  deleted_objects integer not null default 0,
  error_detail text,
  created_at timestamptz not null default now(),
  constraint image_reconciliation_runs_status_check check (status in ('running', 'completed', 'failed')),
  constraint image_reconciliation_runs_counts_check check (
    stale_jobs >= 0 and orphan_objects >= 0 and deleted_objects >= 0
  )
);

create table if not exists public.image_reconciliation_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.image_reconciliation_runs(id) on delete cascade,
  kind text not null,
  subject text not null,
  status text,
  detail text,
  created_at timestamptz not null default now(),
  unique (run_id, kind, subject)
);

create index if not exists image_reconciliation_runs_created_at_idx
  on public.image_reconciliation_runs (created_at desc);

create index if not exists image_reconciliation_findings_run_id_idx
  on public.image_reconciliation_findings (run_id, created_at desc);

alter table public.image_reconciliation_runs enable row level security;
alter table public.image_reconciliation_runs force row level security;
alter table public.image_reconciliation_findings enable row level security;
alter table public.image_reconciliation_findings force row level security;

revoke all on table public.image_reconciliation_runs from public, anon, authenticated;
revoke all on table public.image_reconciliation_findings from public, anon, authenticated;
grant select, insert, update on table public.image_reconciliation_runs to service_role;
grant select, insert on table public.image_reconciliation_findings to service_role;

comment on table public.image_reconciliation_runs is
  'Service-role audit log for durable image job and object-store reconciliation runs.';
comment on table public.image_reconciliation_findings is
  'Idempotent findings recorded during image reconciliation; no public API access.';
