alter table public.provider_settings
  add column if not exists api_key_encrypted text,
  add column if not exists api_key_preview text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'provider_settings'
      and column_name = 'api_key'
  ) then
    update public.provider_settings
    set api_key = null
    where api_key is not null;

    alter table public.provider_settings
      drop column api_key;
  end if;
end $$;

comment on column public.provider_settings.api_key_encrypted is 'AES-256-GCM encrypted provider API key. Decryption requires PROVIDER_API_KEY_MASTER_KEY in the gateway runtime.';
comment on column public.provider_settings.api_key_preview is 'Non-secret masked key preview shown in the admin dashboard.';
