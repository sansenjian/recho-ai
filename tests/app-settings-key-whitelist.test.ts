import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migrationsDir = resolve(root, 'supabase/migrations')
const servicePath = resolve(root, 'backend/gateway/src/services/app-settings.ts')

const serviceSource = readFileSync(servicePath, 'utf8')

/**
 * `app_settings.key` is guarded by a CHECK whitelist that only migrations may widen.
 * The service derives every writable key from `settingKeyToProperty`, so that map is
 * the authoritative list of keys the code may send to the database.
 */
function settingKeyToPropertyKeys(): string[] {
  const block = serviceSource.match(
    /const settingKeyToProperty[^=]*=\s*\{([\s\S]*?)\n\}/,
  )
  if (!block) throw new Error('settingKeyToProperty literal not found in app-settings.ts')

  return [...block[1].matchAll(/^\s*([a-z][a-z0-9_]*):/gm)].map(match => match[1])
}

function settingKeyToPropertyValues(): string[] {
  const block = serviceSource.match(
    /const settingKeyToProperty[^=]*=\s*\{([\s\S]*?)\n\}/,
  )
  if (!block) throw new Error('settingKeyToProperty literal not found in app-settings.ts')

  return [...block[1].matchAll(/:\s*'([A-Za-z][A-Za-z0-9]*)'/g)].map(match => match[1])
}

function defaultAppSettingsProperties(): string[] {
  const block = serviceSource.match(/export const DEFAULT_APP_SETTINGS[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!block) throw new Error('DEFAULT_APP_SETTINGS literal not found in app-settings.ts')

  return [...block[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map(match => match[1])
}

/** Whitelist declared by one migration revision, or null when it does not touch the constraint. */
function whitelistFrom(sql: string): string[] | null {
  const block = sql.match(
    /add constraint app_settings_key_check[\s\S]*?key in \(([\s\S]*?)\)/i,
  )
  if (!block) return null

  return [...block[1].matchAll(/'([a-z][a-z0-9_]*)'/g)].map(match => match[1])
}

function orderedMigrations(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(name => ({ name, sql: readFileSync(resolve(migrationsDir, name), 'utf8') }))
}

/** Every revision that restated the whitelist, oldest first. */
function whitelistRevisions() {
  return orderedMigrations()
    .map(migration => ({ ...migration, keys: whitelistFrom(migration.sql) }))
    .filter((revision): revision is { name: string; sql: string; keys: string[] } => Boolean(revision.keys))
}

const revisions = whitelistRevisions()
const latest = revisions[revisions.length - 1]
const previous = revisions[revisions.length - 2]

describe('app_settings key whitelist', () => {
  it('widens the whitelist with a migration instead of assuming app_settings is schemaless', () => {
    expect(revisions.length).toBeGreaterThan(0)
    expect(latest).toBeDefined()

    // The whitelist can only grow; a revision must restate every earlier key.
    expect([...latest!.keys].sort()).toEqual(
      expect.arrayContaining([...previous!.keys]),
    )
  })

  it('allows every key the gateway can write', () => {
    const writable = settingKeyToPropertyKeys()
    expect(writable.length).toBeGreaterThan(0)

    // Regression guard: image_model_credit_costs was writable in code while the
    // production constraint still rejected it, which surfaced as HTTP 500 on
    // PATCH /api/admin/settings. Any new setting key must ship with its migration.
    const missing = writable.filter(key => !latest!.keys.includes(key))
    expect(missing).toEqual([])
  })

  it('maps every AppSettings property to a setting key', () => {
    const mapped = settingKeyToPropertyValues()

    // Guards the reverse map used by the upsert: an unmapped property would write
    // `key: undefined` and fail at runtime instead of at review time.
    const unmapped = defaultAppSettingsProperties().filter(property => !mapped.includes(property))
    expect(unmapped).toEqual([])
  })

  it('ships the per-model credit cost key with an idempotent default row', () => {
    const migration = orderedMigrations().find(
      entry => entry.name.includes('image_model_credit_costs') && whitelistFrom(entry.sql),
    )
    expect(migration).toBeDefined()

    const sql = migration!.sql.toLowerCase()
    expect(sql).toContain('drop constraint if exists app_settings_key_check')
    expect(whitelistFrom(migration!.sql)).toContain('image_model_credit_costs')

    expect(sql).toContain('insert into public.app_settings')
    expect(sql).toMatch(/'image_model_credit_costs',\s*'\[\]'::jsonb/)
    expect(sql).toMatch(/on conflict \(key\) do nothing/)
  })
})
