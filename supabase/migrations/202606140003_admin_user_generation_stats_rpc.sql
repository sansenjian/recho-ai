-- Aggregate user generation stats by user_id for the last 30 days
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

create index if not exists image_generation_attempts_user_id_created_at_status_idx
  on public.image_generation_attempts (user_id, created_at desc, status);

comment on index public.image_generation_attempts_user_id_created_at_status_idx is
  'Supports the admin_user_generation_stats RPC function for efficient per-user generation stats aggregation.';
