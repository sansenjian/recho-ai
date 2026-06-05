alter table public.image_generations
  add column if not exists provider text,
  add column if not exists image_model text,
  add column if not exists text_model text,
  add column if not exists latency_ms integer,
  add column if not exists image_width integer,
  add column if not exists image_height integer,
  add column if not exists original_bytes bigint,
  add column if not exists preview_bytes bigint,
  add column if not exists thumbnail_bytes bigint;

create table if not exists public.image_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  generation_id text references public.image_generations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  provider text,
  image_model text,
  text_model text,
  status text not null,
  latency_ms integer,
  error_type text,
  error_code text,
  error_message text,
  http_status integer,
  request_id text,
  request_ip inet,
  request_user_agent text,
  created_at timestamptz not null default now()
);

alter table public.image_generation_attempts enable row level security;

grant select, insert, update, delete on table public.image_generation_attempts to service_role;

create index if not exists image_generation_attempts_created_at_idx
  on public.image_generation_attempts (created_at desc);

create index if not exists image_generation_attempts_user_created_at_idx
  on public.image_generation_attempts (user_id, created_at desc);

create index if not exists image_generation_attempts_status_created_at_idx
  on public.image_generation_attempts (status, created_at desc);

comment on column public.image_generations.provider is 'Image generation provider host or short name.';
comment on column public.image_generations.image_model is 'Image model used for the generated image.';
comment on column public.image_generations.text_model is 'Text or responses model used to prepare the image request.';
comment on column public.image_generations.latency_ms is 'Elapsed time in milliseconds for the generation request.';
comment on column public.image_generations.image_width is 'Generated original image width in pixels.';
comment on column public.image_generations.image_height is 'Generated original image height in pixels.';
comment on column public.image_generations.original_bytes is 'Stored original image byte size.';
comment on column public.image_generations.preview_bytes is 'Stored full-size WebP preview byte size.';
comment on column public.image_generations.thumbnail_bytes is 'Stored thumbnail byte size.';
comment on table public.image_generation_attempts is 'Per-request image generation telemetry, including failed attempts. Not returned to clients.';
