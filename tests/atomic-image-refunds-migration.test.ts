import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260712134431_atomic_image_refunds.sql',
)
const sql = readFileSync(migrationPath, 'utf8').toLowerCase()

describe('atomic image refund migration', () => {
  it('keeps the public refund RPC signature', () => {
    expect(sql).toMatch(
      /create or replace function public\.refund_user_credits\(\s*p_user_id uuid,\s*p_amount numeric,\s*p_related_transaction_id uuid default null,\s*p_metadata jsonb default '\{\}'::jsonb/s,
    )
    expect(sql).toContain('returns table(balance numeric)')
  })

  it('serializes cumulative refunds by related transaction', () => {
    expect(sql).toContain('pg_advisory_xact_lock')
    expect(sql).toContain('hashtextextended(p_related_transaction_id::text, 0)')
    expect(sql).toContain('sum(amount)')
    expect(sql).toContain("related_transaction_id = p_related_transaction_id")
  })

  it('keeps the service-role-only execution boundary', () => {
    expect(sql).toContain(
      'revoke all on function public.refund_user_credits(uuid, numeric, uuid, jsonb)',
    )
    expect(sql).toContain(
      'grant execute on function public.refund_user_credits(uuid, numeric, uuid, jsonb)',
    )
    expect(sql).toContain('to service_role')
  })
})
