-- Restore RPC functions dropped by remote-schema sync (20260615153744_remote-schema.sql)

-- 1. Helper: parse human-readable size string to bytes
--    Matches TypeScript parseSizeToBytes in admin-images.ts
create or replace function public.parse_size_to_bytes(size_str text)
returns bigint
language plpgsql immutable
as $$
declare
  matches text[];
  numeric_val numeric;
  unit text;
begin
  if size_str is null then return 0; end if;
  matches := regexp_matches(trim(size_str), '^(\d+(?:\.\d+)?)\s*(KB|MB|GB|bytes|KBytes|Bytes)?$', 'i');
  if matches is null or array_length(matches, 1) < 1 then return 0; end if;
  numeric_val := matches[1]::numeric;
  unit := lower(matches[2] || '');
  case
    when unit in ('kb', 'kbytes') then return round(numeric_val * 1024)::bigint;
    when unit in ('mb') then return round(numeric_val * 1024 * 1024)::bigint;
    when unit in ('gb') then return round(numeric_val * 1024 * 1024 * 1024)::bigint;
    else return round(numeric_val)::bigint;
  end case;
end;
$$;

comment on function public.parse_size_to_bytes(size_str text) is
  'Parses a human-readable size string (e.g. "2.5 MB") to a byte count for storage statistics.';

-- 2. Aggregate image storage stats by storage location for admin dashboard
create or replace function public.admin_image_storage_overview()
returns table (
  location text,
  image_count bigint,
  total_bytes bigint,
  total_credit_cost numeric
)
language plpgsql stable
as $$
begin
  return query
    select
      case
        when storage_path is null then 'supabase'
        when storage_path like 'cos://%' then 'cos'
        when storage_path like 'data:%' then 'data'
        else 'supabase'
      end as location,
      count(*) as image_count,
      sum(public.parse_size_to_bytes(size)) as total_bytes,
      sum(coalesce(credit_cost::numeric, 0)) as total_credit_cost
    from public.image_generations
    group by 1;
end;
$$;

comment on function public.admin_image_storage_overview() is
  'Returns per-location image storage aggregates (image count, total bytes, total credit cost) for the admin dashboard storage overview.';

-- 3. Aggregate user generation stats by user_id for admin dashboard
create or replace function public.admin_user_generation_stats(p_user_ids uuid[], p_since timestamptz)
returns table (
  user_id uuid,
  total bigint,
  succeeded bigint,
  failed bigint
)
language plpgsql stable
as $$
begin
  return query
    select
      atts.user_id,
      count(*) as total,
      count(*) filter (where atts.status = 'succeeded') as succeeded,
      count(*) filter (where atts.status = 'failed') as failed
    from public.image_generation_attempts atts
    where atts.user_id = any(p_user_ids)
      and atts.created_at >= p_since
    group by atts.user_id;
end;
$$;

comment on function public.admin_user_generation_stats(p_user_ids uuid[], p_since timestamptz) is
  'Returns per-user image generation attempt counts (total, succeeded, failed) within a date window for the admin dashboard.';

-- Restore supporting indexes dropped by remote-schema sync

create index if not exists image_generations_storage_path_idx
  on public.image_generations (storage_path);

comment on index public.image_generations_storage_path_idx is
  'Supports admin_image_storage_overview RPC for storage path grouping.';

create index if not exists image_generation_attempts_user_id_created_at_status_idx
  on public.image_generation_attempts (user_id, created_at desc, status);

comment on index public.image_generation_attempts_user_id_created_at_status_idx is
  'Supports the admin_user_generation_stats RPC function for efficient per-user generation stats aggregation.';