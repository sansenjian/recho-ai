-- Fix: consolidate individual ::bigint casts into a single expression-level cast
-- The previous version (20260626000000) worked due to PL/pgSQL implicit conversion,
-- but this version is cleaner and avoids any edge case with round() returning numeric.

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
  return (case
    when unit in ('kb', 'kbytes') then round(numeric_val * 1024)
    when unit in ('mb') then round(numeric_val * 1024 * 1024)
    when unit in ('gb') then round(numeric_val * 1024 * 1024 * 1024)
    else round(numeric_val)
  end)::bigint;
end;
$$;

comment on function public.parse_size_to_bytes(size_str text) is
  'Parses a human-readable size string (e.g. "2.5 MB") to a byte count for storage statistics.';