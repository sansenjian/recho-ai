<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  fetchAuthenticatedImageObjectUrl,
  imageSourceUrl,
  imageStoragePathCandidates,
  type AuthenticatedImageMode,
  type AuthenticatedImageSource,
} from '../lib/authenticated-image-source'

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
// 地址并发出请求（对象存储有防盗链，那次请求必然失败）。回调里会按有没有可代理的
// 路径决定填什么。
const resolvedSrc = ref('')
const storagePathCandidates = computed(() => imageStoragePathCandidates(props.source, props.mode))
let objectUrl = ''
let loadSeq = 0
let controller: AbortController | null = null

function revokeObjectUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
}

function abortPendingFetch() {
  if (controller) {
    controller.abort()
    controller = null
  }
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
    abortPendingFetch()
    revokeObjectUrl()

    // 有 storagePath 时不要先绑远程 URL：那个地址（如 COS 直链）多半带防盗链，
    // 请求必然失败，既浪费一次往返也在控制台留下 403。等代理取回 blob 再显示，
    // 只有确实没有可代理的路径时才回退到远程 URL 或本地 dataUrl。
    if (!paths.length) {
      resolvedSrc.value = fallbackSrc
      return
    }
    resolvedSrc.value = ''

    controller = new AbortController()
    const signal = controller.signal
    try {
      let nextObjectUrl = ''
      for (const path of paths) {
        try {
          // 把 mode 带进去：同一张图的缩略图与预览图是两份不同大小的内容，
          // 缓存键必须区分，否则点开大图会拿到网格里的低清版本。
          nextObjectUrl = await fetchAuthenticatedImageObjectUrl(path, signal, props.mode)
          break
        } catch (err) {
          if (signal.aborted) throw err
        }
      }
      if (!nextObjectUrl) {
        throw new Error('no authenticated image storage path loaded')
      }
      if (seq !== loadSeq) {
        URL.revokeObjectURL(nextObjectUrl)
        return
      }
      controller = null
      revokeObjectUrl()
      objectUrl = nextObjectUrl
      resolvedSrc.value = nextObjectUrl
    } catch {
      if (seq === loadSeq) {
        resolvedSrc.value = fallbackSrc
      }
    } finally {
      if (controller?.signal === signal) {
        controller = null
      }
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  loadSeq += 1
  abortPendingFetch()
  revokeObjectUrl()
})
</script>

<template>
  <!-- src 为空时不渲染：`<img src="">` 会让浏览器按当前页面地址再发一次请求。 -->
  <img v-if="resolvedSrc" v-bind="$attrs" :src="resolvedSrc" :alt="alt || ''">
</template>
