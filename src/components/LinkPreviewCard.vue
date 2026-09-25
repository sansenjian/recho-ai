<script setup lang="ts">
import { Bookmark, Globe, ExternalLink } from '@lucide/vue'
import type { LinkPreview } from '../utils/linkPreview'

defineProps<{
  preview: LinkPreview
}>()
</script>

<template>
  <a
    :href="preview.url"
    target="_blank"
    rel="noopener noreferrer"
    class="group/link-preview relative mt-2 block max-w-[480px] overflow-hidden rounded-[15px] border border-border bg-card px-3.5 py-3 text-left shadow-sm transition-colors hover:bg-muted/70"
    :title="`打开 ${preview.url}`"
  >
    <div class="absolute left-0 top-0 h-full w-[3px] bg-muted-foreground/30 transition-colors group-hover/link-preview:bg-primary" aria-hidden="true" />
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <div class="line-clamp-1 pr-5 text-[14px] font-semibold leading-5 text-foreground">{{ preview.title }}</div>
        <div class="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{{ preview.summary }}</div>
      </div>
      <Bookmark class="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </div>
    <div class="mt-2.5 flex items-center gap-2 text-[12px] text-muted-foreground">
      <Globe class="h-4 w-4" aria-hidden="true" />
      <span>网页预览</span>
      <span class="truncate opacity-70">{{ preview.hostname }}</span>
      <ExternalLink class="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
    </div>
  </a>
</template>
