-- Add generation toggle settings
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
    'guest_generation_enabled'
  )
);

insert into public.app_settings (key, value, description)
values
  ('free_generation_enabled', 'true'::jsonb, 'Allow logged-in users to fall back to free generation when credits are insufficient.'),
  ('guest_generation_enabled', 'true'::jsonb, 'Allow anonymous users to generate images.')
on conflict (key) do nothing;
