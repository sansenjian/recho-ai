<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, X, Sparkles } from '@lucide/vue'
import {
  clipboardImageFile,
  compressReferenceImageDataUrl,
  fallbackImageFileName,
  readImageFileAsDataUrl,
} from '../lib/image-canvas-utils'
import type {
  ImageAspectRatio,
  ImageGenerate,
  ImageGenerationCount,
  ImageGenReference,
  GeneratedImage,
  ImageQuality,
  ImageResolution,
} from '../types/image'
import { isCustomImageAspectRatio, parseImageAspectRatio } from '../lib/image-aspect-ratio'
import { hasImageSource } from '../lib/authenticated-image-source'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import ImageModelSelect from './ImageModelSelect.vue'
import AuthenticatedImage from './AuthenticatedImage.vue'
import ChatMessageRail from './ChatMessageRail.vue'
import type { NamedWorkspace } from '../lib/workspace-list'
import { pickActiveAnchorId, type RailTurn } from '../utils/chat-rail'
import { useReducedMotion } from '../composables/useReducedMotion'

const props = defineProps<{
  generate: ImageGenerate
  isGenerating: boolean
  error: string | null
  generatedImages?: GeneratedImage[]
  workspaceName?: string
  workspaces?: NamedWorkspace[]
  activeWorkspaceId?: string
  canSelectGenerationCount?: boolean
  imageModel?: string
  defaultImageModel?: string
  resolution?: ImageResolution
  aspectRatio?: ImageAspectRatio
  quality?: ImageQuality
  /** 是否要求透明背景。 */
  transparentBackground?: boolean
  /** 当前模型是否声明支持透明背景；false 时「透明」选项灰掉。 */
  transparentAvailable?: boolean
  modelOptions?: Array<{ value: string; label: string }>
  resolutionOptions?: Array<{ value: ImageResolution; label: string }>
  aspectRatioOptions?: Array<{ value: ImageAspectRatio; label: string }>
  qualityOptions?: Array<{ value: ImageQuality; label: string }>
}>()

const emit = defineEmits<{
  'select-workspace': [id: string]
  'update:image-model': [value: string]
  'update:resolution': [value: ImageResolution]
  'update:aspect-ratio': [value: ImageAspectRatio]
  'update:quality': [value: ImageQuality]
  'update:transparent-background': [value: boolean]
}>()

const promptText = ref('')
const generationCount = ref<ImageGenerationCount>(1)
const pendingReferences = ref<ImageGenReference[]>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const pasteMessage = ref<string | null>(null)
const customAspectRatioOpen = ref(false)
const customAspectRatioWidth = ref('4')
const customAspectRatioHeight = ref('5')
const customAspectRatioError = ref<string | null>(null)

const conversationItems = computed(() => {
  const groups = new Map<string, { id: string; prompt: string; timestamp: string; references: ImageGenReference[]; images: GeneratedImage[] }>()

  for (const image of [...(props.generatedImages ?? [])].reverse()) {
    const key = image.generationBatchId || `${image.prompt}|${image.timestamp}`
    const existing = groups.get(key)
    if (existing) {
      existing.images.push(image)
      continue
    }
    groups.set(key, {
      id: key,
      prompt: image.userPrompt || image.prompt,
      timestamp: image.timestamp,
      references: image.references ?? [],
      images: [image],
    })
  }

  return [...groups.values()]
})

const { t } = useI18n()

/**
 * 工作台按生成批次分轮，所以镜像对话页的语义：一格 = 一条提问。
 * 这里的「回复」是图片而不是正文，answer 留空，用 summary 告诉卡片本轮出了几张图。
 */
const railTurns = computed<RailTurn[]>(() => conversationItems.value.map((item, index) => ({
  id: item.id,
  messageIndex: index,
  question: item.prompt,
  answer: '',
  timestamp: item.timestamp,
  toolCount: 0,
  summary: t('chat.turnImages', { count: item.images.length }),
})))

