alter table public.provider_settings
  add column if not exists model_catalog jsonb not null default '[]'::jsonb;

comment on column public.provider_settings.model_catalog is
  'Provider model entries with id, display name, and enabled state. models remains as a legacy ID-only fallback.';
