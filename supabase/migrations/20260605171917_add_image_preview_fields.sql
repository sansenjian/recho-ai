alter table public.image_generations
  add column if not exists preview_url text,
  add column if not exists preview_path text;

comment on column public.image_generations.preview_url is 'Public URL of the full-size WebP preview for viewing.';
comment on column public.image_generations.preview_path is 'Path of the full-size WebP preview object in Supabase Storage.';
