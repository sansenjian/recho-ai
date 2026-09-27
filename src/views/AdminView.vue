<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, type Component } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  Activity,
  ArrowLeftFromLine,
  ChevronLeft,
  ChevronRight,
  Coins,
  Globe,
  Image,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  Moon,
  Server,
  Settings,
  Sun,
  Zap,
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import AdminIdentityCard from '../components/admin/AdminIdentityCard.vue'
import { adminApiJson } from '../composables/useAdminApi'
import { useAuthSession } from '../composables/useAuthSession'
import { adminErrorMessage } from '../utils/admin-format'
import type { AdminRole } from '../types/admin'

const AdminOverviewPanel = defineAsyncComponent(() => import('../components/admin/AdminOverviewPanel.vue'))
const AdminCreditsPanel = defineAsyncComponent(() => import('../components/admin/AdminCreditsPanel.vue'))
const AdminImagesViewPanel = defineAsyncComponent(() => import('../components/admin/AdminImagesViewPanel.vue'))
const AdminAttemptsViewPanel = defineAsyncComponent(() => import('../components/admin/AdminAttemptsViewPanel.vue'))
const AdminSystemPanel = defineAsyncComponent(() => import('../components/admin/AdminSystemPanel.vue'))
const AdminAnnouncementsPanel = defineAsyncComponent(() => import('../components/admin/AdminAnnouncementsPanel.vue'))
const AdminApiKeysPanel = defineAsyncComponent(() => import('../components/admin/AdminApiKeysPanel.vue'))
const AdminSettingsPanel = defineAsyncComponent(() => import('../components/admin/AdminSettingsPanel.vue'))

type AdminViewId = 'overview' | 'credits' | 'images' | 'monitor' | 'system' | 'announcements' | 'apiKeys' | 'runtime' | 'providers'

const { t, locale } = useI18n()
const { user, userEmail, isAuthReady, initAuth } = useAuthSession()
const activeView = ref<AdminViewId>('overview')
const sidebarCollapsed = ref(false)
const isDark = ref(false)
/** 破坏性操作默认关闭：图片面板的隐藏/归档/删除都必须先显式打开写权限。 */
const allowWrite = ref(false)
const adminChecked = ref(false)
const isAdmin = ref(false)
const currentAdminRole = ref<AdminRole>('operator')
const errorMessage = ref('')
const refreshVersions = ref({ overview: 0, system: 0 })

type NavGroupId = 'operations' | 'platform'

const navItems: Array<{ id: AdminViewId; labelKey: string; group: NavGroupId; icon: Component }> = [
  { id: 'overview', labelKey: 'nav.overview', group: 'operations', icon: LayoutDashboard },
  { id: 'credits', labelKey: 'nav.credits', group: 'operations', icon: Coins },
  { id: 'images', labelKey: 'nav.images', group: 'operations', icon: Image },
  { id: 'monitor', labelKey: 'nav.monitor', group: 'operations', icon: Activity },
  { id: 'announcements', labelKey: 'nav.announcements', group: 'operations', icon: Megaphone },
  { id: 'apiKeys', labelKey: 'nav.apiKeys', group: 'operations', icon: KeyRound },
  { id: 'system', labelKey: 'nav.system', group: 'platform', icon: Server },
  { id: 'runtime', labelKey: 'nav.runtime', group: 'platform', icon: Settings },
  { id: 'providers', labelKey: 'nav.providers', group: 'platform', icon: Server },
]

const navGroups: Array<{ id: NavGroupId; labelKey: string }> = [
  { id: 'operations', labelKey: 'nav.groupOperations' },
  { id: 'platform', labelKey: 'nav.groupPlatform' },
]

/** 按 navGroups 的顺序切分 navItems；空分组不下发标题，避免侧栏出现孤立的小节。 */
const navSections = computed(() => navGroups
  .map(group => ({
    id: group.id,
    labelKey: group.labelKey,
    items: navItems.filter(item => item.group === group.id),
  }))
  .filter(section => section.items.length > 0))

