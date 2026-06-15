<script setup lang="ts">
import { computed, ref } from 'vue'
import { useImageGen } from '../composables/useImageGen'
import {
  clipboardImageFile,
  compressReferenceImageDataUrl,
  fallbackImageFileName,
  readImageFileAsDataUrl,
} from '../lib/image-canvas-utils'
import type { ImageGenReference, ImageGenerationCount, ImageQuality, ImageResolution, ImageAspectRatio } from '../types/image'

const props = defineProps<{
  canSelectGenerationCount?: boolean
  imageModel?: string
  resolution?: ImageResolution
  aspectRatio?: ImageAspectRatio
  quality?: ImageQuality
  modelOptions?: Array<{ value: string; label: string }>
  resolutionOptions?: Array<{ value: ImageResolution; label: string }>
  aspectRatioOptions?: Array<{ value: ImageAspectRatio; label: string }>
  qualityOptions?: Array<{ value: ImageQuality; label: string }>
}>()

const emit = defineEmits<{
  'update:image-model': [value: string]
  'update:resolution': [value: ImageResolution]
  'update:aspect-ratio': [value: ImageAspectRatio]
  'update:quality': [value: ImageQuality]
}>()

const {
  isGenerating,
  error,
  generate,
} = useImageGen()

const promptText = ref('')
const generationCount = ref<ImageGenerationCount>(1)
const pendingReferences = ref<ImageGenReference[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const pasteMessage = ref<string | null>(null)

const canGenerate = computed(() => Boolean(promptText.value.trim()) && !isGenerating.value)

let referenceIdSeed = Date.now()

async function addReferenceFile(file: File) {
  if (!file.type.startsWith('image/')) return

  const dataUrl = await compressReferenceImageDataUrl(await readImageFileAsDataUrl(file))
  referenceIdSeed += 1
  pendingReferences.value = [
    ...pendingReferences.value,
    {
      id: `imagio_reference_${referenceIdSeed}`,
      title: `参考图 ${pendingReferences.value.length + 1}`,
      dataUrl,
      fileName: fallbackImageFileName(file),
    },
  ]
  pasteMessage.value = null
}

async function addReferenceFiles(files: File[] | FileList) {
  for (const file of Array.from(files)) {
    try {
      await addReferenceFile(file)
    } catch {
      pasteMessage.value = '图片读取失败，请重新复制或选择图片。'
    }
  }
}

function openReferencePicker() {
  if (isGenerating.value) return
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
    fileInputRef.value.click()
  }
}

function handleReferenceInput(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (input.files?.length) {
    void addReferenceFiles(input.files)
  }
}

function removeReference(index: number) {
  pendingReferences.value = pendingReferences.value.filter((_, i) => i !== index)
}

function handlePaste(event: ClipboardEvent) {
  const file = clipboardImageFile(event)
  if (!file) return

  event.preventDefault()
  void addReferenceFile(file)
}

async function handleGenerate() {
  if (!promptText.value.trim()) return

  const results = await generate(promptText.value, {
    count: props.canSelectGenerationCount ? generationCount.value : 1,
    resolution: props.resolution,
    aspectRatio: props.aspectRatio,
    quality: props.quality,
    model: props.imageModel,
    references: pendingReferences.value.map(reference => ({ ...reference })),
  })
  if (results?.length) {
    pendingReferences.value = []
  }
}

</script>

