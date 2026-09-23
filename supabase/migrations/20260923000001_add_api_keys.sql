-- 外部客户端 API Key(如 recho-cli):长期有效,rk- 前缀,绑定到用户,复用其 credits 与权限
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  key_hash text not null,
  key_hint text not null,
  enabled boolean not null default true,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_keys_key_hash_unique unique (key_hash)
);

create index if not exists api_keys_user_id_idx on public.api_keys (user_id);
create index if not exists api_keys_created_at_idx on public.api_keys (created_at desc);

-- 仅 service_role(网关 admin client)可读写;外部客户端不直接接触此表
alter table public.api_keys enable row level security;