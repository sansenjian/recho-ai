import { Router, Request, Response } from 'express'
import { AdminCreditError, assertAdminUser } from '../services/admin-credits.js'
import { getAdminSystemStatus } from '../services/admin-system.js'
import {
  AppSettingsError,
  type AdminUserRule,
  assertSeniorAdminUser,
  createAdminUserRule,
  getAdminAccessSummary,
  getAdminUserRole,
  getAdminUserRules,
  getAppSettings,
  updateAdminUserRule,
  updateAppSettings,
} from '../services/app-settings.js'
import { getRequestUser } from '../services/request-auth.js'
import { publicErrorMessage, safeErrorDetail } from '../services/safe-error.js'

const router = Router()

function adminSystemErrorResponse(err: unknown, fallback = '系统状态加载失败，请稍后重试。') {
  if (err instanceof AdminCreditError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  if (err instanceof AppSettingsError) {
    return {
      status: err.status,
      error: err.publicMessage,
    }
  }

  return {
    status: typeof (err as any)?.status === 'number' ? (err as any).status : 500,
    error: publicErrorMessage(err, fallback),
  }
}

async function requireAdmin(req: Request) {
  const user = await getRequestUser(req)
  return await assertAdminUser(user)
}

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function maskRuleMatcher(value: string | null) {
  if (!value) return null
  if (value.includes('@')) {
    const [name, domain] = value.split('@')
    return `${name.slice(0, 2) || '*'}***@${domain || '***'}`
  }
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function publicAdminUserRules(rules: AdminUserRule[], currentAdminRole: Awaited<ReturnType<typeof getAdminUserRole>>) {
  if (currentAdminRole === 'senior') return rules
  return rules.map(rule => ({
    ...rule,
    userId: maskRuleMatcher(rule.userId),
    email: maskRuleMatcher(rule.email),
  }))
}

router.get('/admin/system', async (req: Request, res: Response) => {
  try {
    await requireAdmin(req)
    const system = await getAdminSystemStatus()
    res.json({ system })
  } catch (err) {
    console.error('[admin-system] status failed:', safeErrorDetail(err))
    const response = adminSystemErrorResponse(err, '系统状态加载失败，请稍后重试。')
    res.status(response.status).json({ error: response.error })
  }
})

router.get('/admin/settings', async (req: Request, res: Response) => {
  try {
    const adminUser = await requireAdmin(req)
    const [settings, adminUsers, adminAccess] = await Promise.all([
      getAppSettings({ refresh: true }),
      getAdminUserRules({ refresh: true }),
      getAdminAccessSummary({ refresh: true }),
    ])
    const currentAdminRole = await getAdminUserRole(adminUser)
    res.json({
      settings,
      adminUsers: publicAdminUserRules(adminUsers, currentAdminRole),
      adminAccess,
      currentAdminRole,
    })
  } catch (err) {
    console.error('[admin-settings] load failed:', safeErrorDetail(err))
    const response = adminSystemErrorResponse(err, '配置加载失败，请稍后重试。')
    res.status(response.status).json({ error: response.error })
  }
})

router.patch('/admin/settings', async (req: Request, res: Response) => {
  try {
    const adminUser = await requireAdmin(req)
    const settings = await updateAppSettings(req.body || {}, adminUser)
    res.json({ settings })
  } catch (err) {
    console.error('[admin-settings] update failed:', safeErrorDetail(err))
    const response = adminSystemErrorResponse(err, '配置保存失败，请稍后重试。')
    res.status(response.status).json({ error: response.error })
  }
})

router.post('/admin/settings/admin-users', async (req: Request, res: Response) => {
  try {
    const adminUser = await requireAdmin(req)
    await assertSeniorAdminUser(adminUser)
    const rule = await createAdminUserRule(req.body || {}, adminUser)
    const [adminUsers, adminAccess] = await Promise.all([
      getAdminUserRules({ refresh: true }),
      getAdminAccessSummary({ refresh: true }),
    ])
    res.json({ rule, adminUsers, adminAccess })
  } catch (err) {
    console.error('[admin-settings] admin user create failed:', safeErrorDetail(err))
    const response = adminSystemErrorResponse(err, '管理员规则创建失败，请稍后重试。')
    res.status(response.status).json({ error: response.error })
  }
})

router.patch('/admin/settings/admin-users/:ruleId', async (req: Request, res: Response) => {
  try {
    const adminUser = await requireAdmin(req)
    await assertSeniorAdminUser(adminUser)
    const rule = await updateAdminUserRule(routeParam(req.params.ruleId), req.body || {}, adminUser)
    const [adminUsers, adminAccess] = await Promise.all([
      getAdminUserRules({ refresh: true }),
      getAdminAccessSummary({ refresh: true }),
    ])
    res.json({ rule, adminUsers, adminAccess })
  } catch (err) {
    console.error('[admin-settings] admin user update failed:', safeErrorDetail(err))
    const response = adminSystemErrorResponse(err, '管理员规则更新失败，请稍后重试。')
    res.status(response.status).json({ error: response.error })
  }
})

export default router