<template>
  <div class="imagio-view" @paste="handlePaste">
    <div class="imagio-main">
      <div class="prompt-area">
        <textarea
          v-model="promptText"
          class="prompt-input"
          placeholder="描述你想生成的图片，或附加图片进行编辑......"
          rows="4"
          :disabled="isGenerating"
        />

        <div class="reference-row">
          <button
            class="reference-add"
            type="button"
            :disabled="isGenerating"
            title="添加参考图"
            @click="openReferencePicker"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 8v8" />
              <path d="M8 12h8" />
            </svg>
            <span>参考图</span>
          </button>
          <input
            ref="fileInputRef"
            class="reference-file-input"
            type="file"
            accept="image/*"
            multiple
            @change="handleReferenceInput"
          >
          <div v-if="pendingReferences.length" class="reference-list" aria-label="参考图">
            <div
              v-for="(reference, index) in pendingReferences"
              :key="reference.id"
              class="reference-item"
            >
              <img v-if="reference.dataUrl || reference.previewUrl" :src="reference.dataUrl || reference.previewUrl" :alt="reference.title">
              <button type="button" title="移除参考图" @click="removeReference(index)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
          <span v-else class="reference-hint">可粘贴图片作为参考</span>
        </div>
        <p v-if="pasteMessage" class="reference-error">{{ pasteMessage }}</p>
        <p v-if="error" class="reference-error">{{ error }}</p>

        <!-- Inline parameter panel: shown only on narrow viewports (<=960px) -->
        <div class="inline-params">
          <div v-if="modelOptions && modelOptions.length" class="param-group">
            <label>模型</label>
            <div class="param-buttons">
              <button
                v-for="opt in modelOptions"
                :key="opt.value"
                type="button"
                :class="{ active: imageModel === opt.value }"
                @click="emit('update:image-model', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div v-if="resolutionOptions && resolutionOptions.length" class="param-group">
            <label>分辨率</label>
            <div class="param-buttons">
              <button
                v-for="opt in resolutionOptions"
                :key="opt.value"
                type="button"
                :class="{ active: resolution === opt.value }"
                @click="emit('update:resolution', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div v-if="aspectRatioOptions && aspectRatioOptions.length" class="param-group">
            <label>尺寸 / 比例</label>
            <div class="param-buttons">
              <button
                v-for="opt in aspectRatioOptions"
                :key="opt.value"
                type="button"
                :class="{ active: aspectRatio === opt.value }"
                @click="emit('update:aspect-ratio', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div v-if="qualityOptions && qualityOptions.length" class="param-group">
            <label>质量</label>
            <div class="param-buttons">
              <button
                v-for="opt in qualityOptions"
                :key="opt.value"
                type="button"
                :class="{ active: quality === opt.value }"
                @click="emit('update:quality', opt.value)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="prompt-actions">
          <div class="generation-count">
            <span>生成数量</span>
            <template v-if="canSelectGenerationCount">
              <button
                type="button"
                :class="{ active: generationCount === 1 }"
                @click="generationCount = 1"
              >
                ×1
              </button>
              <button
                type="button"
                :class="{ active: generationCount === 2 }"
                @click="generationCount = 2"
              >
                ×2
              </button>
              <button
                type="button"
                :class="{ active: generationCount === 4 }"
                @click="generationCount = 4"
              >
                ×4
              </button>
            </template>
            <span v-else class="count-fixed">×1</span>
          </div>

          <button
            class="generate-btn"
            :disabled="!canGenerate"
            @click="handleGenerate"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18">
              <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
              <path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
            </svg>
            {{ isGenerating ? '生成中...' : '生成' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.imagio-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  background: #f6f8fb;
}

.imagio-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
  padding: 24px;
  min-height: 0;
}

.prompt-area {
  margin-top: auto;
}

.prompt-input {
  width: 100%;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: #fff;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
  resize: vertical;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  font-family: inherit;
}

.prompt-input::placeholder {
  color: var(--text-muted);
}

.prompt-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.prompt-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.reference-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 50px;
  margin-top: 12px;
}

.reference-add {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}

.reference-add:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

.reference-add:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.reference-file-input {
  display: none;
}

.reference-list {
  display: flex;
  min-width: 0;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0;
}

.reference-item {
  position: relative;
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.reference-item img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.reference-item button {
  position: absolute;
  top: 3px;
  right: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  color: #fff;
  cursor: pointer;
}

.reference-hint {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.reference-error {
  margin: 0 0 4px;
  color: var(--danger);
  font-size: 12px;
  font-weight: 700;
}

/* Inline parameter panel (shown on narrow viewports) */
.inline-params {
  display: none;
  margin-top: 18px;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
}

.param-group {
  margin-bottom: 16px;
}

.param-group:last-child {
  margin-bottom: 0;
}

.param-group label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.param-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.param-buttons button {
  min-height: 30px;
  padding: 4px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.param-buttons button:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}

.param-buttons button.active {
  background: #0b0f14;
  color: #fff;
  border-color: #0b0f14;
}

/* Narrow viewport: show inline params */
@media (max-width: 960px) {
  .inline-params {
    display: block;
  }
}

.prompt-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}

.generation-count {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
}

.generation-count button {
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.generation-count button:hover {
  border-color: var(--text-muted);
  color: var(--text-primary);
}

.generation-count button.active {
  background: #4b5563;
  color: #fff;
  border-color: #4b5563;
}

.generation-count .count-fixed {
  min-height: 30px;
  padding: 4px 12px;
  border-radius: 8px;
  background: #eef1f4;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 700;
}

.generate-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 26px;
  border: 0;
  border-radius: 12px;
  background: #4b5563;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  font-family: inherit;
}

.generate-btn:hover:not(:disabled) {
  background: #374151;
}

.generate-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.generate-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
