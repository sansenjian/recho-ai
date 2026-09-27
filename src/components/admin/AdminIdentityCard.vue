<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShieldCheck, User } from '@lucide/vue'
import type { AdminRole } from '../../types/admin'

/**
 * 侧栏底部的管理员身份卡。抽出来是为了让角色文案走同一处判断：
 * 此前它内联在 AdminView 的侧栏里，只翻到 settings.seniorAdmin / settings.operator。
 */
const props = defineProps<{
  email: string
  role: AdminRole
  collapsed?: boolean
}>()

const { t } = useI18n()

const initial = computed(() => (props.email || 'A').charAt(0).toUpperCase())
const roleLabel = computed(() => (props.role === 'senior' ? t('settings.seniorAdmin') : t('settings.operator')))
</script>

<template>
  <div
    v-if="!collapsed"
    data-slot="admin-identity-card"
    class="mt-1 flex items-center gap-2.5 border-t border-border p-2 max-lg:hidden"
  >
    <div class="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-[var(--bubble-bg)] text-xs font-semibold">
      {{ initial }}
    </div>
    <div class="flex min-w-0 flex-1 flex-col">
      <span class="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium">
        <User class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        {{ email || t('settings.adminAccount') }}
      </span>
      <span
        class="flex items-center gap-1 text-[11px] text-[var(--text-muted)]"
        :title="roleLabel"
        data-slot="admin-identity-role"
      >
        <ShieldCheck class="h-3 w-3 shrink-0" aria-hidden="true" />
        {{ roleLabel }}
      </span>
    </div>
  </div>
</template>
