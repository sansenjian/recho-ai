import { ref } from 'vue'

/**
 * 就地确认弹窗的状态机，配 ConfirmDialog.vue 使用。
 *
 * pending 里存的是「等待确认时要执行的动作」，弹窗本身不关心业务；
 * 这样调用方可以把 window.confirm(...) 一对一替换成：
 *
 *   const { open, pending, request, confirm } = useConfirmAction()
 *   if (!request(() => doDelete())) return   // 需要确认，已弹出
 *   // 不需要确认的分支继续往下走
 *
 * confirm() 会先清空 pending 再执行，避免动作内部再次 request 时读到旧值。
 */
export function useConfirmAction<T = void>() {
  const open = ref(false)
  const pending = ref<null | (() => T)>(null)

  /** 打开弹窗并记住待执行动作；返回 false 表示调用方应中断当前流程。 */
  function request(action: () => T) {
    pending.value = action
    open.value = true
    return false
  }

  function confirm() {
    const action = pending.value
    pending.value = null
    open.value = false
    action?.()
  }

  return { open, pending, request, confirm }
}
