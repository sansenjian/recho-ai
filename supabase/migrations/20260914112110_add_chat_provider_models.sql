alter table public.provider_settings
  add column if not exists models text[] not null default '{}';

comment on column public.provider_settings.models is
  'Chat provider model identifiers. default_model remains for backwards compatibility.';
