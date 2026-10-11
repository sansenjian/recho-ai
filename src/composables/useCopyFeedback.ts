import { onScopeDispose, ref } from 'vue'

/** 勾号停留时长：够看清"复制成功"，又不至于一直挂着。 */
const FEEDBACK_DURATION_MS = 1500

/**
 * 复制成功的短暂反馈。
 *
 * 复制是个没有可见结果的动作，需要在按钮上回一个勾告诉用户"确实复制了"。
 * 对话页的消息与工作台的生图轮次都要这套「显示勾 → 1.5 秒后收起」，
 * 逻辑逐字相同，抽出来一处维护。
 *
 * 记录的是刚刚复制的那一项的 id，而不是布尔值：列表里同时存在多条消息，
 * 用 id 才能只让被点的那一条亮勾。
 */
export function useCopyFeedback() {
  const copiedId = ref<string | null>(null)
  let timer = 0

  /** 标记某一项刚复制成功，并安排收起。 */
  function markCopied(id: string) {
    copiedId.value = id
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      // 期间又复制了别的内容时不要收起新状态。
      if (copiedId.value === id) copiedId.value = null
    }, FEEDBACK_DURATION_MS)
  }

  function isCopied(id: string) {
    return copiedId.value === id
  }

  // 用 onScopeDispose 而不是 onBeforeUnmount：它在组件卸载与 effectScope 停止时
  // 都会执行，所以这个 composable 在组件之外也能被正确清理。
  onScopeDispose(() => window.clearTimeout(timer))

  return { copiedId, markCopied, isCopied }
}
