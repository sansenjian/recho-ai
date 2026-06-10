import {
  IMAGE_GEN_API_KEY,
  SUPABASE_IMAGE_BUCKET,
} from '../config.js'
import {
  getSupabaseAdminClient,
  hasSupabaseAdminConfig,
  hasSupabaseConfig,
} from '../clients/supabase.js'
import { getAdminAccessSummary, getAppSettings } from './app-settings.js'

type SystemStatus = 'ok' | 'warning' | 'error'
type TableStatus = 'ok' | 'missing' | 'restricted' | 'error' | 'unavailable'

interface AdminTableDefinition {
  key: string
  label: string
  table: string
}

export interface AdminSystemTableStatus {
  key: string
  label: string
  status: TableStatus
  count: number | null
  message: string
}

export interface AdminSystemStatus {
  generatedAt: string
  status: SystemStatus
  config: {
    supabase: {
      publicConfigured: boolean
      adminConfigured: boolean
      imageBucketConfigured: boolean
    }
    imageGeneration: {
      apiKeyConfigured: boolean
      creditCostPerImage: number
      analyticsEnabled: boolean
    }
    adminUsers: {
      configured: boolean
      userIdCount: number
      emailCount: number
      databaseCount: number
      envUserIdCount: number
      envEmailCount: number
      tableAvailable: boolean
    }
  }
  data: {
    tables: AdminSystemTableStatus[]
  }
  warnings: string[]
}

const ADMIN_TABLES: AdminTableDefinition[] = [
  { key: 'creditBalances', label: '用户额度', table: 'user_credit_balances' },
  { key: 'creditCodes', label: '兑换码', table: 'credit_redemption_codes' },
  { key: 'creditTransactions', label: '额度流水', table: 'credit_transactions' },
  { key: 'imageGenerations', label: '生图记录', table: 'image_generations' },
  { key: 'imageAttempts', label: '生图尝试', table: 'image_generation_attempts' },
  { key: 'imageContexts', label: '画布上下文', table: 'image_generation_contexts' },
  { key: 'imageEvents', label: '图片事件', table: 'image_events' },
  { key: 'appSettings', label: '运行时配置', table: 'app_settings' },
  { key: 'adminUsers', label: '后台管理员', table: 'admin_users' },
]

function normalizedCount(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null
}

export function tableStatusFromError(error: unknown): Pick<AdminSystemTableStatus, 'status' | 'message'> {
  const code = String((error as any)?.code || '')
  const message = String((error as any)?.message || '')

  if (code === '42P01' || /relation .* does not exist|table .* does not exist/i.test(message)) {
    return { status: 'missing', message: '数据表不存在' }
  }

  if (code === '42501' || /permission|not authorized|row-level|rls/i.test(message)) {
    return { status: 'restricted', message: '权限不足' }
  }

  return { status: 'error', message: '检查失败' }
}

