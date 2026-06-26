<script setup lang="ts">
import type { PublicAnnouncement } from '../composables/useAnnouncementPopup'
import { Button } from '@/components/ui/button'
import { X } from '@lucide/vue'

defineProps<{
  announcement: PublicAnnouncement
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="fixed inset-0 z-[260] grid place-items-center bg-black/30 p-6 backdrop-blur-lg max-md:items-end max-md:p-3" @click.self="emit('close')">
    <section class="max-h-[calc(100vh-48px)] w-[min(480px,calc(100vw-48px))] overflow-auto rounded-lg bg-card p-[18px] shadow-md ring-1 ring-border max-md:max-h-[calc(100vh-24px)] max-md:w-full max-md:p-4" role="dialog" aria-modal="true" aria-labelledby="announcement-title">
      <header class="mb-3 flex items-start justify-between gap-3.5">
        <div>
          <span class="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">公告</span>
          <h2 id="announcement-title" class="mt-0.5 text-[17px] font-bold leading-tight tracking-tight text-foreground">{{ announcement.title }}</h2>
        </div>
        <Button
          variant="outline"
          size="icon"
          class="h-[30px] w-[30px] shrink-0 text-muted-foreground max-md:h-11 max-md:w-11"
          title="关闭"
          aria-label="关闭公告"
          @click="emit('close')"
        >
          <X class="h-[15px] w-[15px]" />
        </Button>
      </header>
      <p class="m-0 break-words whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{{ announcement.body }}</p>
      <footer class="mt-4 flex justify-end">
        <Button variant="outline" size="sm" class="min-h-8 text-xs font-semibold" @click="emit('close')">
          知道了
        </Button>
      </footer>
    </section>
  </div>
</template>