const panelComponents: Record<AdminViewId, Component> = {
  overview: AdminOverviewPanel,
  credits: AdminCreditsPanel,
  images: AdminImagesViewPanel,
  monitor: AdminAttemptsViewPanel,
  system: AdminSystemPanel,
  announcements: AdminAnnouncementsPanel,
  apiKeys: AdminApiKeysPanel,
  runtime: AdminSettingsPanel,
  providers: AdminSettingsPanel,
}
const activePanel = computed(() => panelComponents[activeView.value])
const activePanelProps = computed(() => {
  if (activeView.value === 'overview') return { refreshVersion: refreshVersions.value.overview }
  if (activeView.value === 'system') return { refreshVersion: refreshVersions.value.system }
  if (activeView.value === 'images') return { allowWrite: allowWrite.value }
  if (activeView.value === 'runtime') return { section: 'runtime' }
  if (activeView.value === 'providers') return { section: 'providers' }
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
    errorMessage.value = adminErrorMessage(error, t('feedback.noAccess'))
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
      <!-- 对齐 Codex 侧栏 .dcu-head：60px 高、grid 两列、右侧 28px 圆形图标按钮。 -->
      <div class="grid h-[60px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-2 pl-3 pr-2 max-lg:grid-cols-[minmax(0,1fr)] max-lg:justify-items-center max-lg:px-0">
        <div class="flex min-w-0 items-center overflow-hidden text-[var(--text-primary)]"><Zap class="h-6 w-6 shrink-0" /><span v-show="!sidebarCollapsed" class="ml-2.5 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold max-lg:hidden">Recho Admin</span></div>
        <Button variant="ghost" size="icon-sm" class="shrink-0 rounded-full max-lg:hidden" :title="sidebarCollapsed ? t('common.expand') : t('common.collapse')" @click="toggleSidebar"><ChevronLeft v-if="!sidebarCollapsed" class="h-4 w-4" /><ChevronRight v-else class="h-4 w-4" /></Button>
      </div>

      <!-- 对齐 Codex .dcu-menu / .dcu-settings-group-label：6px 侧内距、2px 行距、36px 行高、16px 图标。 -->
      <nav class="flex flex-1 flex-col overflow-y-auto px-1.5 pb-2 pt-0">
        <div v-for="(section, index) in navSections" :key="section.id" class="flex flex-col gap-0.5" :class="index > 0 ? 'mt-3' : ''">
          <span v-show="!sidebarCollapsed" class="mx-2 mb-1 mt-2 text-[12px] font-medium leading-5 text-[var(--text-muted)] max-lg:hidden" data-slot="nav-group-heading">{{ t(section.labelKey) }}</span>
          <button v-for="item in section.items" :key="item.id" class="flex min-h-9 w-full items-center gap-2 rounded-lg border-0 bg-transparent px-1 py-0 text-left text-sm font-normal leading-5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]" :class="{ 'bg-[var(--hover-bg)] font-semibold text-[var(--text-primary)]': activeView === item.id }" @click="activeView = item.id"><span class="grid h-5 w-5 shrink-0 place-items-center [place-items:center_start]"><component :is="item.icon" class="h-4 w-4 shrink-0" stroke-width="1.5" /></span><span v-show="!sidebarCollapsed" class="overflow-hidden text-ellipsis whitespace-nowrap max-lg:hidden">{{ t(item.labelKey) }}</span></button>
        </div>
      </nav>

      <!-- 底部 = Codex 的 .dcu-foot：离开后台的出口行 + settings 座位。行高/图标尺寸与上方菜单保持一致。 -->
      <div class="shrink-0 border-t border-border px-1.5 pb-2 pt-2">
        <!-- 出口行不参与折叠隐藏：折叠/窄屏时仍以图标兜底，避免失去返回前台的唯一入口。 -->
        <RouterLink data-slot="admin-exit-app" class="mb-1 flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-left text-sm leading-5 text-[var(--text-secondary)] no-underline transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]" to="/image" :title="t('nav.backToApp')"><span class="grid h-5 w-5 shrink-0 place-items-center [place-items:center_start]"><ArrowLeftFromLine class="h-4 w-4 shrink-0" stroke-width="1.5" /></span><span v-show="!sidebarCollapsed" class="overflow-hidden text-ellipsis whitespace-nowrap max-lg:hidden">{{ t('nav.backToApp') }}</span></RouterLink>
        <div class="flex flex-col gap-0.5">
          <button class="flex min-h-9 w-full items-center gap-2 rounded-lg bg-transparent px-1 text-left text-sm leading-5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]" @click="toggleLocale"><span class="grid h-5 w-5 shrink-0 place-items-center [place-items:center_start]"><Globe class="h-4 w-4 shrink-0" stroke-width="1.5" /></span><span v-show="!sidebarCollapsed" class="overflow-hidden text-ellipsis whitespace-nowrap max-lg:hidden">{{ locale === 'zh' ? '中文' : 'EN' }}</span></button>
          <button class="flex min-h-9 w-full items-center gap-2 rounded-lg bg-transparent px-1 text-left text-sm leading-5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--text-primary)]" @click="toggleTheme"><span class="grid h-5 w-5 shrink-0 place-items-center [place-items:center_start]"><Moon v-if="!isDark" class="h-4 w-4 shrink-0" stroke-width="1.5" /><Sun v-else class="h-4 w-4 shrink-0" stroke-width="1.5" /></span><span v-show="!sidebarCollapsed" class="overflow-hidden text-ellipsis whitespace-nowrap max-lg:hidden">{{ isDark ? t('common.lightMode') : t('common.darkMode') }}</span></button>
        </div>
        <AdminIdentityCard v-if="user" :email="userEmail" :role="currentAdminRole" :collapsed="sidebarCollapsed" />
      </div>
    </aside>

    <div class="min-w-0 flex-1 transition-[margin-left] duration-150" :class="sidebarCollapsed ? 'ml-16' : 'ml-[240px] max-lg:ml-16'">
      <header class="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-[var(--header-bg)] px-6 backdrop-blur-md max-md:px-4">
        <h1 class="text-base font-semibold">{{ t(`nav.${activeView}`) }}</h1>
      </header>

      <div v-if="!isAuthReady || !adminChecked" class="flex min-h-[400px] flex-col items-center justify-center gap-3 text-center"><span class="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" /><strong>{{ t('auth.checking') }}</strong></div>
      <div v-else-if="!user" class="flex min-h-[400px] flex-col items-center justify-center gap-3 text-center"><strong>{{ t('auth.loginRequired') }}</strong><RouterLink to="/image" class="inline-flex min-h-8 items-center justify-center rounded-md border border-border bg-[var(--surface)] px-3 text-[13px] font-medium text-[var(--text-primary)] no-underline">{{ t('auth.loginLink') }}</RouterLink></div>
      <div v-else-if="!isAdmin" class="flex min-h-[400px] flex-col items-center justify-center gap-3 text-center"><strong>{{ errorMessage || t('auth.noAccess') }}</strong><span class="text-[var(--text-muted)]">{{ userEmail }}</span></div>

      <main v-else class="mx-auto w-full max-w-[1400px] p-6 max-md:p-4">
        <KeepAlive>
          <component :is="activePanel" v-bind="activePanelProps" @data-changed="handleDataChanged" @role-changed="currentAdminRole = $event" @update:allow-write="allowWrite = $event" />
        </KeepAlive>
      </main>
    </div>
  </div>
</template>