export function summarizeAdminSystemStatus(input: {
  generatedAt?: Date
  tables: AdminSystemTableStatus[]
  supabasePublicConfigured?: boolean
  supabaseAdminConfigured?: boolean
  supabaseImageBucketConfigured?: boolean
  imageApiKeyConfigured?: boolean
  imageCreditCostPerImage?: number
  imageAnalyticsEnabled?: boolean
  adminUserIdCount?: number
  adminEmailCount?: number
  adminDatabaseCount?: number
  adminEnvUserIdCount?: number
  adminEnvEmailCount?: number
  adminUsersTableAvailable?: boolean
}): AdminSystemStatus {
  const adminUserIdCount = normalizedCount(input.adminUserIdCount) ?? 0
  const adminEmailCount = normalizedCount(input.adminEmailCount) ?? 0
  const adminDatabaseCount = normalizedCount(input.adminDatabaseCount) ?? 0
  const adminEnvUserIdCount = normalizedCount(input.adminEnvUserIdCount) ?? 0
  const adminEnvEmailCount = normalizedCount(input.adminEnvEmailCount) ?? 0
  const adminConfigured = adminUserIdCount + adminEmailCount > 0
  const tables = input.tables
  const unreadableTables = tables.filter(table => table.status !== 'ok')

  const warnings = [
    input.supabasePublicConfigured ? '' : 'Supabase 公共配置未就绪',
    input.supabaseAdminConfigured ? '' : 'Supabase 后端权限未就绪',
    input.supabaseImageBucketConfigured ? '' : '图片存储桶未配置',
    input.imageApiKeyConfigured ? '' : '生图服务 key 未配置',
    adminConfigured ? '' : '后台管理员未配置',
    unreadableTables.length ? `${unreadableTables.length} 个后台数据表不可读` : '',
  ].filter(Boolean)

  const hasBlockingConfigIssue = !input.supabaseAdminConfigured || !adminConfigured
  const status: SystemStatus = hasBlockingConfigIssue
    ? 'error'
    : warnings.length
      ? 'warning'
      : 'ok'

  return {
    generatedAt: (input.generatedAt || new Date()).toISOString(),
    status,
    config: {
      supabase: {
        publicConfigured: Boolean(input.supabasePublicConfigured),
        adminConfigured: Boolean(input.supabaseAdminConfigured),
        imageBucketConfigured: Boolean(input.supabaseImageBucketConfigured),
      },
      imageGeneration: {
        apiKeyConfigured: Boolean(input.imageApiKeyConfigured),
        creditCostPerImage: Math.max(1, Math.round(Number(input.imageCreditCostPerImage) || 1)),
        analyticsEnabled: Boolean(input.imageAnalyticsEnabled),
      },
      adminUsers: {
        configured: adminConfigured,
        userIdCount: adminUserIdCount,
        emailCount: adminEmailCount,
        databaseCount: adminDatabaseCount,
        envUserIdCount: adminEnvUserIdCount,
        envEmailCount: adminEnvEmailCount,
        tableAvailable: input.adminUsersTableAvailable !== false,
      },
    },
    data: {
      tables,
    },
    warnings,
  }
}

async function checkAdminTable(definition: AdminTableDefinition): Promise<AdminSystemTableStatus> {
  const client = getSupabaseAdminClient()
  if (!client) {
    return {
      key: definition.key,
      label: definition.label,
      status: 'unavailable',
      count: null,
      message: '服务未配置',
    }
  }

  const { count, error } = await client
    .from(definition.table)
    .select('*', { count: 'exact', head: true })

  if (error) {
    const status = tableStatusFromError(error)
    return {
      key: definition.key,
      label: definition.label,
      status: status.status,
      count: null,
      message: status.message,
    }
  }

  return {
    key: definition.key,
    label: definition.label,
    status: 'ok',
    count: normalizedCount(count),
    message: '正常',
  }
}

export async function getAdminSystemStatus() {
  const [tables, settings, adminAccess] = await Promise.all([
    Promise.all(ADMIN_TABLES.map(checkAdminTable)),
    getAppSettings(),
    getAdminAccessSummary(),
  ])

  return summarizeAdminSystemStatus({
    tables,
    supabasePublicConfigured: hasSupabaseConfig(),
    supabaseAdminConfigured: hasSupabaseAdminConfig(),
    supabaseImageBucketConfigured: Boolean(SUPABASE_IMAGE_BUCKET.trim()),
    imageApiKeyConfigured: Boolean(IMAGE_GEN_API_KEY),
    imageCreditCostPerImage: settings.imageCreditCostPerImage,
    imageAnalyticsEnabled: settings.imageAnalyticsEnabled,
    adminUserIdCount: adminAccess.userIdCount,
    adminEmailCount: adminAccess.emailCount,
    adminDatabaseCount: adminAccess.databaseCount,
    adminEnvUserIdCount: adminAccess.envUserIdCount,
    adminEnvEmailCount: adminAccess.envEmailCount,
    adminUsersTableAvailable: adminAccess.tableAvailable,
  })
}
