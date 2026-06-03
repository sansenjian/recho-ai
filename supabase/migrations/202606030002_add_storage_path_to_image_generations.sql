alter table public.image_generations
  add column if not exists storage_path text;

comment on column public.image_generations.storage_path is 'Path of the generated image object in Supabase Storage.';
