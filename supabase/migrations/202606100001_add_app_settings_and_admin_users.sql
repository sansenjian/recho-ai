create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint app_settings_key_check check (
    key in (
      'image_credit_cost_per_image',
      'image_analytics_enabled',
      'image_responses_model',
      'image_responses_image_model',
      'image_events_enabled',
      'canvas_context_enabled'
    )
  )
);

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  enabled boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint admin_users_identity_check check (user_id is not null or email is not null),
  constraint admin_users_email_normalized_check check (email is null or email = lower(trim(email)))
);

create unique index if not exists admin_users_user_id_unique
  on public.admin_users (user_id)
  where user_id is not null;

create unique index if not exists admin_users_email_unique
  on public.admin_users (lower(email))
  where email is not null;

create index if not exists admin_users_enabled_idx
  on public.admin_users (enabled, updated_at desc);

alter table public.app_settings enable row level security;
alter table public.admin_users enable row level security;

revoke all on table public.app_settings from anon, authenticated, public;
revoke all on table public.admin_users from anon, authenticated, public;

grant select, insert, update, delete on table public.app_settings to service_role;
grant select, insert, update, delete on table public.admin_users to service_role;

drop policy if exists "Service role manages app settings" on public.app_settings;
create policy "Service role manages app settings"
  on public.app_settings
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages admin users" on public.admin_users;
create policy "Service role manages admin users"
  on public.admin_users
  for all
  to service_role
  using (true)
  with check (true);

insert into public.app_settings (key, value, description)
values
  ('image_credit_cost_per_image', '1'::jsonb, 'Credits charged for each credit-funded generated image.'),
  ('image_analytics_enabled', 'false'::jsonb, 'Server-side image event and canvas context recording switch.'),
  ('image_responses_model', '"gpt-image-2"'::jsonb, 'Responses text/model setting kept for image workflow compatibility.'),
  ('image_responses_image_model', '"gpt-image-2"'::jsonb, 'Images API model used by the gateway image generation route.'),
  ('image_events_enabled', 'false'::jsonb, 'Frontend runtime switch for sending image interaction events.'),
  ('canvas_context_enabled', 'false'::jsonb, 'Frontend runtime switch for sending compact canvas generation context.')
on conflict (key) do nothing;

comment on table public.app_settings is 'Gateway-managed runtime application settings. Client apps read sanitized values through the gateway.';
comment on table public.admin_users is 'Gateway-managed administrator allowlist. Env admin settings remain a bootstrap fallback.';
