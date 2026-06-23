<script setup lang="ts">
import {
  displayImageUrl,
  displayReferenceUrl,
  formatGalleryDate,
  galleryOptionLabel,
  galleryPrompt,
  galleryReferenceCount,
  galleryReferences,
  type GalleryOption,
} from '../lib/image-gallery'
import type { GeneratedImage, ImageQuality, ImageResolution } from '../types/image'

defineProps<{
  image: GeneratedImage
  resolutionOptions: Array<GalleryOption<ImageResolution>>
  qualityOptions: Array<GalleryOption<ImageQuality>>
  isDownloading: boolean
}>()

const emit = defineEmits<{
  view: []
  useImage: []
  preloadDownload: []
  download: []
  sendToChat: []
}>()
</script>

<template>
  <article class="gallery-card">
    <button type="button" class="gallery-image-wrap" title="查看作品" @click="emit('view')">
      <span class="gallery-card-date">{{ formatGalleryDate(image.timestamp) }}</span>
      <span v-if="galleryReferenceCount(image)" class="gallery-card-reference-count">
        {{ galleryReferenceCount(image) }} 张参考
      </span>
      <span class="gallery-image-button">
        <img :src="displayImageUrl(image)" :alt="galleryPrompt(image)" loading="lazy">
      </span>
    </button>
    <div class="gallery-card-body">
      <p class="gallery-card-prompt">{{ galleryPrompt(image) }}</p>
      <div class="gallery-card-meta">
        <span>{{ image.size || 'auto' }}</span>
        <span>{{ galleryOptionLabel(image.resolution, resolutionOptions) }}</span>
        <span>{{ galleryOptionLabel(image.quality, qualityOptions) }}</span>
      </div>
      <div class="gallery-card-footer">
        <div class="gallery-reference-strip" aria-label="参考图">
          <img
            v-for="reference in galleryReferences(image).slice(0, 3)"
            :key="reference.id || reference.title"
            :src="displayReferenceUrl(reference)"
            :alt="reference.title || '参考图'"
            loading="lazy"
          >
        </div>
        <div class="gallery-actions">
          <button type="button" title="查看作品" @click="emit('view')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
            </svg>
          </button>
          <button type="button" title="放入画布" @click="emit('useImage')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            title="下载原图"
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
          </button>
          <button type="button" title="发送到对话" @click="emit('sendToChat')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.gallery-card {
  display: grid;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg, 8px);
  background: hsl(var(--card));
  box-shadow: var(--shadow-sm);
}

.gallery-image-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 4 / 3;
  padding: 0;
  border: 0;
  border-bottom: 1px solid hsl(var(--border));
  background:
    linear-gradient(45deg, hsl(var(--border) / 0.55) 25%, transparent 25%),
    linear-gradient(-45deg, hsl(var(--border) / 0.55) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, hsl(var(--border) / 0.55) 75%),
    linear-gradient(-45deg, transparent 75%, hsl(var(--border) / 0.55) 75%),
    hsl(var(--muted));
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
  background-size: 18px 18px;
  cursor: zoom-in;
  overflow: hidden;
}

.gallery-image-wrap img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.gallery-image-button {
  display: block;
  width: 100%;
  height: 100%;
}

.gallery-image-wrap:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}

.gallery-card-date,
.gallery-card-reference-count {
  position: absolute;
  z-index: 1;
  top: 10px;
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid hsl(var(--border) / 0.45);
  border-radius: var(--radius-sm, 6px);
  background: hsl(var(--foreground) / 0.76);
  color: hsl(var(--background));
  font-size: 11px;
  font-weight: 900;
  backdrop-filter: blur(8px);
}

.gallery-card-date {
  left: 10px;
}

.gallery-card-reference-count {
  right: 10px;
}

.gallery-card-body {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.gallery-card-prompt {
  display: -webkit-box;
  min-height: 38px;
  margin: 0;
  overflow: hidden;
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 800;
  line-height: 1.46;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.gallery-card-meta {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 5px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 800;
}

.gallery-card-meta span {
  max-width: 100%;
  padding: 3px 7px;
  border-radius: var(--radius-sm, 6px);
  background: hsl(var(--muted));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.gallery-reference-strip {
  display: flex;
  min-width: 0;
  height: 30px;
}

.gallery-reference-strip img {
  width: 30px;
  height: 30px;
  margin-right: -7px;
  border: 2px solid hsl(var(--card));
  border-radius: var(--radius-md, 7px);
  background: hsl(var(--card));
  object-fit: cover;
  box-shadow: var(--shadow-sm);
}

.gallery-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 5px;
}

.gallery-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  min-height: 32px;
  padding: 0;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md, 7px);
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.gallery-actions button:hover:not(:disabled) {
  border-color: hsl(var(--ring));
  background: hsl(var(--accent));
  color: hsl(var(--foreground));
}

.gallery-actions button:disabled {
  opacity: 0.46;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .gallery-actions {
    flex: 1;
    gap: 8px;
  }

  .gallery-actions button {
    flex: 1;
    min-height: 44px;
  }
}

@media (max-width: 460px) {
  .gallery-card-body {
    padding: 10px;
  }

  .gallery-card-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .gallery-reference-strip {
    height: 28px;
  }

  .gallery-reference-strip img {
    width: 28px;
    height: 28px;
  }
}
</style>
