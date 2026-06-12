alter table public.image_generations
  add column if not exists expires_at timestamptz;

update public.image_generations
   set expires_at = generated_at + interval '7 days'
 where funding_source = 'credit'
   and expires_at is null;

update public.image_generations
   set expires_at = null
 where funding_source is distinct from 'credit'
   and expires_at is not null;

create index if not exists image_generations_user_expires_generated_at_idx
  on public.image_generations (user_id, expires_at, generated_at desc);

create index if not exists image_generations_expires_at_idx
  on public.image_generations (expires_at)
  where expires_at is not null;

comment on column public.image_generations.expires_at is
  'Logical expiry for user-facing image history. Credit-funded images stay stored but are hidden from users after expiry.';