const prefersReducedMotion = useReducedMotion()

/** 空态给的三个起点：一行文案本身就是一条能直接发出去的提示词，点一下落到输入框。 */
const promptStarters = computed(() => [
  { id: 'poster', title: t('imagio.starterPosterTitle'), prompt: t('imagio.starterPosterPrompt') },
  { id: 'product', title: t('imagio.starterProductTitle'), prompt: t('imagio.starterProductPrompt') },
  { id: 'sticker', title: t('imagio.starterStickerTitle'), prompt: t('imagio.starterStickerPrompt') },
])

const conversationRef = ref<HTMLElement | null>(null)
const activeTurnId = ref<string | null>(null)
const turnElements = new Map<string, HTMLElement>()

function setTurnElement(id: string, element: Element | null) {
  if (element instanceof HTMLElement) turnElements.set(id, element)
  else turnElements.delete(id)
}

/** 与对话页同一套判定：起点不晚于视口顶部（留 32px 余量）的最后一轮才是当前轮。 */
function updateActiveTurn() {
  const scroller = conversationRef.value
  if (!scroller) return
  const anchors = conversationItems.value.flatMap(item => {
    const element = turnElements.get(item.id)
    return element ? [{ id: item.id, offsetTop: element.offsetTop }] : []
  })
  // 量不到任何元素时（首帧、测试里的空布局）保留旧行为，高亮最后一轮。
  activeTurnId.value = pickActiveAnchorId(anchors, scroller.scrollTop) ?? conversationItems.value.at(-1)?.id ?? null
}

let activeTurnFrame: number | null = null

/**
 * 滚动一帧可能触发好几次，合帧后再量位置，避免一帧里重复读 offsetTop 触发排版。
 * requestAnimationFrame 不存在、或像测试里那样被 stub 成不执行回调时退回同步执行，
 * 否则高亮状态永远不会更新。
 */
function scheduleActiveTurnUpdate() {
  if (activeTurnFrame !== null) return
  if (typeof requestAnimationFrame !== 'function') {
    updateActiveTurn()
    return
  }
  activeTurnFrame = requestAnimationFrame(() => {
    activeTurnFrame = null
    updateActiveTurn()
  })
}

onBeforeUnmount(() => {
  if (activeTurnFrame === null || typeof cancelAnimationFrame !== 'function') return
  cancelAnimationFrame(activeTurnFrame)
  activeTurnFrame = null
})

function jumpToTurn(id: string) {
  const element = turnElements.get(id)
  // jsdom 没有实现 scrollIntoView，测试里点到标记时不该炸。
  if (element && typeof element.scrollIntoView === 'function') {
    // 开了「减少动效」就不再滚动，只把结果瞬时定位过去。
    element.scrollIntoView({ behavior: prefersReducedMotion.value ? 'auto' : 'smooth', block: 'start' })
  }
  activeTurnId.value = id
}

/** 空态的起点卡片：点一下把示例提示词放进输入框，用户接着改就行。 */
function useStarter(prompt: string) {
  promptText.value = prompt
}

watch(conversationItems, () => {
  void nextTick(updateActiveTurn)
})

onMounted(updateActiveTurn)

function canDisplayGeneratedImage(image: GeneratedImage) {
  return hasImageSource(image, 'preview')
}

const canGenerate = computed(() => Boolean(promptText.value.trim()) && !props.isGenerating)
const aspectRatioLocked = computed(() => props.resolution === 'auto')
const customAspectRatioActive = computed(() => isCustomImageAspectRatio(props.aspectRatio))
const customAspectRatioSelected = computed(() => customAspectRatioActive.value || customAspectRatioOpen.value)

watch(() => props.aspectRatio, (value) => {
  if (!value || !isCustomImageAspectRatio(value)) return
  const parts = parseImageAspectRatio(value)
  if (parts) {
    customAspectRatioWidth.value = String(parts.width)
    customAspectRatioHeight.value = String(parts.height)
    customAspectRatioOpen.value = true
  }
}, { immediate: true })

