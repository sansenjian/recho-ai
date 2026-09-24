<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { apiUrl } from '../../lib/api-base'
import { getAuthAccessToken } from '../../composables/useAuthSession'

/**
 * 管理台图片缩略图。公开地址可以直接交给 <img>,但管理媒体路由
 * /api/admin/images/:id/media 需要 Bearer 令牌——<img> 带不了请求头,
 * 因此这类地址先取回 blob 再换成 object URL。
 */

const props = defineProps<{ src?: string | null; alt?: string }>()

const resolvedSrc = ref('')
let objectUrl = ''
let controller: AbortController | null = null
let seq = 0

function isAdminMediaUrl(value: string) {
  return value.includes('/api/admin/images/')
}

function revokeObjectUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
}

watch(() => props.src || '', async (next) => {
  const current = ++seq
  controller?.abort()
  controller = null
  revokeObjectUrl()

  // 非管理媒体地址(公开 URL)直接交给 <img>,无需令牌
  if (!next || !isAdminMediaUrl(next)) {
    resolvedSrc.value = next
    return
  }

  resolvedSrc.value = ''
  controller = new AbortController()
  try {
    const token = await getAuthAccessToken()
    const response = await fetch(apiUrl(next), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`admin image media returned ${response.status}`)
    const blob = await response.blob()
    if (!blob.size) throw new Error('admin image media returned empty body')
    if (current !== seq) return
    objectUrl = URL.createObjectURL(blob)
    resolvedSrc.value = objectUrl
  } catch {
    // 读取失败保持空图占位,不回退到无令牌请求(那只会再失败一次)
  }
}, { immediate: true })

onBeforeUnmount(() => {
  seq += 1
  controller?.abort()
  revokeObjectUrl()
})
</script>

<template>
  <img v-bind="$attrs" :src="resolvedSrc" :alt="alt || ''">
</template>