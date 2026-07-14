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

const resolvedSrc = ref(props.src || '')
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
    resolvedSrc.value = fallbackSrc

    if (!paths.length) return

    controller = new AbortController()
    const signal = controller.signal
    try {
      let nextObjectUrl = ''
      for (const path of paths) {
        try {
          nextObjectUrl = await fetchAuthenticatedImageObjectUrl(path, signal)
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
  <img v-bind="$attrs" :src="resolvedSrc" :alt="alt || ''">
</template>