let referenceIdSeed = Date.now()

async function addReferenceFile(file: File) {
  if (!file.type.startsWith('image/')) return

  const dataUrl = await compressReferenceImageDataUrl(await readImageFileAsDataUrl(file))
  referenceIdSeed += 1
  pendingReferences.value = [
    ...pendingReferences.value,
    {
      id: `imagio_reference_${referenceIdSeed}`,
      title: t('imagio.referenceTitle', { index: pendingReferences.value.length + 1 }),
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
      pasteMessage.value = t('imagio.referenceReadFailed')
    }
  }
}

function openReferencePicker() {
  if (props.isGenerating) return
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

function updateResolution(value: ImageResolution) {
  emit('update:resolution', value)
  if (value === 'auto') {
    customAspectRatioOpen.value = false
    emit('update:aspect-ratio', 'auto')
  }
}

function updateAspectRatio(value: ImageAspectRatio) {
  if (aspectRatioLocked.value && value !== 'auto') return
  customAspectRatioOpen.value = false
  emit('update:aspect-ratio', value)
}

function openCustomAspectRatio() {
  if (aspectRatioLocked.value) return
  customAspectRatioOpen.value = true
  customAspectRatioError.value = null
}

function applyCustomAspectRatio() {
  if (aspectRatioLocked.value) return
  const parts = parseImageAspectRatio(`${customAspectRatioWidth.value}:${customAspectRatioHeight.value}`)
  if (!parts) {
    customAspectRatioError.value = t('imagio.ratioRangeError')
    return
  }
  customAspectRatioError.value = null
  customAspectRatioWidth.value = String(parts.width)
  customAspectRatioHeight.value = String(parts.height)
  if (props.aspectRatio !== parts.value) emit('update:aspect-ratio', parts.value)
}

async function handlePaste(event: ClipboardEvent) {
  const file = clipboardImageFile(event)
  if (!file) return

  event.preventDefault()
  try {
    await addReferenceFile(file)
  } catch {
    pasteMessage.value = t('imagio.referenceReadFailed')
  }
}

async function handleGenerate() {
  if (!canGenerate.value) return

  const results = await props.generate(promptText.value, {
    count: props.canSelectGenerationCount ? generationCount.value : 1,
    resolution: props.resolution,
    aspectRatio: props.aspectRatio,
    quality: props.quality,
    model: props.imageModel,
    references: pendingReferences.value.map(reference => ({ ...reference })),
    // 模型不支持透明时不下发该参数，避免后端静默忽略造成「以为透明」的错觉。
    ...(props.transparentBackground && props.transparentAvailable ? { transparentBackground: true } : {}),
  })
  if (results?.length) {
    pendingReferences.value = []
  }
}

</script>

<template>
<div class="imagio-view" @paste="handlePaste">
    <div class="workspace-heading" :aria-label="t('imagio.workspaceAria')">
      <div class="min-w-0">
<span class="text-[11px] font-medium text-muted-foreground">{{ t('imagio.workspaceLabel') }}</span>
<h2 class="truncate text-sm font-semibold text-foreground">{{ workspaceName || t('imagio.workspaceUntitled') }}</h2>
      </div>
      <select
        v-if="workspaces?.length"
        class="workspace-mobile-select"
        :value="activeWorkspaceId"
:aria-label="t('imagio.workspaceSwitch')"
        @change="emit('select-workspace', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">{{ workspace.name }}</option>
      </select>
    </div>
    <div class="imagio-body">
      <div class="imagio-main">
      <div v-if="conversationItems.length" class="imagio-transcript">
      <div
        ref="conversationRef"
        class="imagio-conversation"
:aria-label="t('imagio.transcriptAria')"
@scroll.passive="scheduleActiveTurnUpdate"
      >
        <div
          v-for="item in conversationItems"
          :key="item.id"
          :ref="element => setTurnElement(item.id, element as Element | null)"
          class="conversation-turn"
        >
          <div class="conversation-user">
<div v-if="item.references.length" class="conversation-reference-list" :aria-label="t('imagio.referencesAria')">
              <img
                v-for="reference in item.references"
                :key="reference.id"
                :src="reference.previewUrl || reference.thumbnailUrl || reference.dataUrl"
                :alt="reference.title"
              >
            </div>
            <p>{{ item.prompt }}</p>
          </div>

          <div class="conversation-ai">
            <div class="conversation-avatar" aria-hidden="true">AI</div>
            <div class="conversation-output">
<div class="conversation-label">{{ t('imagio.outputLabel') }}</div>
              <div class="conversation-image-grid">
                <div
                  v-for="image in item.images"
                  :key="image.id"
                  class="conversation-image"
                  :title="image.prompt"
                >
                  <AuthenticatedImage
                    v-if="canDisplayGeneratedImage(image)"
                    :source="image"
                    mode="preview"
                    :alt="image.prompt"
                  />
<span v-else class="conversation-image-placeholder">{{ t('imagio.imagePending') }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
<ChatMessageRail
:turns="railTurns"
:active-turn-id="activeTurnId"
@select="jumpToTurn"
/>
</div>
<div v-else class="imagio-empty">
<div class="empty-intro">
<span class="empty-mark" aria-hidden="true"><Sparkles :size="18" stroke-width="1.7" /></span>
<h3>{{ t('imagio.emptyTitle') }}</h3>
<p>{{ t('imagio.emptyHint') }}</p>
</div>
<div class="empty-starters">
<button
v-for="starter in promptStarters"
:key="starter.id"
type="button"
class="starter-card"
:title="starter.prompt"
@click="useStarter(starter.prompt)"
>
<span class="starter-title">{{ starter.title }}</span>
<span class="starter-prompt">{{ starter.prompt }}</span>
</button>
</div>
</div>
      <div class="prompt-area">
          <textarea
            v-model="promptText"
:aria-label="t('imagio.promptAria')"
            class="prompt-input"
:placeholder="t('imagio.promptPlaceholder')"
            rows="4"
            :disabled="isGenerating"
          />

          <p v-if="pasteMessage" class="reference-error">{{ pasteMessage }}</p>
          <p v-if="error" class="reference-error">{{ error }}</p>

          <div class="prompt-actions">
            <div class="prompt-reference">
              <button
                class="reference-add"
                type="button"
                :disabled="isGenerating"
:title="t('imagio.referenceAdd')"
@click="openReferencePicker"
              >
                <Plus :size="16" stroke-width="1.7" />
<span>{{ t('imagio.referenceAdd') }}</span>
              </button>
              <input
                ref="fileInputRef"
                class="reference-file-input"
:aria-label="t('imagio.referenceAdd')"
                type="file"
                accept="image/*"
                multiple
                @change="handleReferenceInput"
              >
<div v-if="pendingReferences.length" class="reference-list" :aria-label="t('imagio.referencesAria')">
                <div
                  v-for="(reference, index) in pendingReferences"
                  :key="reference.id"
                  class="reference-item"
                >
                  <img v-if="reference.dataUrl || reference.previewUrl" :src="reference.dataUrl || reference.previewUrl" :alt="reference.title">
<button type="button" :title="t('imagio.referenceRemove')" @click="removeReference(index)">
                    <X :size="12" stroke-width="2" />
                  </button>
                </div>
              </div>
            </div>

            <div class="generation-count">
<span>{{ t('imagio.generationCount') }}</span>
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

            <div class="prompt-actions-end">
              <div class="prompt-model-select">
                <ImageModelSelect
                  :model-value="imageModel"
                  :default-model="defaultImageModel"
                  :options="modelOptions"
                  :disabled="isGenerating"
                  @update:model-value="emit('update:image-model', $event)"
                />
              </div>
              <button
                class="generate-btn"
                :disabled="!canGenerate"
                @click="handleGenerate"
              >
                <Sparkles :size="18" stroke-width="2" />
{{ isGenerating ? t('imagio.generating') : t('imagio.generate') }}
              </button>
            </div>
          </div>
      </div>
      </div>

    <div class="imagio-options">
          <div class="inline-params">
            <div v-if="resolutionOptions && resolutionOptions.length" class="param-group">
<label>{{ t('imagio.resolution') }}</label>
              <div class="param-buttons">
                <button
                  v-for="opt in resolutionOptions"
                  :key="opt.value"
                  type="button"
                  :class="{ active: resolution === opt.value }"
                  @click="updateResolution(opt.value)"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <div v-if="aspectRatioOptions && aspectRatioOptions.length" class="param-group aspect-ratio-group">
<label>{{ t('imagio.aspectRatio') }}</label>
              <div class="param-buttons">
                <button
                  v-for="opt in aspectRatioOptions"
                  :key="opt.value"
                  type="button"
                  :disabled="aspectRatioLocked && opt.value !== 'auto'"
                  :class="{ active: aspectRatio === opt.value }"
                  class="disabled:cursor-not-allowed disabled:opacity-40"
                  @click="updateAspectRatio(opt.value)"
                >
                  {{ opt.label }}
                </button>
                <button
                  type="button"
                  :disabled="aspectRatioLocked"
                  :class="{ active: customAspectRatioSelected }"
                  class="disabled:cursor-not-allowed disabled:opacity-40"
@click="openCustomAspectRatio"
>
{{ t('imagio.customRatio') }}
</button>
              </div>
              <div v-if="customAspectRatioOpen && !aspectRatioLocked" class="custom-ratio-editor mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
<span class="text-xs font-medium text-muted-foreground">{{ t('imagio.ratio') }}</span>
<Input v-model="customAspectRatioWidth" type="number" min="1" max="1000" inputmode="numeric" :aria-label="t('imagio.ratioWidthAria')" class="h-8 min-w-0 bg-background px-2 text-center text-xs font-semibold text-foreground" />
                <span aria-hidden="true">:</span>
<Input v-model="customAspectRatioHeight" type="number" min="1" max="1000" inputmode="numeric" :aria-label="t('imagio.ratioHeightAria')" class="h-8 min-w-0 bg-background px-2 text-center text-xs font-semibold text-foreground" />
<Button type="button" variant="outline" size="sm" class="h-8 px-3 text-xs font-semibold" @click="applyCustomAspectRatio">{{ t('imagio.applyRatio') }}</Button>
                <span v-if="customAspectRatioError" class="col-span-full text-[11px] leading-snug text-destructive">{{ customAspectRatioError }}</span>
              </div>
            </div>

            <div v-if="qualityOptions && qualityOptions.length" class="param-group">
<label>{{ t('imagio.quality') }}</label>
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

            <div class="param-group">
<label>{{ t('imagio.background') }}</label>
              <div class="param-buttons">
                <button
                  type="button"
                  :class="{ active: !transparentBackground }"
@click="emit('update:transparent-background', false)"
>
{{ t('imagio.opaque') }}
</button>
                <button
                  type="button"
                  :disabled="!transparentAvailable"
                  :class="{ active: transparentBackground }"
                  class="disabled:cursor-not-allowed disabled:opacity-40"
@click="emit('update:transparent-background', true)"
>
{{ t('imagio.transparent') }}
</button>
              </div>
<p v-if="!transparentAvailable" class="param-hint">{{ t('imagio.transparentUnavailable') }}</p>
            </div>
          </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 工作台把它自己的宽度当容器：左侧工作区列表展开后，同样的视口留给对话的宽度会缩水，
 * 媒体查询却仍按视口判断，参数栏就不会折叠、轨道也会压到对话列上。
 * 声明成容器后，下面的断点全部按「对话实际拿到的宽度」判断。
 */
.imagio-view {
  container-type: inline-size;
  container-name: imagio-view;
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: transparent;
}

.imagio-body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.imagio-main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 28px;
  min-height: 0;
}

.workspace-heading {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 16px 28px 12px;
  border-bottom: 1px solid var(--color-hairline);
  background: transparent;
}

.workspace-mobile-select {
  display: none;
  max-width: 55%;
  min-height: 36px;
  padding: 0 8px;
  border: 1px solid var(--color-hairline);
  border-radius: 6px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 12px;
}

.imagio-options {
  display: flex;
  flex: 0 0 320px;
  flex-direction: column;
  justify-content: flex-start;
  width: 320px;
  min-height: 0;
  order: 2;
  padding: 24px 20px;
  border-left: 1px solid var(--color-hairline);
  background: hsl(var(--background) / 0.72);
  backdrop-filter: blur(20px);
  overflow-y: auto;
}

/*
 * 轮次轨道的宿主：轨道绝对定位在左侧沟槽里不随内容滚动，所以外层相对定位、
 * 滚动交给里面那一层。≥960px 时两侧各留 56px，轨道自己也在同样的宽度下显示；
 * 留白对称，里面的对话列才仍然居中，不会一边贴边。
 * 宽度判断一律用容器查询而不是视口：左侧工作区栏展开后 1300px 的视口只剩
 * 约 1040px 给对话，此时按视口判断就会既保住 320px 参数栏、又错留 56px 沟槽。
 */
.imagio-transcript {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

@container imagio-view (min-width: 960px) {
  .imagio-transcript {
    padding-left: 56px;
    padding-right: 56px;
  }
}

/*
 * 轨道自己的显示阈值仍是 960px；容器比视口窄时在这里整条收掉，
 * 否则它会压在对话列上。
 */
@container imagio-view (max-width: 959px) {
  .imagio-transcript > [data-slot='chat-turn-rail'] {
    display: none;
  }
}

.imagio-conversation {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 28px;
  width: min(920px, 100%);
  min-width: 0;
  min-height: 0;
  margin: 0 auto 18px;
  overflow-y: auto;
  padding: 12px 8px 4px;
  scrollbar-color: hsl(var(--muted-foreground) / 0.22) transparent;
  scrollbar-width: thin;
}

.conversation-turn {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.conversation-ai {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: min(78%, 680px);
}

.conversation-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0;
}

.conversation-output {
  min-width: 0;
}

.conversation-label {
  margin: 2px 0 7px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 500;
}

.conversation-image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  max-width: 560px;
}

.conversation-image {
  display: block;
  min-width: 0;
  aspect-ratio: 1 / 1;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg, 8px);
  background: transparent;
  cursor: pointer;
}

