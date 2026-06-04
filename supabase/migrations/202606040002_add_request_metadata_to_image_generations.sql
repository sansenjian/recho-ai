alter table public.image_generations
  add column if not exists request_ip inet,
  add column if not exists request_user_agent text;

create index if not exists image_generations_request_ip_generated_at_idx
  on public.image_generations (request_ip, generated_at desc);

comment on column public.image_generations.request_ip is 'Client IP captured by the gateway when the image generation request was created. Not returned to clients.';
comment on column public.image_generations.request_user_agent is 'Client user agent captured by the gateway when the image generation request was created. Not returned to clients.';
