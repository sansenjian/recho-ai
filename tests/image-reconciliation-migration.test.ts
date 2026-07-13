import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260712152425_add_image_reconciliation_audit.sql',
)

describe('image reconciliation audit migration', () => {
  it('creates private run and finding audit tables', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase()
    expect(sql).toContain('create table if not exists public.image_reconciliation_runs')
    expect(sql).toContain('create table if not exists public.image_reconciliation_findings')
    expect(sql).toContain('unique (run_id, kind, subject)')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('force row level security')
  })

  it('keeps reconciliation audit tables service-role-only', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase()
    expect(sql).toContain('revoke all on table public.image_reconciliation_runs from public, anon, authenticated')
    expect(sql).toContain('revoke all on table public.image_reconciliation_findings from public, anon, authenticated')
    expect(sql).toContain('grant select, insert, update on table public.image_reconciliation_runs to service_role')
  })
})
