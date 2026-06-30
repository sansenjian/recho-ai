import { beforeEach, describe, expect, it, vi } from 'vitest'

let providerRows: Array<Record<string, unknown>> = []
let insertedRow: Record<string, unknown> | null = null
let updatedRow: Record<string, unknown> | null = null

vi.mock('../backend/gateway/src/config', () => ({
  IMAGE_GEN_API_KEY: 'env-image-key',
  IMAGE_GEN_BASE_URL: 'https://image-env.example.test/v1',
  IMAGE_RESPONSES_IMAGE_MODEL: 'gpt-image-2',
  KIMI_API_KEY: '',
  KIMI_BASE_URL: '',
  NVIDIA_API_KEY: '',
  NVIDIA_BASE_URL: '',
  SUPABASE_PUBLISHABLE_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  SUPABASE_URL: '',
  TENCENT_COS_PUBLIC_BASE_URL: '',
  TENCENT_COS_SECRET_ID: '',
  TENCENT_COS_SECRET_KEY: '',
  OPENAI_API_KEY: '',
  OPENAI_BASE_URL: '',
  PROVIDER_API_KEY_MASTER_KEY: '0123456789abcdef0123456789abcdef',
}))

vi.mock('../backend/gateway/src/clients/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'provider_settings') throw new Error(`Unexpected table ${table}`)
      const listResponse = async () => ({
        data: providerRows,
        error: null,
      })
      const chain: Record<string, unknown> = {
        eq: vi.fn(() => chain),
        not: vi.fn(() => chain),
        order: vi.fn(() => chain),
        then: (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) =>
          listResponse().then(resolve, reject),
      }
      return {
        select: vi.fn(() => chain),
        insert: vi.fn((row: Record<string, unknown>) => {
          insertedRow = row
          const saved = {
            id: '11111111-1111-4111-8111-111111111111',
            ...row,
            created_at: '2026-06-29T00:00:00Z',
            updated_at: row.updated_at,
          }
          return {
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: saved, error: null })),
            })),
          }
        }),
        update: vi.fn((row: Record<string, unknown>) => {
          updatedRow = row
          const saved = {
            id: '11111111-1111-4111-8111-111111111111',
            kind: 'image',
            name: 'Image Provider',
            base_url: 'https://image.example.test/v1',
            enabled: true,
            priority: 100,
            image_model: 'gpt-image-2',
            edit_model: 'gpt-image-2',
            timeout_ms: 360000,
            retry_count: 3,
            supports_webp_references: true,
            api_key_encrypted: 'v1.aes-256-gcm.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA',
            api_key_preview: 'sto...-key',
            notes: null,
            created_at: '2026-06-29T00:00:00Z',
            updated_at: row.updated_at,
            ...row,
          }
          return {
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: saved, error: null })),
              })),
            })),
          }
        }),
      }
    },
  }),
}))

