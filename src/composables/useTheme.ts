import { ref, watch, onMounted } from 'vue'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'recho-theme'

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch { /* ignore */ }
  return 'system'
}

const theme = ref<Theme>(getStoredTheme())

function applyTheme(t: Theme) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  if (t === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', isDark)
    root.classList.toggle('light', !isDark)
  } else if (t === 'light') {
    root.classList.add('light')
  } else {
    root.classList.add('dark')
  }
}

function setTheme(t: Theme) {
  theme.value = t
  try {
    localStorage.setItem(STORAGE_KEY, t)
  } catch { /* ignore */ }
}

// Listen for system theme changes when in 'system' mode.
// 该监听器刻意放在模块作用域：useTheme 是贯穿整个 SPA 生命周期的单例，
// 监听器与应用同寿，无需手动移除；如需在卸载时清理可改写为返回 dispose 的函数。
if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', () => {
    if (theme.value === 'system') applyTheme('system')
  })
}

export function useTheme() {
  onMounted(() => applyTheme(theme.value))
  watch(theme, applyTheme, { immediate: true })

  return {
    theme,
    setTheme,
    toggleTheme() {
      setTheme(theme.value === 'dark' ? 'light' : 'dark')
    },
    isDark: () => document.documentElement.classList.contains('dark'),
  }
}
