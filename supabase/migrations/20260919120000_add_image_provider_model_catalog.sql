-- Image providers gain a selectable generation-model catalog.
--
-- Semantics for kind = 'image':
--   model_catalog : selectable generation models, entries of { id, name, enabled }
--   image_model   : default generation model, kept in sync with the first enabled catalog entry
--   edit_model    : model used when reference images are attached (unchanged, still a single value)
--
-- Backfill existing rows so the admin dashboard and /api/config/app expose the
-- already-configured image_model as the first catalog entry instead of losing it.
-- `models` is written alongside `model_catalog` so both stay coherent, matching
-- what the provider settings service writes on every catalog update.

update public.provider_settings
set model_catalog = jsonb_build_array(
      jsonb_build_object('id', trim(image_model), 'name', trim(image_model), 'enabled', true)
    ),
    models = array[trim(image_model)]
where kind = 'image'
  and coalesce(trim(image_model), '') <> ''
  and coalesce(model_catalog, '[]'::jsonb) = '[]'::jsonb;

comment on column public.provider_settings.model_catalog is
  'Provider model entries with id, display name, and enabled state. For kind = chat these are selectable chat models; for kind = image these are selectable generation models and image_model remains the default (first enabled entry). models remains as a legacy ID-only fallback.';
