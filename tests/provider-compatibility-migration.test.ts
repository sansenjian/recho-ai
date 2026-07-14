import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260714132041_add_image_provider_compatibility_mode.sql',
)

describe('image provider compatibility migration', () => {
  it('adds an auto-defaulted compatibility mode with a strict preset allowlist', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase()

    expect(sql).toMatch(/add column if not exists image_compatibility_mode text not null default 'auto'/)
    expect(sql).toContain('provider_settings_image_compatibility_mode_check')
    expect(sql).toMatch(/image_compatibility_mode in \('auto', 'openai', 'lucen'\)/)
  })
})
