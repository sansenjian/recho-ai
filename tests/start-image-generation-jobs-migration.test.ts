import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260712135634_start_image_generation_jobs.sql',
)

describe('atomic image job start migration', () => {
  it('defines an atomic idempotency, credit, and staging-job transaction', () => {
    expect(existsSync(migrationPath)).toBe(true)
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase()
    expect(sql).toContain('create or replace function public.start_image_generation_job')
    expect(sql).toContain('for update')
    expect(sql).toContain('reserve_user_credits')
    expect(sql).toContain('insert into public.image_generation_jobs')
    expect(sql).toMatch(
      /status,\s+credit_transaction_id[\s\S]*?'staging',\s+v_transaction_id/,
    )
    expect(sql).toContain('update public.idempotency_keys')
  })

  it('keeps the RPC service-role-only', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase()
    expect(sql).toContain(
      'revoke all on function public.start_image_generation_job',
    )
    expect(sql).toContain(
      'grant execute on function public.start_image_generation_job',
    )
    expect(sql).toContain('to service_role')
  })
})
