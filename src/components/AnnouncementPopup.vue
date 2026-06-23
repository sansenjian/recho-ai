<script setup lang="ts">
import type { PublicAnnouncement } from '../composables/useAnnouncementPopup'

defineProps<{
  announcement: PublicAnnouncement
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="fixed inset-0 z-[260] grid place-items-center p-6 max-md:items-end max-md:p-3 bg-black/30 backdrop-blur-lg" @click.self="emit('close')">
    <section class="w-[min(480px,calc(100vw-48px))] max-h-[calc(100vh-48px)] max-md:w-full max-md:max-h-[calc(100vh-24px)] overflow-auto p-[18px] max-md:p-4 rounded-lg bg-card shadow-md ring-1 ring-border" role="dialog" aria-modal="true" aria-labelledby="announcement-title">
      <header class="flex items-start justify-between gap-3.5 mb-3">
        <div>
          <span class="text-muted-foreground text-[10px] font-semibold uppercase tracking-[0.05em]">公告</span>
          <h2 id="announcement-title" class="mt-0.5 text-foreground text-[17px] font-bold leading-tight tracking-tight">{{ announcement.title }}</h2>
        </div>
        <button type="button" class="inline-flex items-center justify-center w-[30px] h-[30px] max-md:w-11 max-md:h-11 rounded-md bg-card text-muted-foreground border-0 cursor-pointer ring-1 ring-border hover:bg-accent transition-colors" title="关闭" aria-label="关闭公告" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>
      <p class="m-0 text-foreground whitespace-pre-wrap break-words text-[13px] leading-relaxed">{{ announcement.body }}</p>
      <footer class="flex justify-end mt-4">
        <button type="button" class="min-h-[32px] max-md:min-h-11 px-3.5 rounded-md bg-card text-foreground text-[12px] font-semibold border-0 cursor-pointer ring-1 ring-border hover:bg-accent transition-colors" @click="emit('close')">知道了</button>
      </footer>
    </section>
  </div>
</template>
