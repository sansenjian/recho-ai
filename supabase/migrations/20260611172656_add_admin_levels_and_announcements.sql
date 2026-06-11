alter table public.admin_users
  add column if not exists role text not null default 'operator';

alter table public.admin_users
  drop constraint if exists admin_users_role_check,
  add constraint admin_users_role_check
    check (role in ('operator'));

comment on column public.admin_users.role
  is 'Database-managed admins are ordinary operators. Senior admins are bootstrapped from ADMIN_USER_IDS or ADMIN_USER_EMAILS env vars.';

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  status text not null default 'published',
  created_by uuid,
  updated_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_length_check
    check (char_length(trim(title)) between 1 and 120),
  constraint announcements_body_length_check
    check (char_length(trim(body)) between 1 and 4000),
  constraint announcements_status_check
    check (status in ('draft', 'published', 'archived'))
);

create index if not exists announcements_status_updated_at_idx
  on public.announcements (status, updated_at desc);

alter table public.announcements enable row level security;

revoke all on table public.announcements from anon, authenticated, public;
grant select, insert, update, delete on table public.announcements to service_role;

drop policy if exists "Service role manages announcements" on public.announcements;
create policy "Service role manages announcements"
  on public.announcements
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.announcements is 'Gateway-managed announcements published from the admin console.';
