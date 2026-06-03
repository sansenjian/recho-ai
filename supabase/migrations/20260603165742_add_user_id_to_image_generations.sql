alter table public.image_generations
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists image_generations_user_generated_at_idx
  on public.image_generations (user_id, generated_at desc);

comment on column public.image_generations.user_id is 'Supabase Auth user id attached to the generation when available.';
