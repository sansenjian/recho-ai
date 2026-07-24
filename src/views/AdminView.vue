<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, type Component } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Coins,
  Globe,
  Image,
  LayoutDashboard,
  Megaphone,
  Moon,
  Server,
  Settings,
  Sun,
  Zap,
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { adminApiJson } from '../composables/useAdminApi'
import { useAuthSession } from '../composables/useAuthSession'
import { publicClientErrorMessage } from '../lib/safe-error'
import type { AdminRole } from '../types/admin'

const AdminOverviewPanel = defineAsyncComponent(() => import('../components/admin/AdminOverviewPanel.vue'))
const AdminCreditsPanel = defineAsyncComponent(() => import('../components/admin/AdminCreditsPanel.vue'))
const AdminImagesViewPanel = defineAsyncComponent(() => import('../components/admin/AdminImagesViewPanel.vue'))
const AdminAttemptsViewPanel = defineAsyncComponent(() => import('../components/admin/AdminAttemptsViewPanel.vue'))
const AdminSystemPanel = defineAsyncComponent(() => import('../components/admin/AdminSystemPanel.vue'))
const AdminAnnouncementsPanel = defineAsyncComponent(() => import('../components/admin/AdminAnnouncementsPanel.vue'))
const AdminSettingsPanel = defineAsyncComponent(() => import('../components/admin/AdminSettingsPanel.vue'))

type AdminMode = 'visual' | 'manage'
type AdminViewId = 'overview' | 'credits' | 'images' | 'monitor' | 'system' | 'announcements' | 'settings'

const { t, locale } = useI18n()
const { user, userEmail, isAuthReady, initAuth } = useAuthSession()
const activeView = ref<AdminViewId>('overview')
const sidebarCollapsed = ref(false)
const isDark = ref(false)
const adminMode = ref<AdminMode>('visual')
const adminChecked = ref(false)
const isAdmin = ref(false)
const currentAdminRole = ref<AdminRole>('operator')
const errorMessage = ref('')
const refreshVersions = ref({ overview: 0, system: 0 })

const navItems: Array<{ id: AdminViewId; labelKey: string; icon: Component }> = [
  { id: 'overview', labelKey: 'nav.overview', icon: LayoutDashboard },
  { id: 'credits', labelKey: 'nav.credits', icon: Coins },
  { id: 'images', labelKey: 'nav.images', icon: Image },
  { id: 'monitor', labelKey: 'nav.monitor', icon: Activity },
  { id: 'system', labelKey: 'nav.system', icon: Server },
  { id: 'announcements', labelKey: 'nav.announcements', icon: Megaphone },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings },
]
const panelComponents: Record<AdminViewId, Component> = {
  overview: AdminOverviewPanel,
  credits: AdminCreditsPanel,
  images: AdminImagesViewPanel,
  monitor: AdminAttemptsViewPanel,
  system: AdminSystemPanel,
  announcements: AdminAnnouncementsPanel,
  settings: AdminSettingsPanel,
}
const activePanel = computed(() => panelComponents[activeView.value])
const activePanelProps = computed(() => {
  if (activeView.value === 'overview') return { refreshVersion: refreshVersions.value.overview }
  if (activeView.value === 'system') return { refreshVersion: refreshVersions.value.system }
  if (activeView.value === 'images') return { adminMode: adminMode.value }
  return {}
})

function toggleSidebar() { sidebarCollapsed.value = !sidebarCollapsed.value }
function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
}
function toggleLocale() { locale.value = locale.value === 'zh' ? 'en' : 'zh' }
function handleDataChanged(source: 'credits' | 'images' | 'announcements' | 'settings') {
  if (source === 'credits') refreshVersions.value.overview += 1
  if (source === 'images') {
    refreshVersions.value.overview += 1
    refreshVersions.value.system += 1
  }
  if (source === 'announcements') refreshVersions.value.system += 1
  if (source === 'settings') {
    refreshVersions.value.overview += 1
    refreshVersions.value.system += 1
  }
}

async function checkAdmin() {
  errorMessage.value = ''
  adminChecked.value = false
  try {
    const data = await adminApiJson<{ admin: boolean; currentAdminRole?: AdminRole | null }>('/api/admin/credits/me')
    currentAdminRole.value = data.currentAdminRole || 'operator'
    isAdmin.value = Boolean(data.admin)
  } catch (error) {
    isAdmin.value = false
    errorMessage.value = publicClientErrorMessage(error, '当前账号没有后台权限。')
  } finally {
    adminChecked.value = true
  }
}

onMounted(async () => {
  await initAuth()
  await checkAdmin()
})
</script>

