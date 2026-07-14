alter table public.provider_settings
  add column if not exists image_compatibility_mode text not null default 'auto';

alter table public.provider_settings
  drop constraint if exists provider_settings_image_compatibility_mode_check;

alter table public.provider_settings
  add constraint provider_settings_image_compatibility_mode_check
  check (image_compatibility_mode in ('auto', 'openai', 'lucen'));

comment on column public.provider_settings.image_compatibility_mode is
  'Image API request compatibility preset: auto detects by Base URL, openai preserves standard controls, lucen uses minimal concurrent requests.';
