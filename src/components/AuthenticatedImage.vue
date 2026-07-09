<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  fetchAuthenticatedImageObjectUrl,
  imageSourceUrl,
  imageStoragePath,
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

const resolvedSrc = ref(props.src || '')
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
    imageStoragePath(props.source, props.mode),
  ],
  async () => {
    const seq = ++loadSeq
    const fallbackSrc = props.src || imageSourceUrl(props.source, props.mode)
    const path = imageStoragePath(props.source, props.mode)
    abortPendingFetch()
    revokeObjectUrl()
    resolvedSrc.value = fallbackSrc

    if (!path) return

    controller = new AbortController()
    const signal = controller.signal
    try {
      const nextObjectUrl = await fetchAuthenticatedImageObjectUrl(path, signal)
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
  <img v-bind="$attrs" :src="resolvedSrc" :alt="alt || ''">
</template>