.conversation-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.conversation-image-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 12px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 500;
}

.conversation-user {
  align-self: flex-end;
  width: min(72%, 560px);
  padding: 12px 14px;
  border-radius: 18px 18px 6px 18px;
  /* 分层靠留白和极淡描边，不靠反白：纯黑块把整屏最重的对比度放在了最该安静的对话区。 */
  border: 1px solid hsl(var(--foreground) / 0.08);
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground));
  transition: background-color 150ms ease-out, border-color 150ms ease-out;
}

.conversation-user p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.6;
}

.conversation-reference-list {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  overflow-x: auto;
}

.conversation-reference-list img {
  display: block;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  border-radius: 7px;
  object-fit: cover;
  border: 1px solid hsl(var(--background) / 0.22);
}

.prompt-area {
  flex: none;
  width: min(920px, 100%);
  margin: auto auto 0;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg, 8px);
  background: hsl(var(--card));
  padding: 12px 14px;
  /* 输入框是唯一需要「浮起」的表面，焦点环已经承担了这个职责，不需要静态投影。 */
}

.prompt-input {
  display: block;
  width: 100%;
  min-height: 108px;
  padding: 8px 4px;
  border: 0;
  background: transparent;
  font-size: 14px;
  line-height: 1.7;
  color: hsl(var(--foreground));
  resize: vertical;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
  font-family: inherit;
}

