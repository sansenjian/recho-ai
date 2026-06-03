alter table public.image_generations
  add column if not exists thumbnail_url text,
  add column if not exists thumbnail_path text;

comment on column public.image_generations.thumbnail_url is 'Public URL of the generated image thumbnail.';
comment on column public.image_generations.thumbnail_path is 'Path of the generated image thumbnail object in Supabase Storage.';
