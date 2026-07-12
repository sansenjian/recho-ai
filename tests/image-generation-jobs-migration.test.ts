import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260712072117_add_image_generation_jobs.sql',
)

const sql = readFileSync(migrationPath, 'utf8')
  .replace(/--.*$/gm, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim()

const statements = sql
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean)

const tableDefinition =
  statements.find((statement) =>
    /^create table(?: if not exists)? public\.image_generation_jobs\s*\(/.test(statement),
  ) ?? ''

function findIndex(columns: RegExp, unique = false) {
  const prefix = unique ? /^create unique index\b/ : /^create index\b/

  return (
    statements.find(
      (statement) =>
        prefix.test(statement) &&
        /\bon public\.image_generation_jobs\b/.test(statement) &&
        columns.test(statement) &&
        /\bwhere\b/.test(statement),
    ) ?? ''
  )
}

function quotedValues(value: string) {
  return [...value.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe('image generation jobs migration', () => {
  it('creates the durable job table with the required state and integrity checks', () => {
    expect(tableDefinition).not.toBe('')
    expect(tableDefinition).toMatch(/\bid uuid primary key default gen_random_uuid\(\)/)
    expect(tableDefinition).toMatch(/\bgeneration_batch_id text not null unique\b/)
    expect(tableDefinition).toMatch(/\brequest_id text not null\b/)
    expect(tableDefinition).toMatch(
      /\buser_id uuid references auth\.users\s*\(\s*id\s*\) on delete set null\b/,
    )
    expect(tableDefinition).toMatch(/\bidempotency_key text\b/)
    expect(tableDefinition).toMatch(/\brequest_hash text\b/)
    expect(tableDefinition).toMatch(
      /check\s*\(\s*\(\s*idempotency_key is null\s*\)\s*=\s*\(\s*request_hash is null\s*\)\s*\)/,
    )
    expect(tableDefinition).toContain("request_hash ~ '^[0-9a-f]{64}$'")

    const statusCheck = tableDefinition.match(
      /check\s*\(\s*status\s+in\s*\(([^)]*)\)\s*\)/,
    )
    expect(statusCheck).not.toBeNull()
    expect(new Set(quotedValues(statusCheck?.[1] ?? ''))).toEqual(
      new Set([
        'staging',
        'persistence_pending',
        'persistence_processing',
        'completed',
        'failed',
        'refund_pending',
        'refunded',
      ]),
    )
    expect(tableDefinition).toContain("status text not null default 'staging'")

    expect(tableDefinition).toMatch(
      /\bcredit_transaction_id uuid references public\.credit_transactions\s*\(\s*id\s*\) on delete set null\b/,
    )
    expect(tableDefinition).toContain('reserved_amount numeric(12, 2) not null default 0')
    expect(tableDefinition).toMatch(/\brefunded_amount numeric\s*\(\s*12\s*,\s*2\s*\)/)
    expect(tableDefinition).toMatch(/check\s*\(\s*reserved_amount\s*>=\s*0\s*\)/)
    expect(tableDefinition).toMatch(/check\s*\(\s*refunded_amount\s*>=\s*0\s*\)/)
    expect(tableDefinition).toMatch(
      /check\s*\(\s*refunded_amount\s*<=\s*reserved_amount\s*\)/,
    )
    expect(tableDefinition).toMatch(/check\s*\(\s*requested_count\s*>\s*0\s*\)/)
    expect(tableDefinition).toMatch(/check\s*\(\s*returned_count\s*>=\s*0\s*\)/)
    expect(tableDefinition).toMatch(
      /check\s*\(\s*returned_count\s*<=\s*requested_count\s*\)/,
    )

    expect(tableDefinition).toMatch(/\bresult_manifest jsonb not null\b/)
    expect(tableDefinition).toMatch(
      /check\s*\(\s*jsonb_typeof\s*\(\s*result_manifest\s*\)\s*=\s*'object'\s*\)/,
    )
    expect(tableDefinition).toMatch(/\bresponse_body jsonb\b/)
    expect(tableDefinition).toMatch(
      /check\s*\(\s*response_body is null\s+or\s+jsonb_typeof\s*\(\s*response_body\s*\)\s*=\s*'object'\s*\)/,
    )

    expect(tableDefinition).toMatch(/\bretry_count integer not null default 0\b/)
    expect(tableDefinition).toMatch(/check\s*\(\s*retry_count\s*>=\s*0\s*\)/)
    expect(tableDefinition).toMatch(/\bmax_attempts integer not null default 5\b/)
    expect(tableDefinition).toMatch(/check\s*\(\s*max_attempts\s*>\s*0\s*\)/)
    expect(tableDefinition).toMatch(
      /\bnext_attempt_at timestamptz not null default now\s*\(\s*\)/,
    )
    expect(tableDefinition).toMatch(/\blocked_by text\b/)
    expect(tableDefinition).toMatch(/\blease_token uuid\b/)
    expect(tableDefinition).toMatch(/\blocked_until timestamptz\b/)
    expect(tableDefinition).toMatch(
      /check\s*\(\s*num_nonnulls\s*\(\s*locked_by\s*,\s*lease_token\s*,\s*locked_until\s*\)\s+in\s*\(\s*0\s*,\s*3\s*\)\s*\)/,
    )
    expect(tableDefinition).toMatch(/\blast_error_code text\b/)
    expect(tableDefinition).toMatch(/\blast_error_detail text\b/)
    expect(tableDefinition).toMatch(/\bcreated_at timestamptz not null default now\s*\(\s*\)/)
    expect(tableDefinition).toMatch(/\bupdated_at timestamptz not null default now\s*\(\s*\)/)
    expect(tableDefinition).toMatch(/\bcompleted_at timestamptz\b/)
  })

  it('defines immutable partial indexes for ready work and expired leases', () => {
    const readyIndex = findIndex(/\(\s*next_attempt_at\s*,\s*created_at\s*\)/)
    expect(readyIndex).not.toBe('')
    expect(readyIndex).toContain("'persistence_pending'")
    expect(readyIndex).toContain("'refund_pending'")
    expect(readyIndex.slice(readyIndex.indexOf(' where '))).not.toMatch(/\bnow\s*\(/)

    const expiredLeaseIndex = findIndex(/\(\s*locked_until\s*,\s*created_at\s*\)/)
    expect(expiredLeaseIndex).not.toBe('')
    expect(expiredLeaseIndex).toContain("'staging'")
    expect(expiredLeaseIndex).toContain("'persistence_processing'")
    expect(expiredLeaseIndex.slice(expiredLeaseIndex.indexOf(' where '))).not.toMatch(
      /\bnow\s*\(/,
    )
  })

  it('adds lookup and active-idempotency partial indexes', () => {
    const userTimeIndex = findIndex(/\(\s*user_id\s*,\s*created_at\s+desc\s*\)/)
    expect(userTimeIndex).toMatch(/\buser_id is not null\b/)

    const creditTransactionIndex = findIndex(/\(\s*credit_transaction_id\s*\)/)
    expect(creditTransactionIndex).toMatch(/\bcredit_transaction_id is not null\b/)

    const idempotencyIndex = findIndex(
      /\(\s*user_id\s*,\s*idempotency_key\s*\)/,
      true,
    )
    expect(idempotencyIndex).toMatch(/\bidempotency_key is not null\b/)
    for (const status of [
      'staging',
      'persistence_pending',
      'persistence_processing',
      'completed',
      'refund_pending',
    ]) {
      expect(idempotencyIndex).toContain(`'${status}'`)
    }
  })

  it('locks the table behind forced RLS and service-role-only write grants', () => {
    expect(sql).toMatch(
      /alter table public\.image_generation_jobs enable row level security\s*;/,
    )
    expect(sql).toMatch(
      /alter table public\.image_generation_jobs force row level security\s*;/,
    )

    const revokedRoles = new Set(
      statements
        .filter((statement) =>
          /^revoke all on table public\.image_generation_jobs from\b/.test(statement),
        )
        .flatMap((statement) =>
          statement
            .replace(/^.*\bfrom\s+/, '')
            .split(',')
            .map((role) => role.trim()),
        ),
    )
    expect(revokedRoles).toEqual(new Set(['public', 'anon', 'authenticated']))

    const serviceRoleGrant =
      statements.find((statement) =>
        /^grant\b.*\bon table public\.image_generation_jobs to service_role$/.test(statement),
      ) ?? ''
    const privileges = serviceRoleGrant
      .replace(/^grant\s+/, '')
      .replace(/\s+on table public\.image_generation_jobs to service_role$/, '')
      .split(',')
      .map((privilege) => privilege.trim())
      .filter(Boolean)
      .sort()

    expect(privileges).toEqual(['insert', 'select', 'update'])
    expect(serviceRoleGrant).not.toMatch(/\bdelete\b/)
    expect(sql).not.toMatch(/\bcreate\s+(?:or replace\s+)?function\b/)
    expect(sql).not.toMatch(/\bcreate policy\b/)
  })
})
