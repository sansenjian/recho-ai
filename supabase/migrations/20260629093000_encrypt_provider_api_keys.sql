alter table public.provider_settings
  add column if not exists api_key_encrypted text,
  add column if not exists api_key_preview text;

comment on column public.provider_settings.api_key_encrypted is 'AES-256-GCM encrypted provider API key. Decryption requires PROVIDER_API_KEY_MASTER_KEY in the gateway runtime.';
comment on column public.provider_settings.api_key_preview is 'Non-secret masked key preview shown in the admin dashboard.';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'provider_settings'
      and column_name = 'api_key'
  ) then
    execute 'comment on column public.provider_settings.api_key is ''Legacy plaintext API key kept temporarily until application encryption backfill is verified. Remove in a separate follow-up migration after api_key_encrypted is populated.''';
  end if;
end $$;
