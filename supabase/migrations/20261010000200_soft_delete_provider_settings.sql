-- Provider 软删除。
--
-- 直接 delete 会让「谁在什么时候删了哪个 Provider」彻底消失，误删也无法恢复；
-- 而 provider_settings 里存着加密后的密钥，重建成本高。这里改为标记删除：
-- 行保留、列表与生图链路都按 deleted_at is null 过滤，出问题可以整行还原。
--
-- 同名 Provider 允许重建：唯一性只约束未删除的行，所以索引必须是部分索引。

alter table public.provider_settings
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

-- 查询与排序都带 deleted_at is null，索引跟着带上这个条件，未删除的行才会走索引。
drop index if exists public.provider_settings_kind_enabled_priority_idx;
create index if not exists provider_settings_active_kind_enabled_priority_idx
  on public.provider_settings (kind, enabled, priority asc, updated_at desc)
  where deleted_at is null;

-- 已删除的行不再参与 Provider 选择，给它们单独一个索引便于审计查询。
create index if not exists provider_settings_deleted_at_idx
  on public.provider_settings (deleted_at desc)
  where deleted_at is not null;

comment on column public.provider_settings.deleted_at is
  '软删除时间；非空表示该 Provider 已下线，列表与生图链路都会忽略它。';
comment on column public.provider_settings.deleted_by is
  '执行软删除的管理员；管理员账号被删后置空。';