describe('provider settings service', () => {
  beforeEach(() => {
    providerRows = []
    insertedRow = null
    updatedRow = null
    vi.resetModules()
  })

  it('lists database providers without exposing raw api keys', async () => {
    providerRows = [{
      id: '11111111-1111-4111-8111-111111111111',
      kind: 'image',
      name: 'Image Provider',
      base_url: 'https://image.example.test/v1',
      enabled: true,
      priority: 10,
      image_model: 'gpt-image-2',
      edit_model: 'gpt-image-2',
      timeout_ms: 360000,
      retry_count: 3,
      supports_webp_references: true,
      api_key_encrypted: 'v1.aes-256-gcm.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA',
      api_key_preview: 'sk-...alue',
      notes: 'primary',
      created_at: '2026-06-29T00:00:00Z',
      updated_at: '2026-06-29T00:00:00Z',
    }]
    const { listProviderSettings } = await import('../backend/gateway/src/services/provider-settings')

    const result = await listProviderSettings({ refresh: true })

    expect(result.tableAvailable).toBe(true)
    expect(result.providers[0]).toMatchObject({
      name: 'Image Provider',
      apiKeyConfigured: true,
      apiKeyPreview: 'sk-...alue',
    })
    expect(JSON.stringify(result.providers)).not.toContain('sk-secret-value')
  })

  it('creates a provider with a server-only api key', async () => {
    const { createProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    const provider = await createProviderSetting({
      kind: 'image',
      name: 'Image Provider',
      baseUrl: 'https://image.example.test/v1',
      apiKey: 'sk-created-secret',
      imageModel: 'gpt-image-2',
      editModel: 'gpt-image-2',
      enabled: true,
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(insertedRow).toMatchObject({
      base_url: 'https://image.example.test/v1',
      api_key_preview: 'sk-...cret',
      updated_by: 'admin-user',
    })
    expect(typeof insertedRow?.api_key_encrypted).toBe('string')
    expect(String(insertedRow?.api_key_encrypted)).toMatch(/^v1\.aes-256-gcm\./)
    expect(JSON.stringify(insertedRow)).not.toContain('sk-created-secret')
    expect(provider.apiKeyConfigured).toBe(true)
    expect(JSON.stringify(provider)).not.toContain('sk-created-secret')
  })

  it('does not clear an existing api key when update key input is blank', async () => {
    const { updateProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await updateProviderSetting('11111111-1111-4111-8111-111111111111', {
      name: 'Renamed Provider',
      apiKey: '',
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(updatedRow).toMatchObject({
      name: 'Renamed Provider',
      updated_by: 'admin-user',
    })
    expect(updatedRow).not.toHaveProperty('api_key')
    expect(updatedRow).not.toHaveProperty('api_key_encrypted')
    expect(updatedRow).not.toHaveProperty('api_key_preview')
  })

  it('resolves an enabled runtime chat provider for matching models', async () => {
    const { encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')
    providerRows = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'chat',
        name: 'OpenAI Compatible Chat',
        base_url: 'https://chat.example.test/v1/',
        enabled: true,
        priority: 20,
        default_model: 'gpt-4o-mini',
        timeout_ms: 90000,
        retry_count: 2,
        api_key_encrypted: encryptSecret('sk-chat-runtime-secret'),
        api_key_preview: 'sk-...cret',
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
    ]
    const { getRuntimeChatProvider } = await import('../backend/gateway/src/services/provider-settings')

    const provider = await getRuntimeChatProvider('gpt-4o')

    expect(provider).toMatchObject({
      name: 'OpenAI Compatible Chat',
      baseUrl: 'https://chat.example.test/v1',
      apiKey: 'sk-chat-runtime-secret',
      timeoutMs: 90000,
      retryCount: 2,
    })
  })

  it('skips malformed encrypted chat rows and uses the next matching provider', async () => {
    const { encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')
    providerRows = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'chat',
        name: 'Broken Chat',
        base_url: 'https://chat.example.test/v1/',
        enabled: true,
        priority: 20,
        default_model: 'gpt-4o',
        timeout_ms: 90000,
        retry_count: 2,
        api_key_encrypted: 'v1.aes-256-gcm.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA',
        api_key_preview: 'sk-...cret',
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'chat',
        name: 'Working Chat',
        base_url: 'https://working-chat.example.test/v1/',
        enabled: true,
        priority: 30,
        default_model: 'gpt-4o',
        timeout_ms: 90000,
        retry_count: 2,
        api_key_encrypted: encryptSecret('sk-working-chat-secret'),
        api_key_preview: 'sk-...cret',
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
    ]
    const { getRuntimeChatProvider } = await import('../backend/gateway/src/services/provider-settings')

    const provider = await getRuntimeChatProvider('gpt-4o', { strict: true })

    expect(provider).toMatchObject({
      name: 'Working Chat',
      apiKey: 'sk-working-chat-secret',
    })
  })

  it('does not match unrelated slash-model namespaces', async () => {
    const { encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')
    providerRows = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'chat',
        name: 'Foo Namespace',
        base_url: 'https://foo.example.test/v1/',
        enabled: true,
        priority: 20,
        default_model: 'foo/bar',
        timeout_ms: 90000,
        retry_count: 2,
        api_key_encrypted: encryptSecret('sk-foo-secret'),
        api_key_preview: 'sk-...cret',
        created_at: '2026-06-29T00:00:00Z',
        updated_at: '2026-06-29T00:00:00Z',
      },
    ]
    const { getRuntimeChatProvider } = await import('../backend/gateway/src/services/provider-settings')

    await expect(getRuntimeChatProvider('baz/qux', { strict: true })).resolves.toBeNull()
  })
})
