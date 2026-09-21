import { beforeEach, describe, expect, it, vi } from 'vitest'

let providerRows: Array<Record<string, unknown>> = []
let insertedRow: Record<string, unknown> | null = null
let updatedRow: Record<string, unknown> | null = null
let modelsColumnAvailable = true
let modelCatalogColumnAvailable = true

const defaultProviderRow = {
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
}

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
      let requestedModelsColumn = true
      let requestedModelCatalogColumn = true
      const listResponse = async () => ({
        data: providerRows,
        error: requestedModelsColumn && !modelsColumnAvailable
          ? { code: 'PGRST204', message: 'column provider_settings.models does not exist' }
          : requestedModelCatalogColumn && !modelCatalogColumnAvailable
            ? { code: 'PGRST204', message: 'column provider_settings.model_catalog does not exist' }
            : null,
      })
      const chain: Record<string, unknown> = {
        eq: vi.fn(() => chain),
        not: vi.fn(() => chain),
        order: vi.fn(() => chain),
        then: (resolve: (value: unknown) => void, reject: (reason?: unknown) => void) =>
          listResponse().then(resolve, reject),
        maybeSingle: vi.fn(async () => ({
          data: providerRows[0] ?? defaultProviderRow,
          error: requestedModelsColumn && !modelsColumnAvailable
            ? { code: 'PGRST204', message: 'column provider_settings.models does not exist' }
            : requestedModelCatalogColumn && !modelCatalogColumnAvailable
              ? { code: 'PGRST204', message: 'column provider_settings.model_catalog does not exist' }
              : null,
        })),
      }
      return {
        select: vi.fn((columns: string) => {
          requestedModelsColumn = columns.includes('models')
          requestedModelCatalogColumn = columns.includes('model_catalog')
          return chain
        }),
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
    modelsColumnAvailable = true
    modelCatalogColumnAvailable = true
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
      image_compatibility_mode: 'lucen',
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
      imageCompatibilityMode: 'lucen',
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
      imageCompatibilityMode: 'lucen',
      enabled: true,
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(insertedRow).toMatchObject({
      base_url: 'https://image.example.test/v1',
      image_compatibility_mode: 'lucen',
      api_key_preview: 'sk-...cret',
      updated_by: 'admin-user',
    })
    expect(typeof insertedRow?.api_key_encrypted).toBe('string')
    expect(String(insertedRow?.api_key_encrypted)).toMatch(/^v1\.aes-256-gcm\./)
    expect(JSON.stringify(insertedRow)).not.toContain('sk-created-secret')
    expect(provider.apiKeyConfigured).toBe(true)
    expect(JSON.stringify(provider)).not.toContain('sk-created-secret')
  })

  it('ignores a stale imageModel when a create request carries the model catalog', async () => {
    const { createProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    // The admin form keeps sending the previously saved model alongside the
    // catalog, so a fully disabled catalog would otherwise persist a model the
    // operator just turned off.
    await createProviderSetting({
      kind: 'image',
      name: 'Disabled Catalog Provider',
      baseUrl: 'https://disabled.example.test/v1',
      apiKey: 'sk-created-secret',
      imageModel: 'gpt-image-2',
      modelCatalog: [
        { id: 'gpt-image-2', name: 'GPT Image 2', enabled: false },
        { id: 'flux-pro', name: 'FLUX Pro', enabled: false },
      ],
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(insertedRow).toMatchObject({
      image_model: null,
      models: ['gpt-image-2', 'flux-pro'],
    })
  })

  it('still honours an explicit imageModel when no catalog is supplied', async () => {
    const { createProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await createProviderSetting({
      kind: 'image',
      name: 'Legacy Image Provider',
      baseUrl: 'https://legacy.example.test/v1',
      apiKey: 'sk-created-secret',
      imageModel: 'legacy-image-model',
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(insertedRow).toMatchObject({ image_model: 'legacy-image-model' })
  })

  it('rejects unsupported image compatibility modes', async () => {
    const { createProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await expect(createProviderSetting({
      kind: 'image',
      name: 'Image Provider',
      baseUrl: 'https://image.example.test/v1',
      apiKey: 'sk-created-secret',
      imageCompatibilityMode: 'unsupported',
    }, { id: 'admin-user', email: 'admin@example.test' })).rejects.toMatchObject({
      message: 'invalid_image_compatibility_mode',
      status: 400,
    })
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

  it('supports models-only chat provider updates and synchronizes default_model', async () => {
    providerRows = [{ ...defaultProviderRow, kind: 'chat', default_model: 'gpt-4o', models: ['gpt-4o'] }]
    const { updateProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await updateProviderSetting('11111111-1111-4111-8111-111111111111', {
      models: ['gpt-5.5', 'gpt-4o'],
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(updatedRow).toMatchObject({ models: ['gpt-5.5', 'gpt-4o'], default_model: 'gpt-5.5' })
  })

  it('synchronizes image_model from the model catalog without touching edit_model', async () => {
    providerRows = [{ ...defaultProviderRow, model_catalog: [] }]
    const { updateProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await updateProviderSetting('11111111-1111-4111-8111-111111111111', {
      modelCatalog: [
        { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true },
        { id: 'flux-pro', name: 'FLUX Pro', enabled: true },
      ],
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(updatedRow).toMatchObject({
      models: ['gpt-image-2', 'flux-pro'],
      model_catalog: [
        { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true },
        { id: 'flux-pro', name: 'FLUX Pro', enabled: true },
      ],
      image_model: 'gpt-image-2',
    })
    // Edit routing keeps using the dedicated edit_model column.
    expect(updatedRow).not.toHaveProperty('edit_model')
  })

  it('normalizes the per-row edit model when persisting the model catalog', async () => {
    const { createProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await createProviderSetting({
      kind: 'image',
      name: 'Image Provider',
      baseUrl: 'https://image.example.test/v1',
      apiKey: 'sk-created-secret',
      modelCatalog: [
        { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true, editModel: '  gpt-image-edit  ' },
        { id: 'flux-pro', name: 'FLUX Pro', enabled: true, editModel: '' },
        { id: 'legacy-edit', name: 'Legacy Edit', enabled: true, editModel: 'e'.repeat(130) },
        { id: 'non-string-edit', name: 'Non String', enabled: true, editModel: 123 },
        'string-row-model',
      ],
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(insertedRow?.model_catalog).toEqual([
      { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true, editModel: 'gpt-image-edit' },
      // 空串归一为 null，表示「行内未配置，回落到 Provider 级 edit_model」。
      { id: 'flux-pro', name: 'FLUX Pro', enabled: true, editModel: null },
      { id: 'legacy-edit', name: 'Legacy Edit', enabled: true, editModel: 'e'.repeat(120) },
      // 非字符串忽略；字符串行没有行内编辑模型。
      { id: 'non-string-edit', name: 'Non String', enabled: true, editModel: null },
      { id: 'string-row-model', name: 'string-row-model', enabled: true, editModel: null },
    ])
  })

  it('reads back a per-row edit model from a persisted catalog', async () => {
    providerRows = [{
      ...defaultProviderRow,
      model_catalog: [
        { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true, editModel: 'gpt-image-edit' },
        { id: 'flux-pro', name: 'FLUX Pro', enabled: true },
      ],
    }]
    const { listProviderSettings } = await import('../backend/gateway/src/services/provider-settings')

    const result = await listProviderSettings({ refresh: true })

    expect(result.providers[0].modelCatalog).toEqual([
      { id: 'gpt-image-2', name: 'GPT Image 2', enabled: true, editModel: 'gpt-image-edit' },
      { id: 'flux-pro', name: 'FLUX Pro', enabled: true, editModel: null },
    ])
  })

  it('skips disabled catalog entries when picking the default image model', async () => {
    providerRows = [{ ...defaultProviderRow, model_catalog: [] }]
    const { updateProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await updateProviderSetting('11111111-1111-4111-8111-111111111111', {
      modelCatalog: [
        { id: 'legacy-image-1', name: 'Legacy', enabled: false },
        { id: 'gpt-image-3', name: 'GPT Image 3', enabled: true },
      ],
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(updatedRow).toMatchObject({ image_model: 'gpt-image-3' })
  })

  it('allows an image provider to keep every catalog entry disabled', async () => {
    providerRows = [{ ...defaultProviderRow, model_catalog: [] }]
    const { updateProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await expect(updateProviderSetting('11111111-1111-4111-8111-111111111111', {
      modelCatalog: [{ id: 'gpt-image-2', name: 'GPT Image 2', enabled: false }],
    }, { id: 'admin-user', email: 'admin@example.test' })).resolves.toBeTruthy()

    expect(updatedRow).toMatchObject({
      model_catalog: [{ id: 'gpt-image-2', name: 'GPT Image 2', enabled: false }],
      image_model: null,
    })
  })

  it('keeps a legacy image_model intact when an un-migrated image provider is updated', async () => {
    // Rows written before the catalog backfill only carry image_model. A partial
    // update must not blank it out (the admin UI reads image_model as a fallback).
    providerRows = [{
      ...defaultProviderRow,
      models: [],
      model_catalog: [],
      image_model: 'legacy-image-model',
    }]
    const { updateProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await updateProviderSetting('11111111-1111-4111-8111-111111111111', {
      notes: 'touched',
    }, { id: 'admin-user', email: 'admin@example.test' })

    expect(updatedRow).toMatchObject({ notes: 'touched' })
    expect(updatedRow).not.toHaveProperty('image_model')
    expect(updatedRow).not.toHaveProperty('models')
    expect(updatedRow).not.toHaveProperty('model_catalog')
  })

  it('rejects empty or invalid chat model lists during partial updates', async () => {
    providerRows = [{ ...defaultProviderRow, kind: 'chat', default_model: 'gpt-4o', models: ['gpt-4o'] }]
    const { updateProviderSetting } = await import('../backend/gateway/src/services/provider-settings')

    await expect(updateProviderSetting('11111111-1111-4111-8111-111111111111', {
      models: [],
    }, { id: 'admin-user', email: 'admin@example.test' })).rejects.toMatchObject({ message: 'chat_provider_models_required' })
    await expect(updateProviderSetting('11111111-1111-4111-8111-111111111111', {
      models: ['gpt+unsafe'],
    }, { id: 'admin-user', email: 'admin@example.test' })).rejects.toMatchObject({ message: 'invalid_chat_model' })
  })

  it('falls back to legacy provider queries when the models column is missing', async () => {
    modelsColumnAvailable = false
    const { encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')
    providerRows = [{
      ...defaultProviderRow,
      kind: 'chat',
      default_model: 'gpt-4o',
      api_key_encrypted: encryptSecret('sk-legacy-runtime-secret'),
    }]
    const { getRuntimeChatProvider, listProviderSettings } = await import('../backend/gateway/src/services/provider-settings')

    await expect(getRuntimeChatProvider('gpt-4o', { strict: true })).resolves.toMatchObject({ defaultModel: 'gpt-4o' })
    await expect(listProviderSettings({ refresh: true })).resolves.toMatchObject({ tableAvailable: true })
  })

  it('retains the legacy models column when only model_catalog is missing', async () => {
    modelCatalogColumnAvailable = false
    const { encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')
    providerRows = [{
      ...defaultProviderRow,
      kind: 'chat',
      models: ['gpt-4o', 'gpt-5.5'],
      default_model: 'gpt-4o',
      api_key_encrypted: encryptSecret('sk-legacy-models-secret'),
    }]
    const { getRuntimeChatProvider, listProviderSettings } = await import('../backend/gateway/src/services/provider-settings')

    const settings = await listProviderSettings({ refresh: true })
    expect(settings.providers.find(provider => provider.id === defaultProviderRow.id)).toMatchObject({
      models: ['gpt-4o', 'gpt-5.5'],
    })
    await expect(getRuntimeChatProvider('gpt-5.5', { strict: true })).resolves.toMatchObject({
      models: ['gpt-4o', 'gpt-5.5'],
      resolvedModel: 'gpt-5.5',
    })
  })

  it('retains model_catalog when only the legacy models column is missing', async () => {
    modelsColumnAvailable = false
    const { encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')
    providerRows = [{
      ...defaultProviderRow,
      kind: 'chat',
      model_catalog: [{ id: 'vendor/fast-v1', name: 'Fast Chat', enabled: true }],
      default_model: 'vendor/fast-v1',
      api_key_encrypted: encryptSecret('sk-catalog-secret'),
    }]
    const { getRuntimeChatProvider } = await import('../backend/gateway/src/services/provider-settings')

    await expect(getRuntimeChatProvider('Fast Chat', { strict: true })).resolves.toMatchObject({
      models: ['vendor/fast-v1'],
      resolvedModel: 'vendor/fast-v1',
    })
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

  it('routes each configured model to the provider that explicitly lists it', async () => {
    const { encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')
    providerRows = [
      {
        id: '22222222-2222-4222-8222-222222222222',
        kind: 'chat',
        name: 'First OpenAI Compatible',
        base_url: 'https://first.example.test/v1',
        models: ['gpt-4o-mini', 'gpt-4o'],
        enabled: true,
        priority: 10,
        timeout_ms: 60000,
        retry_count: 2,
        api_key_encrypted: encryptSecret('sk-first-secret'),
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'chat',
        name: 'Second OpenAI Compatible',
        base_url: 'https://second.example.test/v1',
        models: ['gpt-5.5'],
        enabled: true,
        priority: 20,
        timeout_ms: 60000,
        retry_count: 2,
        api_key_encrypted: encryptSecret('sk-second-secret'),
      },
    ]
    const { getRuntimeChatProvider } = await import('../backend/gateway/src/services/provider-settings')

    await expect(getRuntimeChatProvider('gpt-5.5', { strict: true })).resolves.toMatchObject({
      name: 'Second OpenAI Compatible',
      baseUrl: 'https://second.example.test/v1',
      models: ['gpt-5.5'],
    })
  })

  it('groups duplicate display names and routes the canonical model by priority', async () => {
    const { encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')
    providerRows = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        kind: 'chat',
        name: 'Primary Chat',
        base_url: 'https://primary.example.test/v1',
        model_catalog: [{ id: 'vendor/fast-v1', name: 'Fast Chat', enabled: true }],
        enabled: true,
        priority: 10,
        api_key_encrypted: encryptSecret('sk-primary-secret'),
      },
      {
        id: '66666666-6666-4666-8666-666666666666',
        kind: 'chat',
        name: 'Backup Chat',
        base_url: 'https://backup.example.test/v1',
        model_catalog: [{ id: 'backup/fast-v1', name: 'Fast Chat', enabled: true }],
        enabled: true,
        priority: 20,
        api_key_encrypted: encryptSecret('sk-backup-secret'),
      },
    ]
    const { getRuntimeChatProvider } = await import('../backend/gateway/src/services/provider-settings')

    await expect(getRuntimeChatProvider('vendor/fast-v1', { strict: true })).resolves.toMatchObject({
      name: 'Primary Chat',
      resolvedModel: 'vendor/fast-v1',
    })
    await expect(getRuntimeChatProvider('Fast Chat', { strict: true })).resolves.toMatchObject({
      name: 'Primary Chat',
      resolvedModel: 'vendor/fast-v1',
    })
  })

  it('falls back to the next priority provider when the canonical provider key is invalid', async () => {
    const { encryptSecret } = await import('../backend/gateway/src/services/secret-crypto')
    providerRows = [
      {
        id: '77777777-7777-4777-8777-777777777777',
        kind: 'chat',
        name: 'Primary Chat',
        base_url: 'https://primary.example.test/v1',
        model_catalog: [{ id: 'vendor/fast-v1', name: 'Fast Chat', enabled: true }],
        enabled: true,
        priority: 10,
        api_key_encrypted: 'v1.aes-256-gcm.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA',
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        kind: 'chat',
        name: 'Backup Chat',
        base_url: 'https://backup.example.test/v1',
        model_catalog: [{ id: 'backup/fast-v1', name: 'Fast Chat', enabled: true }],
        enabled: true,
        priority: 20,
        api_key_encrypted: encryptSecret('sk-backup-secret'),
      },
    ]
    const { getRuntimeChatProvider } = await import('../backend/gateway/src/services/provider-settings')

    await expect(getRuntimeChatProvider('vendor/fast-v1', { strict: true })).resolves.toMatchObject({
      name: 'Backup Chat',
      resolvedModel: 'backup/fast-v1',
      apiKey: 'sk-backup-secret',
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

  it('throws in strict mode when the matching chat provider cannot be decrypted', async () => {
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
    ]
    const { getRuntimeChatProvider } = await import('../backend/gateway/src/services/provider-settings')

    await expect(getRuntimeChatProvider('gpt-4o', { strict: true })).rejects.toMatchObject({
      message: 'runtime_chat_provider_unavailable',
      status: 503,
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
