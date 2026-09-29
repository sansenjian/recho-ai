import { onBeforeUnmount, ref, type Ref } from 'vue'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * 用户是否要求减少动效。
 * 侧边栏、轮次导航的平滑滚动都按这个偏好降级成瞬时跳转。
 * jsdom 里没有 matchMedia，这里退回「无偏好」，调用方不需要自己判空。
 */
export function useReducedMotion(): Ref<boolean> {
  const prefersReduced = ref(false)

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return prefersReduced
  }

  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  prefersReduced.value = query.matches

  const handleChange = (event: MediaQueryListEvent) => {
    prefersReduced.value = event.matches
  }

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handleChange)
    onBeforeUnmount(() => query.removeEventListener('change', handleChange))
  } else if (typeof query.addListener === 'function') {
    // Safari 14 之前只有废弃的旧接口。
    query.addListener(handleChange)
    onBeforeUnmount(() => query.removeListener(handleChange))
  }

  return prefersReduced
}
