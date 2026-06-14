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
  ('available_image_models', '[{"id":"gpt-image-1","name":"GPT Image 1"},{"id":"gpt-image-1-mini","name":"GPT Image 1 Mini"},{"id":"dall-e-3","name":"DALL·E 3"},{"id":"dall-e-2","name":"DALL·E 2"}]'::jsonb, 'List of image models available for frontend selection.')
on conflict (key) do nothing;
