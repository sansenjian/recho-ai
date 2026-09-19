import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260919120000_add_image_provider_model_catalog.sql',
)

describe('image provider model catalog migration', () => {
  it('backfills image providers from image_model without clobbering existing catalogs', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase()

    // Reuses the jsonb catalog introduced for chat providers.
    expect(sql).toContain('update public.provider_settings')
    expect(sql).toMatch(/jsonb_build_object\('id', trim\(image_model\), 'name', trim\(image_model\), 'enabled', true\)/)

    // Only image providers are touched, and only when their image_model is usable.
    expect(sql).toContain("kind = 'image'")
    expect(sql).not.toContain("kind = 'chat'")
    expect(sql).toMatch(/coalesce\(trim\(image_model\), ''\) <> ''/)

    // Idempotent: rows that already carry a catalog are left alone.
    expect(sql).toMatch(/coalesce\(model_catalog, '\[\]'::jsonb\) = '\[\]'::jsonb/)

    // models is kept coherent with the catalog, matching the service write path.
    expect(sql).toMatch(/models = array\[trim\(image_model\)\]/)
  })

  it('documents the image catalog semantics and leaves edit_model untouched', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase()

    expect(sql).toContain('comment on column public.provider_settings.model_catalog')

    // edit_model stays a single value owned by the request-time edit routing.
    expect(sql).not.toMatch(/edit_model\s*=/)
  })
})
