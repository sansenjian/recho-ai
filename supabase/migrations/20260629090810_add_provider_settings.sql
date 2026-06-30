create table if not exists public.provider_settings (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('chat', 'image')),
  name text not null,
  base_url text not null,
  api_key_encrypted text,
  api_key_preview text,
  default_model text,
  image_model text,
  edit_model text,
  enabled boolean not null default false,
  priority integer not null default 100,
  timeout_ms integer not null default 360000,
  retry_count integer not null default 3,
  supports_webp_references boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint provider_settings_name_check check (length(trim(name)) between 1 and 80),
  constraint provider_settings_base_url_check check (base_url ~* '^https?://'),
  constraint provider_settings_priority_check check (priority >= 0 and priority <= 10000),
  constraint provider_settings_timeout_check check (timeout_ms >= 1000 and timeout_ms <= 1200000),
  constraint provider_settings_retry_check check (retry_count >= 0 and retry_count <= 10)
);

create index if not exists provider_settings_kind_enabled_priority_idx
  on public.provider_settings (kind, enabled, priority, updated_at desc);

alter table public.provider_settings enable row level security;

revoke all on table public.provider_settings from anon, authenticated, public;
grant select, insert, update, delete on table public.provider_settings to service_role;

drop policy if exists "Service role manages provider settings" on public.provider_settings;
create policy "Service role manages provider settings"
  on public.provider_settings
  for all
  to service_role
  using (true)
  with check (true);

insert into public.provider_settings (
  kind,
  name,
  base_url,
  api_key_encrypted,
  api_key_preview,
  default_model,
  image_model,
  edit_model,
  enabled,
  priority,
  timeout_ms,
  retry_count,
  supports_webp_references,
  notes
)
values
  (
    'image',
    'Env image provider',
    coalesce(nullif(current_setting('app.image_gen_base_url', true), ''), 'https://lucen.plus/v1'),
    null,
    null,
    null,
    'gpt-image-2',
    'gpt-image-2',
    false,
    100,
    360000,
    3,
    true,
    'Fallback row for admin-managed image provider configuration. Set API key and enable it in the admin dashboard.'
  )
on conflict do nothing;

comment on table public.provider_settings is 'Admin-managed OpenAI-compatible provider settings. API keys are application-encrypted and never returned to public clients.';
comment on column public.provider_settings.api_key_encrypted is 'AES-256-GCM encrypted provider API key. Decryption requires PROVIDER_API_KEY_MASTER_KEY in the gateway runtime.';
comment on column public.provider_settings.api_key_preview is 'Non-secret masked key preview shown in the admin dashboard.';
