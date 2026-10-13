import type { GeneratedImage } from '../types/image'
import { useImageEvents, type ImageEventSource, type ImageEventType } from './useImageEvents'

/**
 * 把图片埋点接进业务动作。
 *
 * `useImageEvents` 只负责「怎么发」，这里负责「在哪些动作上发、算哪个来源」。
 * 分开的原因：动作点分散在多个 handler 里，如果每个点自己拼 payload，来源判定
 * （这张图是从画布点开的还是从历史记录点开的）就会各写各的，很快就不一致。
 *
 * 埋点绝不能影响主流程：所有调用都是 fire-and-forget，且 recordImageEvent 内部
 * 已经吞掉网络错误。这里再加一层兜底，避免 composable 被替换成会抛的实现时
 * 把「下载图片」这种动作带崩。
 */

/** 把一处动作点标注成埋点调用。 */
export interface ImageActionContext {
  source: ImageEventSource
  /** 图片 id。画布节点可能还没落库，此时没有 id，调用会被静默跳过。 */
  imageId?: string | null
  /** 补充信息。key 里含 prompt 的会被 useImageEvents 过滤掉，不要放提示词。 */
  metadata?: Record<string, string | number | boolean | null | undefined>
}

export function useImageAnalytics() {
  const { recordImageEvent } = useImageEvents()

  /**
   * 记录一次图片动作。
   *
   * 没有 imageId 就跳过——后端 image_events.image_id 是可空外键，但填不了 id 的
   * 事件对分析没有价值（无法归因到具体图片），只会把表撑大。
   */
  function track(eventType: ImageEventType, context: ImageActionContext) {
    const imageId = context.imageId || undefined
    if (!imageId) return
    void recordImageEvent({
      eventType,
      source: context.source,
      imageId,
      ...(context.metadata ? { metadata: context.metadata } : {}),
    }).catch(() => {
      // 埋点失败不影响用户动作。
      return false
    })
  }

  /** 从一张已落库的生成结果取埋点上下文。 */
  function trackGenerated(
    eventType: ImageEventType,
    image: GeneratedImage | null | undefined,
    source: ImageEventSource,
    metadata?: ImageActionContext['metadata'],
  ) {
    if (!image) return
    track(eventType, { source, imageId: image.id, metadata })
  }

  return { track, trackGenerated }
}