.prompt-input::placeholder {
  color: hsl(var(--muted-foreground));
}

.prompt-input:focus {
  outline: none;
}

.prompt-area:focus-within {
  border-color: hsl(var(--ring));
  box-shadow: 0 0 0 2px hsl(var(--ring) / 0.14);
}

.prompt-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.prompt-reference {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 0 1 auto;
}

.reference-add {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md, 7px);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.reference-add:hover:not(:disabled) {
  border-color: hsl(var(--ring));
  background: hsl(var(--accent));
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
  max-width: 96px;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 0;
}

.reference-item {
  position: relative;
  flex: 0 0 auto;
  width: 46px;
  height: 46px;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md, 7px);
  overflow: hidden;
  background: hsl(var(--card));
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
  border-radius: var(--radius-sm, 6px);
  background: hsl(var(--foreground) / 0.76);
  color: hsl(var(--background));
  cursor: pointer;
}

.reference-error {
  margin: 0 0 4px;
  color: hsl(var(--destructive));
  font-size: 12px;
  font-weight: 500;
}

/* Inline parameter panel (shown on narrow viewports) */
.inline-params {
  width: 100%;
  max-width: 100%;
  padding: 16px;
  background: hsl(var(--background));
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-lg, 8px);
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
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 500;
}

.param-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.aspect-ratio-group .param-buttons {
  display: grid;
  grid-template-columns: repeat(4, max-content);
}

