-- Allow per-model image credit costs to be persisted in app_settings.
--
-- app_settings.key is guarded by the app_settings_key_check whitelist, so a new
-- setting key is not writable until this constraint is widened. The previous
-- definition (202606140002) only covered nine keys, which made every
-- PATCH /api/admin/settings that carried image_model_credit_costs fail with
-- 23514 and surface as HTTP 500.
--
-- The list below is the full superset of the nine previously allowed keys plus
-- image_model_credit_costs. Dropping and re-adding keeps the same constraint
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
    'image_model_credit_costs'
  )
);

insert into public.app_settings (key, value, description)
values
  (
    'image_model_credit_costs',
    '[]'::jsonb,
    'Per-model image credit cost overrides as a JSON array of { id, cost }. Empty falls back to image_credit_cost_per_image.'
  )
on conflict (key) do nothing;
