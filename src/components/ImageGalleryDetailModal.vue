<script setup lang="ts">
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
    <div class="gallery-detail-overlay" @pointerdown.self="emit('close')">
      <article class="gallery-detail-shell" @pointerdown.stop>
        <section class="gallery-detail-preview">
          <img
            :src="imageUrl"
            :alt="imageAlt"
            :class="{ 'loading-preview': isLoadingPreview }"
            draggable="false"
          >
          <span v-if="isLoadingPreview" class="gallery-detail-loading">
            正在加载预览图...
          </span>
          <button type="button" class="gallery-detail-zoom" title="放大查看" @click="emit('openViewer')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
              <circle cx="11" cy="11" r="7" />
              <path d="M8 11h6" />
              <path d="M11 8v6" />
              <path d="m16 16 4 4" />
            </svg>
          </button>
        </section>

        <aside class="gallery-detail-panel">
          <header class="gallery-detail-header">
            <div>
              <span>作品详情</span>
              <strong>{{ imageTitle }}</strong>
            </div>
            <button type="button" title="关闭" @click="emit('close')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </header>

          <section class="gallery-detail-section">
            <h3>用户提示词</h3>
            <p>{{ prompt }}</p>
          </section>

          <section class="gallery-detail-section">
            <div class="gallery-detail-section-title">
              <h3>参考图</h3>
              <span>{{ referenceCount }} 张</span>
            </div>
            <div v-if="references.length" class="gallery-detail-references">
              <figure
                v-for="reference in references"
                :key="reference.id || reference.title"
              >
                <img :src="displayReferenceUrl(reference)" :alt="reference.title || '参考图'" loading="lazy">
                <figcaption>{{ reference.title || reference.fileName || '参考图' }}</figcaption>
              </figure>
            </div>
            <p v-else class="gallery-detail-muted">
              {{ referenceCount ? '参考图未公开展示' : '没有参考图' }}
            </p>
          </section>

          <section class="gallery-detail-section">
            <h3>生成参数</h3>
            <dl class="gallery-param-grid">
              <template v-for="item in params" :key="item.label">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </template>
            </dl>
          </section>

          <div class="gallery-detail-actions">
            <button type="button" @click="emit('useImage')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              放入画布
            </button>
            <button
              type="button"
              :disabled="isDownloading"
              @pointerenter="emit('preloadDownload')"
              @focus="emit('preloadDownload')"
              @click="emit('download')"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 19h14" />
              </svg>
              {{ isDownloading ? '下载中' : '下载' }}
            </button>
            <button type="button" @click="emit('sendToChat')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
              </svg>
              对话
            </button>
          </div>
        </aside>
      </article>
    </div>
  </Teleport>
</template>

<style scoped>
.gallery-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(10, 15, 25, 0.62);
  backdrop-filter: blur(8px);
}

.gallery-detail-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 410px);
  width: min(1480px, calc(100vw - 36px));
  height: min(860px, calc(100dvh - 36px));
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 32px 80px rgba(15, 23, 42, 0.32);
}

.gallery-detail-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  padding: 14px;
  background: #f8fafc;
}

.gallery-detail-preview img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 100%;
  border-radius: 8px;
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.16) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.16) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.16) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.16) 75%),
    #f8fafc;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
  object-fit: contain;
  box-shadow: 0 18px 52px rgba(15, 23, 42, 0.16);
  -webkit-user-drag: none;
}

.gallery-detail-preview img.loading-preview {
  filter: saturate(0.92);
}

.gallery-detail-loading {
  position: absolute;
  left: 24px;
  bottom: 22px;
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.46);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  font-size: 12px;
  font-weight: 900;
  backdrop-filter: blur(8px);
}

.gallery-detail-zoom {
  position: absolute;
  right: 18px;
  bottom: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: 1px solid rgba(255, 255, 255, 0.52);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  cursor: zoom-in;
  backdrop-filter: blur(8px);
}

.gallery-detail-panel {
  display: grid;
  align-content: start;
  grid-auto-rows: max-content;
  gap: 18px;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  border-left: 1px solid hsl(var(--border));
  overflow-y: auto;
}

.gallery-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.gallery-detail-header div {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.gallery-detail-header span,
.gallery-detail-section-title span,
.gallery-detail-muted {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.gallery-detail-header strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 900;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-detail-header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
}

.gallery-detail-section {
  display: grid;
  gap: 9px;
  min-width: 0;
}

.gallery-detail-section h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
}

.gallery-detail-section p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.58;
  white-space: pre-wrap;
  word-break: break-word;
}

.gallery-detail-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.gallery-detail-references {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 9px;
}

.gallery-detail-references figure {
  min-width: 0;
  margin: 0;
}

.gallery-detail-references img {
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  object-fit: cover;
}

.gallery-detail-references figcaption {
  margin-top: 5px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-param-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.gallery-param-grid dt,
.gallery-param-grid dd {
  min-width: 0;
  margin: 0;
}

.gallery-param-grid dt {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 900;
}

.gallery-param-grid dd {
  padding: 7px 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
}

.gallery-detail-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
}

.gallery-detail-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  gap: 6px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}

.gallery-detail-actions button:first-child {
  background: #111827;
  color: #fff;
}

.gallery-detail-actions button:hover,
.gallery-detail-header button:hover {
  border-color: var(--border-strong);
  background: var(--surface-soft);
  color: var(--text-primary);
}

.gallery-detail-actions button:first-child:hover {
  background: #020617;
  color: #fff;
}

@media (max-width: 768px) {
  .gallery-detail-overlay {
    padding: 10px;
  }

  .gallery-detail-shell {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(260px, 48vh) minmax(0, 1fr);
    width: calc(100vw - 20px);
    height: calc(100dvh - 20px);
  }

  .gallery-detail-preview {
    padding: 12px;
  }

  .gallery-detail-panel {
    border-top: 1px solid hsl(var(--border));
    border-left: 0;
  }

  .gallery-detail-actions {
    grid-template-columns: 1fr;
  }

  .gallery-detail-actions button {
    min-height: 48px;
  }
}
</style>