<template>
  <div class="flex min-h-screen text-sm transition-colors duration-150" :class="{ dark: isDark }">
    <aside class="fixed inset-y-0 left-0 z-20 flex flex-col overflow-hidden border-r border-border bg-[var(--surface)] transition-[width] duration-150" :class="sidebarCollapsed ? 'w-16' : 'w-[240px] max-lg:w-16'">
      <div class="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 max-lg:justify-center max-lg:px-0">
        <div class="flex min-w-0 items-center gap-2.5"><Zap class="h-6 w-6 shrink-0" /><span v-show="!sidebarCollapsed" class="whitespace-nowrap text-[15px] font-semibold max-lg:hidden">Recho Admin</span></div>
        <Button variant="ghost" size="icon-xs" class="shrink-0 max-lg:hidden" :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'" @click="toggleSidebar"><ChevronLeft v-if="!sidebarCollapsed" class="h-4 w-4" /><ChevronRight v-else class="h-4 w-4" /></Button>
      </div>

      <nav class="flex-1 overflow-y-auto p-2">
        <button v-for="item in navItems" :key="item.id" class="flex min-h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-md border-0 bg-transparent px-2.5 text-left text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]" :class="{ 'bg-[var(--hover-bg)] text-[var(--text-primary)] font-semibold': activeView === item.id }" @click="activeView = item.id"><component :is="item.icon" class="h-5 w-5 shrink-0" stroke-width="1.5" /><span v-show="!sidebarCollapsed" class="overflow-hidden text-ellipsis max-lg:hidden">{{ t(item.labelKey) }}</span></button>
      </nav>

      <div class="flex shrink-0 flex-col gap-0.5 border-t border-border p-2">
        <button class="flex min-h-8 w-full items-center gap-2.5 rounded-md bg-transparent px-2.5 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]" @click="toggleLocale"><Globe class="h-4 w-4" /><span v-show="!sidebarCollapsed" class="max-lg:hidden">{{ locale === 'zh' ? '中文' : 'EN' }}</span></button>
        <button class="flex min-h-8 w-full items-center gap-2.5 rounded-md bg-transparent px-2.5 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]" @click="toggleTheme"><Moon v-if="!isDark" class="h-4 w-4" /><Sun v-else class="h-4 w-4" /><span v-show="!sidebarCollapsed" class="max-lg:hidden">{{ isDark ? t('common.lightMode') : t('common.darkMode') }}</span></button>
        <div v-show="!sidebarCollapsed" class="flex gap-2 px-2.5 py-1.5 max-lg:hidden"><RouterLink to="/image" class="text-xs text-[var(--text-muted)] no-underline hover:text-[var(--text-primary)]">{{ t('nav.canvas') }}</RouterLink><RouterLink to="/works" class="text-xs text-[var(--text-muted)] no-underline hover:text-[var(--text-primary)]">{{ t('nav.works') }}</RouterLink></div>
        <div v-if="user && !sidebarCollapsed" class="mt-1 flex items-center gap-2.5 border-t border-border p-2 max-lg:hidden"><div class="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-[var(--bubble-bg)] text-xs font-semibold">{{ (userEmail || 'A').charAt(0).toUpperCase() }}</div><div class="flex min-w-0 flex-col"><span class="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium">{{ userEmail || 'Admin' }}</span><span class="text-[11px] text-[var(--text-muted)]">{{ currentAdminRole === 'senior' ? t('settings.seniorAdmin') : t('settings.operator') }}</span></div></div>
      </div>
    </aside>

    <div class="min-w-0 flex-1 transition-[margin-left] duration-150" :class="sidebarCollapsed ? 'ml-16' : 'ml-[240px] max-lg:ml-16'">
      <header class="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-[var(--header-bg)] px-6 backdrop-blur-md max-md:px-4">
        <div class="flex items-center gap-4"><h1 class="text-base font-semibold">{{ t(`nav.${activeView}`) }}</h1><div class="flex gap-0.5 rounded-md border border-border bg-[var(--bubble-bg)] p-0.5" role="group"><button class="rounded-[calc(var(--radius)-2px)] bg-transparent px-3 py-1 text-xs font-medium text-[var(--text-muted)]" :class="{ 'bg-[var(--surface)] text-[var(--text-primary)] shadow-sm': adminMode === 'visual' }" @click="adminMode = 'visual'">{{ t('mode.visual') }}</button><button class="rounded-[calc(var(--radius)-2px)] bg-transparent px-3 py-1 text-xs font-medium text-[var(--text-muted)]" :class="{ 'bg-[var(--surface)] text-[var(--text-primary)] shadow-sm': adminMode === 'manage' }" @click="adminMode = 'manage'">{{ t('mode.manage') }}</button></div></div>
      </header>

      <div v-if="!isAuthReady || !adminChecked" class="flex min-h-[400px] flex-col items-center justify-center gap-3 text-center"><span class="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" /><strong>{{ t('auth.checking') }}</strong></div>
      <div v-else-if="!user" class="flex min-h-[400px] flex-col items-center justify-center gap-3 text-center"><strong>{{ t('auth.loginRequired') }}</strong><RouterLink to="/image" class="inline-flex min-h-8 items-center justify-center rounded-md border border-border bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--text-primary)] no-underline">{{ t('auth.loginLink') }}</RouterLink></div>
      <div v-else-if="!isAdmin" class="flex min-h-[400px] flex-col items-center justify-center gap-3 text-center"><strong>{{ errorMessage || t('auth.noAccess') }}</strong><span class="text-[var(--text-muted)]">{{ userEmail }}</span></div>

      <main v-else class="mx-auto w-full max-w-[1400px] p-6 max-md:p-4">
        <KeepAlive>
          <component :is="activePanel" v-bind="activePanelProps" @data-changed="handleDataChanged" @role-changed="currentAdminRole = $event" />
        </KeepAlive>
      </main>
    </div>
  </div>
</template>
