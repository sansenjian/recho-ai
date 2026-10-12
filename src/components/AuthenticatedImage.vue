<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  fetchAuthenticatedImageObjectUrl,
  imageSourceUrl,
  imageStoragePathCandidates,
  type AuthenticatedImageMode,
  type AuthenticatedImageSource,
} from '../lib/authenticated-image-source'
import { requestPresignedImageUrl } from '../composables/usePresignedImage'

const props = withDefaults(defineProps<{
  source?: AuthenticatedImageSource | null
  src?: string
  alt?: string
  mode?: AuthenticatedImageMode
}>(), {
  source: null,
  mode: 'thumbnail',
})

// 初始留空：watch 的 immediate 回调是异步的，先填 props.src 会让第一帧就渲染远程
// 地址并发出请求（对象存储有防盗链，那次请求必然失败）。回调里会按有没有可取图的
// 路径决定填什么。
const resolvedSrc = ref('')
const storagePathCandidates = computed(() => imageStoragePathCandidates(props.source, props.mode))
let objectUrl = ''
let loadSeq = 0
/** 当前生效的签名地址；它由对象存储直供，不需要 revoke。 */
let presignedUrl = ''
let presignTimer: number | null = null

function revokeObjectUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
}

function clearPresignTimer() {
  if (presignTimer !== null) {
    window.clearTimeout(presignTimer)
    presignTimer = null
  }
}

/**
 * 回落到代理取图。
 *
 * 这条路径始终保留：签发不可用、签名过期后刷新失败、或签名地址本身加载不出来时，
 * 代理是最后的兜底，任何一步出问题都不该让图片彻底不显示。
 */
async function applyProxyFallback(paths: string[], seq: number, fallbackSrc: string): Promise<boolean> {
  try {
    let nextObjectUrl = ''
    for (const path of paths) {
      try {
        // 把 mode 带进去：同一张图的缩略图与预览图是两份不同大小的内容，
        // 缓存键必须区分，否则点开大图会拿到网格里的低清版本。
        nextObjectUrl = await fetchAuthenticatedImageObjectUrl(path, undefined, props.mode)
        break
      } catch {
        // 换下一个候选路径。
      }
    }
    if (!nextObjectUrl) {
      throw new Error('no authenticated image storage path loaded')
    }
    if (seq !== loadSeq) {
      URL.revokeObjectURL(nextObjectUrl)
      return false
    }
    revokeObjectUrl()
    objectUrl = nextObjectUrl
    resolvedSrc.value = nextObjectUrl
    return true
  } catch {
    if (seq === loadSeq) resolvedSrc.value = fallbackSrc
    return false
  }
}

/**
 * 签名地址加载不出来时的补救。
 *
 * 签发成功不等于能加载：对象可能已被删除、存储可能返回 403、签名也可能在长时间
 * 挂起的页面上过期。没有这一步，这些情况都会留下一个永久裂图。
 */
async function handleImageError() {
  // 只有当前显示的确实是签名地址时才补救。否则代理地址自身失败时会反复触发。
  if (!presignedUrl || resolvedSrc.value !== presignedUrl) return
  presignedUrl = ''
  clearPresignTimer()
  const paths = storagePathCandidates.value
  if (!paths.length) return
  await applyProxyFallback(paths, loadSeq, props.src || imageSourceUrl(props.source, props.mode))
}

/**
 * 到期前重新签发。
 *
 * 页面可能开着很久（用户把标签页晾在那儿），签名过期后图片会变成裂图。提前一分钟
 * 换新，留出签发本身的耗时。
 */
function schedulePresignRefresh(storagePath: string, expiresAt: number) {
  clearPresignTimer()
  if (!expiresAt) return
  const msUntilExpiry = expiresAt * 1000 - Date.now() - 60_000
  if (msUntilExpiry <= 0) return

  const seq = loadSeq
  presignTimer = window.setTimeout(() => {
    void applyPresigned(storagePath, seq, true)
  }, msUntilExpiry)
}

/** 取签名地址并显示；失败返回 false，调用方回落到代理。 */
async function applyPresigned(storagePath: string, seq: number, isRefresh: boolean): Promise<boolean> {
  const signed = await requestPresignedImageUrl(storagePath)
  if (!signed) return false
  // 期间换过图或组件已卸载，这次结果作废。
  if (seq !== loadSeq) return false
  if (isRefresh) clearPresignTimer()
  revokeObjectUrl()
  presignedUrl = signed.url
  resolvedSrc.value = signed.url
  schedulePresignRefresh(storagePath, signed.expiresAt)
  return true
}

watch(
  () => [
    props.src || '',
    imageSourceUrl(props.source, props.mode),
    storagePathCandidates.value.join('\n'),
  ],
  async () => {
    const seq = ++loadSeq
    const fallbackSrc = props.src || imageSourceUrl(props.source, props.mode)
    const paths = storagePathCandidates.value
    clearPresignTimer()
    presignedUrl = ''
    revokeObjectUrl()

    // 没有可取的存储路径时，远程 URL 或本地 dataUrl 是唯一来源。
    if (!paths.length) {
      resolvedSrc.value = fallbackSrc
      return
    }
    resolvedSrc.value = ''

    // 优先用签名地址：对象存储直供，不经过本服务。图片是二进制大文件，走代理意味着
    // 每张图都从服务器转发一次，出口流量全压在后端上。
    for (const path of paths) {
      if (await applyPresigned(path, seq, false)) return
    }
    if (seq !== loadSeq) return

    await applyProxyFallback(paths, seq, fallbackSrc)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  loadSeq += 1
  clearPresignTimer()
  revokeObjectUrl()
})
</script>

<template>
  <!--
    src 为空时不渲染：`<img src="">` 会让浏览器按当前页面地址再发一次请求。
    @error 用来在签名地址加载失败时回落到代理——签发成功不等于能加载。
  -->
  <img v-if="resolvedSrc" v-bind="$attrs" :src="resolvedSrc" :alt="alt || ''" @error="handleImageError">
</template>
