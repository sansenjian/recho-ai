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

/** 该迁移里针对某个键执行了 delete，即移除白名单时一并清理了数据行。 */
/** 该迁移里针对某个键执行了 delete，即移除白名单时一并清理了数据行。 */
function deletesKey(sql: string, key: string): boolean {
  // 归一化空白，避免换行与缩进影响匹配；用字符串包含而不是正则，
  // 迁移里的写法是固定的，不必为转义层数再引入一类错误。
  const flat = sql.replace(/\s+/g, ' ')
  return flat.includes("delete from public.app_settings where key = '" + key + "'")
}

function orderedMigrations(): Array<{ name: string; sql: string }> {
  return readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(name => ({ name, sql: readFileSync(resolve(migrationsDir, name), 'utf8') }))
}

/** Every revision that restated the whitelist, oldest first. */
/** Every revision that restated the whitelist, oldest first. */
function whitelistRevisions() {
  const revisions = orderedMigrations()
    .map(migration => ({ ...migration, keys: whitelistFrom(migration.sql) }))
    .filter((revision): revision is { name: string; sql: string; keys: string[] } => Boolean(revision.keys))

  // deletes 记录的是「上一版有、这一版没有」的键：只看本版的 keys 列表永远看不到
  // 被移除的键，因为它已经不在里面了。
  return revisions.map((revision, index) => ({
    ...revision,
    deletes: (revisions[index - 1]?.keys ?? [])
      .filter(key => !revision.keys.includes(key))
      .filter(key => deletesKey(revision.sql, key)),
  }))
}

const revisions = whitelistRevisions()
const latest = revisions[revisions.length - 1]

describe('app_settings key whitelist', () => {
  it('widens the whitelist with a migration instead of assuming app_settings is schemaless', () => {
    expect(revisions.length).toBeGreaterThan(0)
    expect(latest).toBeDefined()

    // 比较每一对相邻版本，而不只是最新一个：早先被删、后来又加回来的键会从
    // 「只看最新」的检查里溜过去，而中间那段时间写入的行其实是被拒绝的。
    //
    // 键可以移除，但必须先把数据清掉：白名单是写入约束，键一旦被移除，库里残留
    // 的该行就再也删不掉也改不了（约束连删除语句本身都会拒绝）。所以每条移除都
    // 要在同一个迁移里带上 delete，否则那条记录就永久卡在库里。
    const removals = revisions.slice(1).flatMap((revision, index) => {
      const dropped = revisions[index].keys.filter(key => !revision.keys.includes(key))
      return dropped.map(key => ({
        key,
        migration: revision.name,
        // 在同一个迁移文件里就该看到针对该键的 delete。
        deletesRow: revision.deletes.includes(key),
      }))
    })

    const withoutCleanup = removals.filter(entry => !entry.deletesRow)
    expect(withoutCleanup).toEqual([])
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
