-- Add available image models setting
alter table public.app_settings drop constraint if exists app_settings_key_check;
alter table public.app_settings add constraint app_settings_key_check check (
  key in (
    'image_credit_cost_per_image',
    'image_analytics_enabled',
    'image_responses_model',
    'image_responses_image_model',
    'image_events_enabled',
    'canvas_context_enabled',
    'free_generation_enabled',
    'guest_generation_enabled',
    'available_image_models'
  )
);

insert into public.app_settings (key, value, description)
values
  ('available_image_models', '[{"id":"gpt-image-2","name":"gpt-image-2"}]'::jsonb, 'List of image models available for frontend selection.')
on conflict (key) do nothing;
