alter table public.image_generations
  add column if not exists user_prompt text,
  add column if not exists system_prompt text,
  add column if not exists model_prompt text;

update public.image_generations
set
  user_prompt = coalesce(nullif(user_prompt, ''), prompt),
  model_prompt = coalesce(nullif(model_prompt, ''), prompt)
where user_prompt is null
  or user_prompt = ''
  or model_prompt is null
  or model_prompt = '';

comment on column public.image_generations.prompt is 'Legacy display prompt. New writes mirror the user prompt for backward compatibility.';
comment on column public.image_generations.user_prompt is 'User-authored prompt shown in the works gallery.';
comment on column public.image_generations.system_prompt is 'Internal prompt guidance added by Recho before image generation.';
comment on column public.image_generations.model_prompt is 'Full prompt sent to the image generation provider.';
comment on column public.image_generations.revised_prompt is 'Provider-returned optimized or revised prompt when available.';