.param-buttons button {
  min-height: 30px;
  padding: 4px 14px;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md, 7px);
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.param-buttons button:hover {
  border-color: hsl(var(--ring));
  color: hsl(var(--foreground));
}

.param-buttons button.active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
}

.param-group .param-hint {
  margin: 6px 0 0;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
}

/*
 * 参数栏的折叠阈值跟着容器走：侧栏展开时 1180px 的视口只剩一千出头留给对话，
 * 按视口判断会让 320px 的参数栏继续占着位置。
 */
@container imagio-view (max-width: 1180px) {
  .imagio-body {
    flex-direction: column;
  }

  /* The parameter panel used to be a full-width block that pushed the
     conversation halfway down. On narrow viewports it collapses into a single
     wrapped row of parameters with no card chrome and no background at all, so
     the transcript keeps the full height and nothing opaque is painted. */
  .imagio-options {
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: flex-start;
    width: 100%;
    order: -1;
    padding: 8px 16px;
    border-left: 0;
    border-bottom: 1px solid var(--color-hairline);
    background: transparent;
    overflow: visible;
  }

  .imagio-options .inline-params {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 28px;
    width: 100%;
    margin-left: 0;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .imagio-options .param-group {
    flex: 0 1 auto;
    margin-bottom: 0;
  }

  .imagio-options .param-group label {
    margin-bottom: 6px;
    font-size: 11px;
  }
}

.prompt-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  min-width: 0;
}

