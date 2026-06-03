create table if not exists public.image_generations (
  id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  data_url text not null,
  storage_path text,
  thumbnail_url text,
  thumbnail_path text,
  prompt text not null default '',
  revised_prompt text,
  size text not null default 'auto',
  aspect_ratio text,
  resolution text,
  quality text,
  reference_images jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.image_generations enable row level security;

grant select, insert, update, delete on table public.image_generations to service_role;

create index if not exists image_generations_generated_at_idx
  on public.image_generations (generated_at desc);

create index if not exists image_generations_user_generated_at_idx
  on public.image_generations (user_id, generated_at desc);

comment on table public.image_generations is 'Generated image records shown in the Recho image gallery.';
comment on column public.image_generations.user_id is 'Supabase Auth user id attached to the generation when available.';
comment on column public.image_generations.reference_images is 'Reference image metadata and data URLs captured at generation time.';
