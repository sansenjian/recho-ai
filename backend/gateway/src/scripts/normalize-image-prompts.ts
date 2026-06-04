import { getSupabaseAdminClient } from '../clients/supabase.js'

const TABLE = 'image_generations'
const BATCH_SIZE = 50
const applyChanges = process.argv.includes('--apply')

interface HistoryPromptRow {
  id: string
  prompt?: string | null
}

interface PromptParts {
  userPrompt: string
  systemPrompt: string
  modelPrompt: string
}

function isSystemPromptBlock(block: string) {
  return (
    /^已上传 \d+ 张真实参考图/.test(block) &&
    block.includes('不要只根据文字重新想象')
  ) || /^.+: 第 \d+ 张参考图/.test(block)
}

function splitPrompt(prompt: string): PromptParts {
  const blocks = prompt
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)

  const userBlocks = blocks.filter(block => !isSystemPromptBlock(block))
  const systemBlocks = blocks.filter(isSystemPromptBlock)
  const userPrompt = userBlocks.join('\n\n') || prompt
  const systemPrompt = systemBlocks.join('\n\n')

  return {
    userPrompt,
    systemPrompt,
    modelPrompt: systemPrompt ? prompt : userPrompt,
  }
}

function promptNeedsCleanup(row: HistoryPromptRow, parts: PromptParts) {
  return Boolean(row.prompt && parts.userPrompt !== row.prompt)
}

function promptDetailColumnsMissing(error: { code?: string; message?: string }) {
  return error.code === 'PGRST204' && /(user_prompt|system_prompt|model_prompt)/i.test(error.message || '')
}

async function updatePromptRow(
  client: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  row: HistoryPromptRow,
  parts: PromptParts,
) {
  const fullUpdate = {
    prompt: parts.userPrompt,
    user_prompt: parts.userPrompt,
    system_prompt: parts.systemPrompt || null,
    model_prompt: parts.modelPrompt || null,
  }

  const { error } = await client
    .from(TABLE)
    .update(fullUpdate)
    .eq('id', row.id)

  if (!error) return 'split'

  if (!promptDetailColumnsMissing(error)) throw error

  const { error: fallbackError } = await client
    .from(TABLE)
    .update({ prompt: parts.userPrompt })
    .eq('id', row.id)

  if (fallbackError) throw fallbackError
  return 'legacy'
}

async function main() {
  const client = getSupabaseAdminClient()
  if (!client) throw new Error('Supabase service role is not configured')

  let offset = 0
  let scanned = 0
  let changed = 0
  let splitUpdated = 0
  let legacyUpdated = 0

  while (true) {
    const { data, error } = await client
      .from(TABLE)
      .select('id,prompt')
      .order('generated_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) throw error
    const rows = (data || []) as HistoryPromptRow[]
    if (!rows.length) break

    for (const row of rows) {
      scanned += 1
      const prompt = String(row.prompt || '')
      const parts = splitPrompt(prompt)
      if (!promptNeedsCleanup(row, parts)) continue

      changed += 1
      if (!applyChanges) {
        console.log(`[normalize-prompts] would update ${row.id}`)
        continue
      }

      const mode = await updatePromptRow(client, row, parts)
      if (mode === 'split') splitUpdated += 1
      if (mode === 'legacy') legacyUpdated += 1
      console.log(`[normalize-prompts] updated ${row.id} (${mode})`)
    }

    offset += rows.length
  }

  console.log(
    `[normalize-prompts] scanned=${scanned}, changed=${changed}, splitUpdated=${splitUpdated}, legacyUpdated=${legacyUpdated}, apply=${applyChanges}`,
  )
}

main().catch((err) => {
  console.error('[normalize-prompts] failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
