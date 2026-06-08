alter table public.image_generations
  add column if not exists generation_batch_id text;

alter table public.image_generations
  alter column data_url drop not null;

create index if not exists image_generations_batch_generated_at_idx
  on public.image_generations (generation_batch_id, generated_at desc)
  where generation_batch_id is not null;

comment on column public.image_generations.generation_batch_id is
  'Groups image rows created by one generation request. Reference images for the batch can be stored once and reused by each generated image row.';

comment on column public.image_generations.data_url is
  'Legacy inline or remote original image URL. New writes should prefer storage_path and may leave this null.';

comment on column public.image_generations.reference_images is
  'Reference image metadata. New writes store Supabase Storage paths and omit inline image payloads when storage is available.';