.prompt-actions-end {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-left: auto;
  min-width: 0;
  flex: 1 1 auto;
}

.prompt-model-select {
  width: min(150px, 100%);
  min-width: 0;
  flex: 1 1 80px;
}

.generation-count {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  white-space: nowrap;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  font-weight: 500;
}

.generation-count button {
  min-height: 30px;
  padding: 0 8px;
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-md, 7px);
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.generation-count button:hover {
  border-color: hsl(var(--ring));
  color: hsl(var(--foreground));
}

.generation-count button.active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-color: hsl(var(--primary));
}

.generation-count .count-fixed {
  min-height: 30px;
  padding: 4px 12px;
  border-radius: var(--radius-md, 7px);
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  font-weight: 500;
}

.generate-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 12px;
  flex: 0 0 auto;
  white-space: nowrap;
  border: 0;
  border-radius: var(--radius-lg, 8px);
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  font-family: inherit;
}

.generate-btn:hover:not(:disabled) {
  background: hsl(var(--primary) / 0.9);
}

.generate-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.generate-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 760px) {
  .workspace-heading {
    padding: 12px;
  }

  .workspace-mobile-select {
    display: block;
  }
  .imagio-main {
    padding: 12px;
  }

  .prompt-area {
    padding: 12px;
  }

  .imagio-conversation {
    gap: 22px;
    margin-bottom: 12px;
    padding: 8px 0 2px;
  }

  .conversation-ai {
    max-width: 92%;
  }

  .conversation-user {
    width: 86%;
  }

  .conversation-image-grid {
    max-width: 100%;
  }

  .prompt-actions {
    flex-wrap: wrap;
  }

  .generation-count {
    margin-left: auto;
  }

  .prompt-actions-end {
    width: 100%;
    flex-basis: 100%;
  }

  .prompt-model-select {
    flex: 1;
    width: auto;
  }

  .generate-btn {
    justify-content: center;
  }
}

