create table if not exists public.image_events (
  id uuid primary key default gen_random_uuid(),
  image_id text references public.image_generations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  source text not null,
  session_id text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint image_events_event_type_check check (
    event_type in (
      'view_detail',
      'zoom',
      'download',
      'continue_generate',
      'send_to_chat',
      'copy_prompt',
      'use_as_reference',
      'delete'
    )
  ),
  constraint image_events_source_check check (
    source in ('works', 'history', 'canvas', 'viewer', 'chat')
  )
);

alter table public.image_events enable row level security;

revoke all on table public.image_events from anon, authenticated;
grant select, insert, update, delete on table public.image_events to service_role;

create index if not exists image_events_created_at_idx
  on public.image_events (created_at desc);

create index if not exists image_events_type_created_at_idx
  on public.image_events (event_type, created_at desc);

create index if not exists image_events_image_created_at_idx
  on public.image_events (image_id, created_at desc);

create table if not exists public.image_generation_contexts (
  id uuid primary key default gen_random_uuid(),
  generation_id text references public.image_generations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  canvas_id text not null,
  node_count integer not null,
  connection_count integer not null,
  image_node_count integer not null,
  text_node_count integer not null,
  generation_node_count integer not null,
  reference_count integer not null,
  mentioned_reference_count integer not null,
  connected_reference_count integer not null,
  prompt_char_count integer not null,
  has_connected_prompt boolean not null,
  canvas_version integer not null,
  created_at timestamptz not null default now()
);

alter table public.image_generation_contexts enable row level security;

revoke all on table public.image_generation_contexts from anon, authenticated;
grant select, insert, update, delete on table public.image_generation_contexts to service_role;

create index if not exists image_generation_contexts_generation_idx
  on public.image_generation_contexts (generation_id);

create index if not exists image_generation_contexts_canvas_created_at_idx
  on public.image_generation_contexts (canvas_id, created_at desc);

comment on table public.image_events is 'High-intent image action events. Gateway-only analytics table; gated by IMAGE_ANALYTICS_ENABLED.';
comment on column public.image_events.metadata is 'Small structured event metadata. Full prompts and canvas JSON are intentionally excluded.';
comment on table public.image_generation_contexts is 'Compact canvas workflow context for image generation requests. Does not store full canvas JSON.';
