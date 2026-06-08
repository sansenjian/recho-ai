alter table public.image_generations
  add column if not exists reference_count integer not null default 0;

update public.image_generations
   set reference_count = coalesce(jsonb_array_length(reference_images), 0)
 where reference_count = 0
   and reference_images is not null;

alter table public.image_generations
  drop constraint if exists image_generations_reference_count_check,
  add constraint image_generations_reference_count_check
    check (reference_count >= 0);

comment on column public.image_generations.reference_count is
  'Number of reference images captured for a generation. Used by lightweight public gallery list queries.';
