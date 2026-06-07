import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSupabaseAdminClient } from '../clients/supabase.js'
import { createRandomCreditCode, creditCodeHash, normalizeCreditCode } from '../services/credit-code.js'
import { safeErrorDetail } from '../services/safe-error.js'

interface CreateCreditCodesOptions {
  count: number
  credits: number
  maxRedemptions: number
  days: number | null
  expiresAt: string | null
  note: string | null
  prefix: string
  output: string | null
  dryRun: boolean
}

interface GeneratedCreditCode {
  code: string
  normalizedCode: string
  codeHash: string
}

const DEFAULT_OPTIONS: CreateCreditCodesOptions = {
  count: 1,
  credits: 0,
  maxRedemptions: 1,
  days: null,
  expiresAt: null,
  note: null,
  prefix: 'RECHO',
  output: null,
  dryRun: false,
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '../../../..')

function usage() {
  return [
    'Usage:',
    '  npm run credits:create -- --credits 100 --count 20 --uses 1 --days 30 --note "June campaign"',
    '',
    'Options:',
    '  --credits <number>   Required. Credits added by each code.',
    '  --count <number>     Number of codes to create. Default: 1.',
    '  --uses <number>      Max users that can redeem each code. Default: 1.',
    '  --days <number>      Expire codes after this many days.',
    '  --expires <date>     Expire codes at an ISO date/time. Overrides --days.',
    '  --note <text>        Internal note stored with the code hash.',
    '  --prefix <text>      Code prefix. Default: RECHO.',
    '  --out <path>         CSV output path. Default: output/credit-codes-<timestamp>.csv.',
    '  --dry-run            Generate CSV without inserting into Supabase.',
    '  --help               Show this help.',
  ].join('\n')
}

function readValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parsePositiveInteger(value: string, flag: string) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return number
}

function parseArgs(argv: string[]) {
  const options = { ...DEFAULT_OPTIONS }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--credits') {
      options.credits = parsePositiveInteger(readValue(argv, index, arg), arg)
      index += 1
      continue
    }
    if (arg === '--count') {
      options.count = parsePositiveInteger(readValue(argv, index, arg), arg)
      index += 1
      continue
    }
    if (arg === '--uses' || arg === '--max-redemptions') {
      options.maxRedemptions = parsePositiveInteger(readValue(argv, index, arg), arg)
      index += 1
      continue
    }
    if (arg === '--days') {
      options.days = parsePositiveInteger(readValue(argv, index, arg), arg)
      index += 1
      continue
    }
    if (arg === '--expires') {
      options.expiresAt = parseDate(readValue(argv, index, arg), arg)
      index += 1
      continue
    }
    if (arg === '--note') {
      options.note = readValue(argv, index, arg).trim() || null
      index += 1
      continue
    }
    if (arg === '--prefix') {
      options.prefix = readValue(argv, index, arg)
      index += 1
      continue
    }
    if (arg === '--out') {
      options.output = readValue(argv, index, arg)
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  if (!options.credits) throw new Error('--credits is required')
  if (options.count > 1000) throw new Error('--count must be 1000 or less')
  return options
}

function parseDate(value: string, flag: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${flag} must be a valid date`)
  return date.toISOString()
}

function expiresAtForOptions(options: CreateCreditCodesOptions) {
  if (options.expiresAt) return options.expiresAt
  if (!options.days) return null
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + options.days)
  return date.toISOString()
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function outputPathForOptions(options: CreateCreditCodesOptions) {
  const output = options.output || `output/credit-codes-${timestampSlug()}.csv`
  return isAbsolute(output) ? output : resolve(REPO_ROOT, output)
}

function generateCodes(options: CreateCreditCodesOptions) {
  const codes: GeneratedCreditCode[] = []
  const seen = new Set<string>()

  while (codes.length < options.count) {
    const code = createRandomCreditCode(options.prefix)
    const normalizedCode = normalizeCreditCode(code)
    if (!normalizedCode || seen.has(normalizedCode)) continue
    seen.add(normalizedCode)
    codes.push({
      code,
      normalizedCode,
      codeHash: creditCodeHash(code),
    })
  }

  return codes
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function codesToCsv(
  codes: GeneratedCreditCode[],
  options: CreateCreditCodesOptions,
  expiresAt: string | null,
  insertedIds: string[] = [],
) {
  const header = [
    'code',
    'credits',
    'max_redemptions',
    'expires_at',
    'note',
    'database_id',
  ]
  const rows = codes.map((code, index) => [
    code.code,
    options.credits,
    options.maxRedemptions,
    expiresAt,
    options.note,
    insertedIds[index] || '',
  ])
  return [header, ...rows]
    .map(row => row.map(csvCell).join(','))
    .join('\n')
}

async function writeCsv(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${content}\n`, 'utf8')
}

async function insertCodes(
  codes: GeneratedCreditCode[],
  options: CreateCreditCodesOptions,
  expiresAt: string | null,
) {
  const client = getSupabaseAdminClient()
  if (!client) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }

  const { data, error } = await client
    .from('credit_redemption_codes')
    .insert(codes.map(code => ({
      code_hash: code.codeHash,
      credits: options.credits,
      max_redemptions: options.maxRedemptions,
      expires_at: expiresAt,
      note: options.note,
    })))
    .select('id')

  if (error) throw error
  return (data || []).map(row => String(row.id || ''))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const expiresAt = expiresAtForOptions(options)
  const codes = generateCodes(options)
  let insertedIds: string[] = []

  if (!options.dryRun) {
    insertedIds = await insertCodes(codes, options, expiresAt)
  }

  const outputPath = outputPathForOptions(options)
  await writeCsv(outputPath, codesToCsv(codes, options, expiresAt, insertedIds))

  const action = options.dryRun ? 'Generated' : 'Created'
  console.log(`${action} ${codes.length} credit code(s).`)
  console.log(`Credits per code: ${options.credits}`)
  console.log(`Max redemptions per code: ${options.maxRedemptions}`)
  console.log(`CSV: ${outputPath}`)
  if (options.dryRun) {
    console.log('Dry run only; nothing was inserted into Supabase.')
  }
}

main().catch((error) => {
  console.error(`Failed to create credit codes: ${safeErrorDetail(error)}`)
  process.exit(1)
})
