create index if not exists image_generations_user_visibility_generated_at_idx
  on public.image_generations (user_id, visibility, generated_at desc);

create index if not exists image_generations_funding_source_generated_at_idx
  on public.image_generations (funding_source, generated_at desc);

create index if not exists image_generations_reference_count_idx
  on public.image_generations (reference_count);

create index if not exists image_events_user_created_at_idx
  on public.image_events (user_id, created_at desc)
  where user_id is not null;

comment on index public.image_generations_user_visibility_generated_at_idx is
  'Supports authenticated image history filters by owner, visibility, and newest first.';

comment on index public.image_generations_funding_source_generated_at_idx is
  'Supports credit/free image generation reporting and admin filters.';

comment on index public.image_generations_reference_count_idx is
  'Supports reports and filters by number of reference images.';

comment on index public.image_events_user_created_at_idx is
  'Supports per-user image behavior funnels ordered by recent activity.';
