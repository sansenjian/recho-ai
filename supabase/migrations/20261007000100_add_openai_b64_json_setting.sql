-- Allow the external OpenAI-compatible endpoint to return b64_json images.
--
-- app_settings.key is guarded by the app_settings_key_check whitelist, so a new
-- setting key is not writable until this constraint is widened. Without this
-- migration, saving openai_b64_json_enabled from the admin panel fails with
-- 23514 and surfaces as HTTP 500.
--
-- The list below is the full superset of the ten previously allowed keys plus
-- openai_b64_json_enabled. Dropping and re-adding keeps the same constraint
-- name so future widening migrations stay mechanical.

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
    'available_image_models',
    'image_model_credit_costs',
    'openai_b64_json_enabled'
  )
);

-- Default on: some clients only accept base64 (no public storage access, internal
-- networks), so the endpoint works out of the box. This does not affect the
-- default url response format, which stays a small JSON pointer to storage.
insert into public.app_settings (key, value, description)
values
  (
    'openai_b64_json_enabled',
    'true'::jsonb,
    'Whether the external OpenAI-compatible endpoint accepts response_format=b64_json. Enabled by default so clients that only handle base64 work out of the box; set false to force storage URLs.'
  )
on conflict (key) do nothing;
