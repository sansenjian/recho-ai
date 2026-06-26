<script setup lang="ts">
import { ZoomIn, X, Plus, Download, MessageCircle } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { displayReferenceUrl } from '../lib/image-gallery'
import type { GalleryParam, GalleryReference } from '../lib/image-canvas-model'

defineProps<{
  imageUrl: string
  imageAlt: string
  imageTitle: string
  prompt: string
  referenceCount: number
  references: GalleryReference[]
  params: GalleryParam[]
  isLoadingPreview: boolean
  isDownloading: boolean
}>()

const emit = defineEmits<{
  close: []
  openViewer: []
  useImage: []
  preloadDownload: []
  download: []
  sendToChat: []
}>()
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[110] grid place-items-center p-[18px] bg-[rgba(10,15,25,0.62)] backdrop-blur-sm max-md:p-2.5"
      @pointerdown.self="emit('close')"
    >
      <article
        class="grid grid-cols-[minmax(0,1fr)_minmax(360px,410px)] w-[min(1480px,calc(100vw-36px))] h-[min(860px,calc(100dvh-36px))] overflow-hidden border border-white/[0.18] rounded-[10px] bg-white shadow-[0_32px_80px_rgba(15,23,42,0.32)] max-md:grid-cols-1 max-md:grid-rows-[minmax(260px,48vh)_minmax(0,1fr)] max-md:w-[calc(100vw-20px)] max-md:h-[calc(100dvh-20px)]"
        @pointerdown.stop
      >
        <section class="relative flex items-center justify-center min-w-0 min-h-0 p-3.5 bg-[#f8fafc] max-md:p-3">
          <img
            :src="imageUrl"
            :alt="imageAlt"
            :class="{ 'saturate-[0.92]': isLoadingPreview }"
            draggable="false"
            class="block w-full h-auto max-h-full rounded-lg object-contain shadow-[0_18px_52px_rgba(15,23,42,0.16)] select-none"
            :style="{
              background: 'linear-gradient(45deg, rgba(148,163,184,0.16) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.16) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.16) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.16) 75%), #f8fafc',
              backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
              backgroundSize: '20px 20px',
            }"
          >
          <span
            v-if="isLoadingPreview"
            class="absolute left-6 bottom-[22px] inline-flex items-center min-h-[30px] px-2.5 border border-white/[0.46] rounded-full bg-[rgba(15,23,42,0.72)] text-white text-xs font-black backdrop-blur-sm"
          >
            正在加载预览图...
          </span>
          <button
            type="button"
            class="absolute right-[18px] bottom-[18px] inline-flex items-center justify-center w-[42px] h-[42px] border border-white/[0.52] rounded-full bg-[rgba(15,23,42,0.72)] text-white cursor-zoom-in backdrop-blur-sm"
            title="放大查看"
            @click="emit('openViewer')"
          >
            <ZoomIn class="w-[18px] h-[18px]" />
          </button>
        </section>

        <aside
          class="grid content-start auto-rows-max gap-[18px] min-w-0 min-h-0 p-[18px] border-l border-border overflow-y-auto max-md:border-t max-md:border-l-0"
        >
          <header class="flex items-start justify-between gap-3">
            <div class="grid min-w-0 gap-1">
              <span class="text-muted-foreground text-[11px] font-black">作品详情</span>
              <strong class="overflow-hidden text-foreground text-[17px] font-black leading-[1.35] text-ellipsis whitespace-nowrap">
                {{ imageTitle }}
              </strong>
            </div>
            <Button
              variant="outline"
              size="icon"
              class="w-[34px] h-[34px] shrink-0 rounded-lg border-border bg-white text-muted-foreground hover:bg-muted hover:text-foreground"
              title="关闭"
              @click="emit('close')"
            >
              <X class="w-[18px] h-[18px]" />
            </Button>
          </header>

          <section class="grid gap-[9px] min-w-0">
            <h3 class="text-foreground text-xs font-black">用户提示词</h3>
            <p class="text-muted-foreground text-[13px] leading-[1.58] whitespace-pre-wrap break-words">
              {{ prompt }}
            </p>
          </section>

          <section class="grid gap-[9px] min-w-0">
            <div class="flex items-center justify-between gap-2.5">
              <h3 class="text-foreground text-xs font-black">参考图</h3>
              <span class="text-muted-foreground text-[11px] font-black">{{ referenceCount }} 张</span>
            </div>
            <div
              v-if="references.length"
              class="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-[9px]"
            >
              <figure
                v-for="reference in references"
                :key="reference.id || reference.title"
                class="min-w-0"
              >
                <img
                  :src="displayReferenceUrl(reference)"
                  :alt="reference.title || '参考图'"
                  loading="lazy"
                  class="w-full aspect-square border border-border rounded-lg object-cover"
                >
                <figcaption class="mt-[5px] overflow-hidden text-muted-foreground text-[10px] font-extrabold text-ellipsis whitespace-nowrap">
                  {{ reference.title || reference.fileName || '参考图' }}
                </figcaption>
              </figure>
            </div>
            <p v-else class="text-muted-foreground text-[11px] font-black">
              {{ referenceCount ? '参考图未公开展示' : '没有参考图' }}
            </p>
          </section>

          <section class="grid gap-[9px] min-w-0">
            <h3 class="text-foreground text-xs font-black">生成参数</h3>
            <dl class="grid grid-cols-2 gap-2">
              <template v-for="item in params" :key="item.label">
                <dt class="min-w-0 text-muted-foreground text-[11px] font-black">
                  {{ item.label }}
                </dt>
                <dd class="min-w-0 px-2 py-[7px] border border-border rounded-lg bg-muted text-foreground text-xs font-black">
                  {{ item.value }}
                </dd>
              </template>
            </dl>
          </section>

          <div class="grid grid-cols-3 gap-2 max-md:grid-cols-1">
            <Button
              type="button"
              class="inline-flex items-center justify-center min-h-10 gap-1.5 rounded-lg bg-gray-900 text-white text-xs font-black hover:bg-gray-950 max-md:min-h-12"
              @click="emit('useImage')"
            >
              <Plus class="w-4 h-4" />
              放入画布
            </Button>
            <Button
              type="button"
              variant="outline"
              class="inline-flex items-center justify-center min-h-10 gap-1.5 rounded-lg border-border bg-white text-foreground text-xs font-black hover:bg-muted hover:text-foreground disabled:opacity-[0.46] disabled:cursor-not-allowed max-md:min-h-12"
              :disabled="isDownloading"
              @pointerenter="emit('preloadDownload')"
              @focus="emit('preloadDownload')"
              @click="emit('download')"
            >
              <Download class="w-4 h-4" />
              {{ isDownloading ? '下载中' : '下载' }}
            </Button>
            <Button
              type="button"
              variant="outline"
              class="inline-flex items-center justify-center min-h-10 gap-1.5 rounded-lg border-border bg-white text-foreground text-xs font-black hover:bg-muted hover:text-foreground max-md:min-h-12"
              @click="emit('sendToChat')"
            >
              <MessageCircle class="w-4 h-4" />
              对话
            </Button>
          </div>
        </aside>
      </article>
    </div>
  </Teleport>
</template>
