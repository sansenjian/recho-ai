-- Parse human-readable size string to bytes (matches TypeScript parseSizeToBytes)
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
    when unit in ('kb', 'kbytes') then return round(numeric_val * 1024);
    when unit in ('mb') then return round(numeric_val * 1024 * 1024);
    when unit in ('gb') then return round(numeric_val * 1024 * 1024 * 1024);
    else return round(numeric_val);
  end case;
end;
$$;

comment on function public.parse_size_to_bytes(size_str text) is
  'Parses a human-readable size string (e.g. "2.5 MB") to a byte count for storage statistics.';

-- Aggregate image storage stats by storage location for admin dashboard
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

create index if not exists image_generations_storage_path_idx
  on public.image_generations (storage_path);

comment on index public.image_generations_storage_path_idx is
  'Supports admin_image_storage_overview RPC for storage path grouping.';
