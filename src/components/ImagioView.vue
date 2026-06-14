<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useImageGen } from '../composables/useImageGen'
import { useAppConfig } from '../composables/useAppConfig'
import type { ImageAspectRatio, ImageGenerationCount, ImageQuality, ImageResolution } from '../types/image'

const props = defineProps<{
  canSelectGenerationCount?: boolean
}>()

const {
  isGenerating,
  error,
  generate,
} = useImageGen()

const { availableImageModels, defaultImageModel, ensureAppConfig } = useAppConfig()

const promptText = ref('')
const generationCount = ref<ImageGenerationCount>(1)
const imageModel = ref('')
const resolution = ref<ImageResolution>('auto')
const aspectRatio = ref<ImageAspectRatio>('auto')
const quality = ref<ImageQuality>('auto')

const modelOptions = computed(() =>
  availableImageModels.value.map((m) => ({ value: m.id, label: m.name }))
)

// Initialize model when config loads; re-validate if config changes
watch([defaultImageModel, availableImageModels], ([defaultModel, models]) => {
  const modelIds = models.map((m) => m.id)
  // If current model is no longer available, fall back to default
  if (imageModel.value && !modelIds.includes(imageModel.value)) {
    imageModel.value = defaultModel || ''
  }
  // If no model selected yet, use default
  if (!imageModel.value && defaultModel) {
    imageModel.value = defaultModel
  }
}, { immediate: true })

// Ensure config is loaded on mount
ensureAppConfig()

const resolutionOptions: Array<{ value: ImageResolution; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]

const aspectRatioOptions: Array<{ value: ImageAspectRatio; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: '1:1', label: '1:1' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
]

const qualityOptions: Array<{ value: ImageQuality; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

async function handleGenerate() {
  if (!promptText.value.trim()) return
  
  await generate(promptText.value, {
    count: generationCount.value,
    resolution: resolution.value,
    aspectRatio: aspectRatio.value,
    quality: quality.value,
    model: imageModel.value,
  })
}
</script>

<template>
  <div class="imagio-view">
    <div class="imagio-main">
      <div class="prompt-area">
        <textarea
          v-model="promptText"
          class="prompt-input"
          placeholder="描述你想生成的图片，或附加图片进行编辑......"
          rows="4"
          :disabled="isGenerating"
        />
        
        <div class="prompt-actions">
          <div class="generation-count">
            <span>生成数量</span>
            <button
              v-if="canSelectGenerationCount"
              type="button"
              :class="{ active: generationCount === 1 }"
              @click="generationCount = 1"
            >
              ×1
            </button>
            <button
              v-if="canSelectGenerationCount"
              type="button"
              :class="{ active: generationCount === 2 }"
              @click="generationCount = 2"
            >
              ×2
            </button>
            <button
              v-if="canSelectGenerationCount"
              type="button"
              :class="{ active: generationCount === 4 }"
              @click="generationCount = 4"
            >
              ×4
            </button>
          </div>
          
          <button
            class="generate-btn"
            :disabled="!promptText.trim() || isGenerating"
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

    <aside class="settings-panel">
      <h3>参数设置</h3>

      <div class="setting-group">
        <label>模型</label>
        <div v-if="modelOptions.length" class="option-buttons model-buttons">
          <button
            v-for="opt in modelOptions"
            :key="opt.value"
            type="button"
            :class="{ active: imageModel === opt.value }"
            @click="imageModel = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <span v-else class="loading-hint">加载中...</span>
      </div>

      <div class="setting-group">
        <label>分辨率</label>
        <div class="option-buttons">
          <button
            v-for="opt in resolutionOptions"
            :key="opt.value"
            type="button"
            :class="{ active: resolution === opt.value }"
            @click="resolution = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="setting-group">
        <label>尺寸 / 比例</label>
        <div class="option-buttons">
          <button
            v-for="opt in aspectRatioOptions"
            :key="opt.value"
            type="button"
            :class="{ active: aspectRatio === opt.value }"
            @click="aspectRatio = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div class="setting-group">
        <label>质量</label>
        <div class="option-buttons">
          <button
            v-for="opt in qualityOptions"
            :key="opt.value"
            type="button"
            :class="{ active: quality === opt.value }"
            @click="quality = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <div v-if="error" class="error-message">{{ error }}</div>
    </aside>
  </div>
</template>

<style scoped>
.imagio-view {
  display: flex;
  height: 100%;
  width: 100%;
  background: #f6f8fb;
}

.imagio-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
  padding: 24px;
  height: 100%;
}

.prompt-area {
  margin-top: auto;
}

.prompt-input {
  width: 100%;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  resize: vertical;
  outline: none;
  transition: border-color 0.2s;
}

.prompt-input:focus {
  border-color: var(--accent);
}

.prompt-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.prompt-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
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
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.generation-count button.active {
  background: #111827;
  color: #fff;
  border-color: #111827;
}

.generate-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 24px;
  border: 0;
  border-radius: 8px;
  background: #111827;
  color: #fff;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  transition: opacity 0.2s;
}

.generate-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.generate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-panel {
  width: 320px;
  flex-shrink: 0;
  padding: 24px 20px;
  border-left: 1px solid var(--border);
  background: #fff;
  overflow-y: auto;
  height: 100%;
}

.settings-panel h3 {
  margin: 0 0 24px;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 800;
}

.setting-group {
  margin-bottom: 24px;
}

.setting-group label {
  display: block;
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
}

.option-buttons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.option-buttons button {
  min-height: 36px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.option-buttons button.active {
  background: #111827;
  color: #fff;
  border-color: #111827;
}

.model-buttons {
  grid-template-columns: repeat(2, 1fr);
}

.loading-hint {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.error-message {
  margin-top: 16px;
  padding: 12px;
  border: 1px solid rgba(220, 38, 38, 0.18);
  border-radius: 8px;
  background: #fff;
  color: var(--danger);
  font-size: 13px;
  font-weight: 700;
}

@media (max-width: 1024px) {
  .settings-panel {
    width: 260px;
  }
}

@media (max-width: 768px) {
  .imagio-view {
    flex-direction: column;
  }
  
  .settings-panel {
    width: 100%;
    border-left: 0;
    border-top: 1px solid var(--border);
    max-height: 300px;
  }
}
</style>
