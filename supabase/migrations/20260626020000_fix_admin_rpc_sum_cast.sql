-- Fix admin_image_storage_overview RPC: sum(bigint) returns numeric, but the
-- function declares total_bytes as bigint. Add explicit ::bigint cast.
-- Error was: 42804 — Returned type numeric does not match expected type bigint in column 3.

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
      sum(public.parse_size_to_bytes(size))::bigint as total_bytes,
      sum(coalesce(credit_cost::numeric, 0)) as total_credit_cost
    from public.image_generations
    group by 1;
end;
$$;

comment on function public.admin_image_storage_overview() is
  'Returns per-location image storage aggregates (image count, total bytes, total credit cost) for the admin dashboard storage overview.';