@media (max-width: 460px) {
  .workspace-heading {
    padding: 8px;
  }

  .imagio-main {
    padding: 8px;
  }

  .prompt-area {
    padding: 12px;
  }

  .prompt-input {
    min-height: 96px;
    font-size: 13px;
  }

  .inline-params {
    width: 100%;
    padding: 12px;
  }

  .param-buttons {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .aspect-ratio-group .param-buttons {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .param-buttons button {
    min-width: 0;
    padding: 4px 8px;
  }
}

@media (max-height: 520px) {
  .imagio-main {
    overflow-y: auto;
    padding: 8px;
  }

  .prompt-area {
    padding: 12px;
  }

  .imagio-conversation {
    min-height: 120px;
    margin-bottom: 8px;
  }

  .prompt-input {
    height: 72px;
    min-height: 72px;
  }

  .prompt-reference {
    flex-direction: row;
    align-items: center;
    flex-basis: auto;
    min-height: 40px;
  }

  .reference-add {
    flex: 0 0 auto;
    min-height: 36px;
  }

  .prompt-actions {
    gap: 8px;
    margin-top: 8px;
  }
}

/*
 * 空态：还没有任何生成记录时，落在「从一个想法开始」这一屏。
 * 卡片只用一层极淡描边划出边界，hover 时才补 5% 的前景填充，
 * 和对话区同一套克制语言——没有阴影、没有底色块，视觉重心仍在输入框。
 */
.imagio-empty {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: center;
  gap: 28px;
  width: min(920px, 100%);
  min-width: 0;
  margin: 0 auto 18px;
  padding: 12px 8px 4px;
}

.empty-intro {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-bottom: 4px;
  border-radius: 10px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
}

.empty-intro h3 {
  margin: 0;
  color: hsl(var(--foreground));
  font-size: 17px;
  font-weight: 600;
}

.empty-intro p {
  max-width: 46ch;
  margin: 0;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  line-height: 1.6;
}

.empty-starters {
  display: grid;
  gap: 12px;
}

.starter-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 106px;
  padding: 16px;
  border: 1px solid hsl(var(--foreground) / 0.06);
  border-radius: 20px;
  background: transparent;
  color: hsl(var(--foreground));
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease-out, border-color 150ms ease-out;
}

.starter-card:hover {
  border-color: hsl(var(--foreground) / 0.2);
  background: hsl(var(--foreground) / 0.05);
}

.starter-card:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 3px;
}

.starter-title {
  font-size: 14px;
  font-weight: 500;
}

.starter-prompt {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 760px) {
  .imagio-empty {
    gap: 20px;
    margin-bottom: 12px;
  }

  .starter-card {
    min-height: 0;
    padding: 14px;
    border-radius: 16px;
  }
}

/* 开了「减少动效」就不再做过场，hover 直接切换终态。 */
@media (prefers-reduced-motion: reduce) {
  .starter-card {
    transition: none;
  }
}

@media (max-height: 520px) {
  @container imagio-view (max-width: 1180px) {
    .imagio-options {
      max-height: 28%;
    }
  }
}
</style>
