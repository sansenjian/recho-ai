<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { adminApiJson } from '../../composables/useAdminApi'
import { useConfirmAction } from '../../composables/useConfirmAction'
import ConfirmDialog from './ConfirmDialog.vue'
import type { AdminAccessSummary, AdminUserRule } from '../../types/admin'
import { adminErrorMessage, dateTime, shortId } from '../../utils/admin-format'

/**
 * 管理员用户规则面板。
 *
 * 从运行时配置里拆出来：它读写的接口、权限门槛与错误语义都和配置表单无关，
 * 只是共用同一个页面容器。自己管理加载态与提示，父组件只关心是否需要刷新。
 */
const props = defineProps<{
  rules: readonly AdminUserRule[]
  access: AdminAccessSummary | null
  /** 只有高级管理员能增删规则。 */
  canManage: boolean
  loading: boolean
}>()

const emit = defineEmits<{
  refresh: []
  error: [message: string]
  notice: [message: string]
  /** 面板自己发起写入后会拿到最新列表，回传给父组件即可，不必整页刷新。 */
  updated: [payload: { adminUsers: AdminUserRule[]; adminAccess: AdminAccessSummary }]
}>()

const { t } = useI18n()
const actionLoading = ref(false)
const actionId = ref<string | null>(null)
const confirm = useConfirmAction()
const form = ref({ userId: '', email: '', note: '' })

/** 环境变量来源的规则也算在内，总数才是管理员看到的规模。 */
const total = computed(() => props.access
  ? props.access.databaseCount + props.access.envUserIdCount + props.access.envEmailCount
  : props.rules.length)

function identity(rule: AdminUserRule) {
  const userId = rule.userId ? `id: ${shortId(rule.userId)}` : ''
  return [rule.email, userId].filter(Boolean).join(' / ') || '-'
}

function sourceLabel(rule: AdminUserRule) {
  return rule.source === 'env' ? t('settings.sourceEnv') : t('settings.sourceDb')
}

function roleLabel(rule: AdminUserRule) {
  return rule.source === 'env' || rule.role === 'senior' ? t('settings.seniorAdmin') : t('settings.operator')
}

async function createRule() {
  actionLoading.value = true
  try {
    const data = await adminApiJson<{ adminUsers: AdminUserRule[]; adminAccess: AdminAccessSummary }>(
      '/api/admin/settings/admin-users',
      {
        method: 'POST',
        body: JSON.stringify({
          userId: form.value.userId.trim(),
          email: form.value.email.trim(),
          note: form.value.note.trim(),
        }),
      },
    )
    form.value = { userId: '', email: '', note: '' }
    emit('notice', t('settings.ruleAdded'))
    emit('updated', data)
  } catch (error) {
    emit('error', adminErrorMessage(error, t('feedback.operationFailed')))
  } finally {
    actionLoading.value = false
  }
}

async function applyEnabled(rule: AdminUserRule) {
  const next = !rule.enabled
  actionId.value = rule.id
  try {
    const data = await adminApiJson<{ adminUsers: AdminUserRule[]; adminAccess: AdminAccessSummary }>(
      `/api/admin/settings/admin-users/${encodeURIComponent(rule.id)}`,
      { method: 'PATCH', body: JSON.stringify({ enabled: next }) },
    )
    emit('notice', next ? t('settings.ruleEnabled') : t('settings.ruleDisabled'))
    emit('updated', data)
  } catch (error) {
    emit('error', adminErrorMessage(error, t('feedback.operationFailed')))
  } finally {
    actionId.value = null
  }
}

/** 停用要二次确认：它是唯一会让当前管理员失去权限的操作。 */
function toggleRule(rule: AdminUserRule) {
  if (rule.enabled) {
    confirm.request(() => applyEnabled(rule))
    return
  }
  void applyEnabled(rule)
}
</script>

<template>
  <div class="rounded-md border border-border bg-[var(--surface)] p-5 shadow-sm">
    <div class="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold">{{ t('settings.adminUsers') }}</h2>
        <span class="text-xs text-[var(--text-muted)]">{{ total }}</span>
      </div>
      <Button variant="outline" size="sm" :disabled="loading" @click="emit('refresh')">{{ t('common.refresh') }}</Button>
    </div>

    <form v-if="canManage" class="mb-4 flex flex-wrap items-end gap-2" @submit.prevent="createRule">
      <label class="flex min-w-[160px] flex-1 flex-col gap-1">
        <span class="text-xs text-[var(--text-muted)]">{{ t('settings.adminUserId') }}</span>
        <Input id="admin-user-id" v-model.trim="form.userId" :placeholder="t('settings.adminUserId')" class="min-h-[30px] text-xs" />
      </label>
      <label class="flex min-w-[160px] flex-1 flex-col gap-1">
        <span class="text-xs text-[var(--text-muted)]">{{ t('settings.adminEmail') }}</span>
        <Input id="admin-user-email" v-model.trim="form.email" type="email" :placeholder="t('settings.adminEmail')" class="min-h-[30px] text-xs" />
      </label>
      <label class="flex min-w-[160px] flex-1 flex-col gap-1">
        <span class="text-xs text-[var(--text-muted)]">{{ t('settings.adminNote') }}</span>
        <Input id="admin-user-note" v-model.trim="form.note" :placeholder="t('settings.adminNote')" class="min-h-[30px] text-xs" />
      </label>
      <Button type="submit" :disabled="actionLoading">{{ t('common.add') }}</Button>
    </form>
    <p v-else class="mb-3 text-[13px] text-[var(--text-muted)]">{{ t('settings.noManagePermission') }}</p>

    <div class="w-full overflow-x-auto rounded-md border border-border">
      <table class="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th
              v-for="heading in [t('settings.adminTable.account'), t('settings.adminTable.level'), t('settings.adminTable.source'), t('settings.adminTable.status'), t('settings.adminTable.updated'), t('settings.adminTable.actions')]"
              :key="heading"
              class="border-b border-border bg-[var(--surface-soft)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--text-secondary)]"
            >
              {{ heading }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="rule in rules" :key="rule.id" class="border-b border-border">
            <td class="px-3 py-2">{{ identity(rule) }}</td>
            <td class="px-3 py-2"><Badge variant="secondary">{{ roleLabel(rule) }}</Badge></td>
            <td class="px-3 py-2 text-xs">{{ sourceLabel(rule) }}</td>
            <td class="px-3 py-2" :class="rule.enabled ? 'text-success' : 'text-danger'">
              {{ rule.enabled ? t('settings.statusEnabled') : t('settings.statusDisabled') }}
            </td>
            <td class="px-3 py-2 text-xs">{{ dateTime(rule.updatedAt) }}</td>
            <td class="px-3 py-2">
              <Button
                variant="ghost"
                size="sm"
                :disabled="!canManage || rule.source !== 'database' || actionId === rule.id"
                @click="toggleRule(rule)"
              >
                {{ rule.enabled ? t('common.disable') : t('common.enable') }}
              </Button>
            </td>
          </tr>
          <tr v-if="!rules.length">
            <td colspan="6" class="px-3 py-6 text-center text-[var(--text-muted)]">{{ t('settings.noRules') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ConfirmDialog
      v-model:open="confirm.open.value"
      :title="t('settings.confirmDisableRuleTitle')"
      :description="t('settings.confirmDisableRuleDetail')"
      :confirm-label="t('settings.confirmDisableRuleAction')"
      destructive
      @confirm="confirm.confirm()"
    />
  </div>
</template>
