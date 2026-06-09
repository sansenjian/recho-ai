<script setup lang="ts">
import type { StyleValue } from 'vue'
import {
  createRichContentDirective,
  type MentionTokenResolver,
} from '../lib/image-mention-editor'
import type {
  CanvasHandle,
  CanvasNode,
  InputHandle,
  MentionField,
  MentionState,
  NodeAspectRatio,
  NodeGenerationCount,
  NodeQuality,
  NodeResolution,
  ResizeCorner,
} from '../lib/image-canvas-model'

type NodeOption<T extends string | number> = {
  value: T
  label: string
}

type ConnectedHandles = Partial<Record<InputHandle, boolean>>

const props = defineProps<{
  node: CanvasNode
  selected: boolean
  nodeStyle: StyleValue
  mentionState: MentionState | null
  mentionOptions: CanvasNode[]
  textMentionOpen: boolean
  generationMentionOpen: boolean
  connectedHandles: ConnectedHandles
  isGeneratedImageNode: boolean
  imageAlt: string
  imageOutputMeta: string
  isDownloading: boolean
  hasPromptLink: boolean
  generationPromptValue: string
  referencedImageNodes: CanvasNode[]
  canSelectGenerationCount: boolean
  generationCount: NodeGenerationCount
  generationCountOptions: Array<NodeOption<NodeGenerationCount>>
  resolutionOptions: Array<NodeOption<NodeResolution>>
  aspectRatioOptions: Array<NodeOption<NodeAspectRatio>>
  qualityOptions: Array<NodeOption<NodeQuality>>
  isGenerating: boolean
  resolveMentionToken: MentionTokenResolver
}>()

const emit = defineEmits<{
  select: [nodeId: string]
  'open-context-menu': [event: MouseEvent, node: CanvasNode]
  'start-drag': [event: PointerEvent, node: CanvasNode]
  remove: [nodeId: string]
  'rich-input': [event: Event, node: CanvasNode, field: MentionField]
  'mention-keydown': [event: KeyboardEvent, node: CanvasNode, field: MentionField]
  'mention-caret': [root: HTMLElement, node: CanvasNode, field: MentionField]
  'insert-mention': [node: CanvasNode, imageNode: CanvasNode]
  'start-connection': [event: PointerEvent, node: CanvasNode, handle: CanvasHandle]
  'finish-connection': [event: PointerEvent, node: CanvasNode, handle: CanvasHandle]
  'choose-image': [nodeId: string]
  'image-load': [node: CanvasNode, event: Event]
  'open-image-viewer': [node: CanvasNode]
  'update-content': [node: CanvasNode, value: string]
  'create-continuation': [node: CanvasNode]
  'preload-download': [node: CanvasNode]
  download: [node: CanvasNode]
  'send-to-chat': [node: CanvasNode]
  'update-resolution': [node: CanvasNode, value: NodeResolution]
  'update-aspect-ratio': [node: CanvasNode, value: NodeAspectRatio]
  'update-quality': [node: CanvasNode, value: NodeQuality]
  'update-generation-count': [node: CanvasNode, value: NodeGenerationCount]
  generate: [node: CanvasNode]
  'start-resize': [event: PointerEvent, node: CanvasNode, corner: ResizeCorner]
  'reset-scale': [node: CanvasNode]
}>()

const vRichContent = createRichContentDirective((id, title) => props.resolveMentionToken(id, title))

function isHandleConnected(handle: InputHandle) {
  return Boolean(props.connectedHandles[handle])
}

function emitMentionCaret(event: Event, field: MentionField) {
  if (event.currentTarget instanceof HTMLElement) {
    emit('mention-caret', event.currentTarget, props.node, field)
  }
}

function emitTextContent(event: Event) {
  if (event.currentTarget instanceof HTMLTextAreaElement || event.currentTarget instanceof HTMLInputElement) {
    emit('update-content', props.node, event.currentTarget.value)
  }
}
</script>

<template>
  <article
    class="canvas-node"
    :class="[`node-${node.type}`, { selected }]"
    :style="nodeStyle"
    @pointerdown.stop="emit('select', node.id)"
    @contextmenu.stop.prevent="emit('open-context-menu', $event, node)"
  >
    <header class="node-header" @pointerdown.stop="emit('start-drag', $event, node)">
      <span class="node-icon" aria-hidden="true">
        <svg v-if="node.type === 'text'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="15" height="15">
          <path d="M4 6h16" />
          <path d="M10 6v12" />
          <path d="M14 6v12" />
        </svg>
        <svg v-else-if="node.type === 'image'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
          <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
        </svg>
      </span>
      <span class="node-title">{{ node.title }}</span>
      <button class="node-remove" type="button" title="删除节点" @click.stop="emit('remove', node.id)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </header>

    <template v-if="node.type === 'text'">
      <div
        v-rich-content="node.content"
        class="node-textarea rich-editor"
        contenteditable="true"
        data-placeholder="输入文本内容，可用 @ 引用图片..."
        @input="emit('rich-input', $event, node, 'text')"
        @keydown="emit('mention-keydown', $event, node, 'text')"
        @keyup="emitMentionCaret($event, 'text')"
        @pointerup="emitMentionCaret($event, 'text')"
        @focus="emitMentionCaret($event, 'text')"
        @pointerdown.stop
      />
      <div
        v-if="textMentionOpen"
        class="mention-index text-mention-index"
        @pointerdown.stop.prevent
      >
        <button
          v-for="(imageNode, index) in mentionOptions"
          :key="imageNode.id"
          type="button"
          :class="{ active: mentionState?.activeIndex === index }"
          @pointerdown.prevent="emit('insert-mention', node, imageNode)"
        >
          <img v-if="imageNode.imageUrl" :src="imageNode.imageUrl" :alt="imageNode.title">
          <span>{{ imageNode.title }}</span>
          <small>{{ imageNode.content || imageNode.fileName || '图片参考' }}</small>
        </button>
      </div>
      <span
        class="node-handle output"
        title="连接到生图节点"
        @pointerdown.stop.prevent="emit('start-connection', $event, node, 'text-out')"
        @pointerup.stop.prevent="emit('finish-connection', $event, node, 'text-out')"
      />
    </template>

    <template v-else-if="node.type === 'image'">
      <span
        class="node-handle input"
        title="接收生成结果"
        :class="{ connected: isHandleConnected('image-in') }"
        @pointerdown.stop.prevent="emit('start-connection', $event, node, 'image-in')"
        @pointerup.stop.prevent="emit('finish-connection', $event, node, 'image-in')"
      />
      <div class="image-preview" :class="{ empty: !node.imageUrl, generated: isGeneratedImageNode }">
        <img
          v-if="node.imageUrl"
          :src="node.imageUrl"
          :alt="imageAlt"
          loading="lazy"
          @load="emit('image-load', node, $event)"
          @dblclick.stop="emit('open-image-viewer', node)"
        >
        <button v-else class="pick-image" type="button" @click.stop="emit('choose-image', node.id)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="26" height="26">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M12 8v8" />
            <path d="M8 12h8" />
          </svg>
        </button>
        <button
          v-if="node.imageUrl"
          class="zoom-image"
          type="button"
          title="放大查看"
          @click.stop="emit('open-image-viewer', node)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16.2 16.2 4.3 4.3" />
            <path d="M11 8.8v4.4" />
            <path d="M8.8 11h4.4" />
          </svg>
        </button>
        <button v-if="node.imageUrl" class="replace-image" type="button" title="替换图片" @click.stop="emit('choose-image', node.id)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v6h-6" />
          </svg>
        </button>
      </div>
      <div v-if="isGeneratedImageNode" class="image-output-panel">
        <div class="image-output-meta">
          <span class="image-output-badge">生成结果</span>
          <span>{{ imageOutputMeta }}</span>
        </div>
        <input
          :value="node.content"
          class="image-output-note"
          type="text"
          placeholder="添加参考说明..."
          @input="emitTextContent"
          @pointerdown.stop
        >
      </div>
      <textarea
        v-else
        :value="node.content"
        class="image-caption"
        placeholder="图片参考说明..."
        @input="emitTextContent"
        @pointerdown.stop
      />
      <div class="image-node-actions">
        <button type="button" :disabled="!node.imageUrl" @click.stop="emit('create-continuation', node)">继续</button>
        <button
          type="button"
          :disabled="!node.imageUrl || isDownloading"
          @pointerenter="emit('preload-download', node)"
          @focus="emit('preload-download', node)"
          @click.stop="emit('download', node)"
        >
          {{ isDownloading ? '下载中' : '下载' }}
        </button>
        <button type="button" :disabled="!node.imageUrl" @click.stop="emit('send-to-chat', node)">对话</button>
      </div>
      <span
        class="node-handle output"
        title="作为参考图连接"
        @pointerdown.stop.prevent="emit('start-connection', $event, node, 'image-out')"
        @pointerup.stop.prevent="emit('finish-connection', $event, node, 'image-out')"
      />
    </template>

    <template v-else>
      <span
        class="node-handle input prompt"
        title="连接文本"
        :class="{ connected: isHandleConnected('prompt-in') }"
        @pointerdown.stop.prevent="emit('start-connection', $event, node, 'prompt-in')"
        @pointerup.stop.prevent="emit('finish-connection', $event, node, 'prompt-in')"
      />
      <span
        class="node-handle input reference"
        title="连接参考图"
        :class="{ connected: isHandleConnected('reference-in') }"
        @pointerdown.stop.prevent="emit('start-connection', $event, node, 'reference-in')"
        @pointerup.stop.prevent="emit('finish-connection', $event, node, 'reference-in')"
      />
      <span
        class="node-handle output generation"
        title="输出图片"
        @pointerdown.stop.prevent="emit('start-connection', $event, node, 'generation-out')"
        @pointerup.stop.prevent="emit('finish-connection', $event, node, 'generation-out')"
      />

      <div class="generation-body">
        <div class="generation-scroll">
          <div
            v-if="hasPromptLink"
            v-rich-content="generationPromptValue"
            class="generation-prompt rich-editor readonly"
          />
          <div
            v-else
            v-rich-content="node.content"
            class="generation-prompt rich-editor"
            contenteditable="true"
            data-placeholder="输入文本内容，可用 @ 引用图片。"
            @input="emit('rich-input', $event, node, 'generation')"
            @keydown="emit('mention-keydown', $event, node, 'generation')"
            @keyup="emitMentionCaret($event, 'generation')"
            @pointerup="emitMentionCaret($event, 'generation')"
            @focus="emitMentionCaret($event, 'generation')"
            @pointerdown.stop
          />
          <div
            v-if="generationMentionOpen"
            class="mention-index generation-mention-index"
            @pointerdown.stop.prevent
          >
            <button
              v-for="(imageNode, index) in mentionOptions"
              :key="imageNode.id"
              type="button"
              :class="{ active: mentionState?.activeIndex === index }"
              @pointerdown.prevent="emit('insert-mention', node, imageNode)"
            >
              <img v-if="imageNode.imageUrl" :src="imageNode.imageUrl" :alt="imageNode.title">
              <span>{{ imageNode.title }}</span>
              <small>{{ imageNode.content || imageNode.fileName || '图片参考' }}</small>
            </button>
          </div>

          <div class="linked-block reference-block">
            <div class="linked-row">
              <span class="linked-label">参考图</span>
              <span class="linked-count">{{ referencedImageNodes.length }} 张</span>
            </div>
            <div class="reference-list">
              <div v-for="imageNode in referencedImageNodes" :key="imageNode.id" class="reference-chip">
                <img v-if="imageNode.imageUrl" :src="imageNode.imageUrl" :alt="imageNode.content || imageNode.title">
                <span>{{ imageNode.title }} · {{ imageNode.content || imageNode.fileName || '参考图' }}</span>
              </div>
              <p v-if="!referencedImageNodes.length">暂无参考图，可输入 @图片1 引用</p>
            </div>
          </div>

          <div v-if="canSelectGenerationCount" class="control-group count-control">
            <div class="linked-row">
              <span class="control-label">数量</span>
              <span class="linked-count">图片</span>
            </div>
            <div class="segmented count-segmented">
              <button
                v-for="option in generationCountOptions"
                :key="option.value"
                type="button"
                :class="{ active: generationCount === option.value }"
                @click.stop="emit('update-generation-count', node, option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="control-group">
            <span class="control-label">分辨率</span>
            <div class="segmented four-option-segmented">
              <button
                v-for="option in resolutionOptions"
                :key="option.value"
                type="button"
                :class="{ active: node.resolution === option.value }"
                @click.stop="emit('update-resolution', node, option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <span class="control-hint">Auto 会交给模型选择；1K/2K/4K 会按比例映射输出尺寸。</span>
          </div>

          <div class="control-group">
            <span class="control-label">尺寸 / 比例</span>
            <div class="segmented aspect-grid">
              <button
                v-for="option in aspectRatioOptions"
                :key="option.value"
                type="button"
                :class="{ active: node.aspectRatio === option.value }"
                @click.stop="emit('update-aspect-ratio', node, option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="control-group">
            <span class="control-label">质量</span>
            <div class="segmented four-option-segmented">
              <button
                v-for="option in qualityOptions"
                :key="option.value"
                type="button"
                :class="{ active: node.quality === option.value }"
                @click.stop="emit('update-quality', node, option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <span class="control-hint">Low 适合快速草图，Medium/High 适合最终资产。</span>
          </div>
        </div>

        <div class="generation-footer">
          <p v-if="node.loading" class="node-status">{{ node.status || '生成中...' }}</p>
          <p v-else-if="isGenerating" class="node-status">已有图片正在生成，请稍等...</p>
          <p v-if="node.error" class="node-error">{{ node.error }}</p>

          <button
            class="generate-button"
            type="button"
            :disabled="isGenerating || node.loading"
            @click.stop="emit('generate', node)"
          >
            <span v-if="node.loading || isGenerating" class="spinner" />
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
              <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
            </svg>
            {{ node.loading || isGenerating ? '生成中...' : '生成' }}
          </button>
        </div>
      </div>
    </template>

    <span
      class="resize-corner top-left"
      @pointerdown.stop.prevent="emit('start-resize', $event, node, 'top-left')"
      @dblclick.stop.prevent="emit('reset-scale', node)"
    />
    <span
      class="resize-corner top-right"
      @pointerdown.stop.prevent="emit('start-resize', $event, node, 'top-right')"
      @dblclick.stop.prevent="emit('reset-scale', node)"
    />
    <span
      class="resize-corner bottom-left"
      @pointerdown.stop.prevent="emit('start-resize', $event, node, 'bottom-left')"
      @dblclick.stop.prevent="emit('reset-scale', node)"
    />
    <span
      class="resize-corner bottom-right"
      @pointerdown.stop.prevent="emit('start-resize', $event, node, 'bottom-right')"
      @dblclick.stop.prevent="emit('reset-scale', node)"
    />
  </article>
</template>

<style scoped>
.canvas-node {
  position: absolute;
  display: flex;
  box-sizing: border-box;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.09);
  color: var(--text-primary);
}

.canvas-node.selected {
  border-color: #111827;
  box-shadow: 0 0 0 2px rgba(17, 24, 39, 0.08), 0 22px 56px rgba(15, 23, 42, 0.12);
}

.node-image,
.node-generation {
  overflow: visible;
}

.node-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  border-radius: 8px 8px 0 0;
  background: #fff;
  cursor: grab;
  user-select: none;
}

.node-header:active {
  cursor: grabbing;
}

.node-icon {
  display: inline-flex;
  color: var(--text-primary);
}

.node-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 13px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
}

.canvas-node:hover .node-remove {
  opacity: 1;
}

.node-remove:hover {
  background: var(--hover-bg);
  color: var(--danger);
}

.node-textarea,
.generation-prompt,
.image-caption {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: inherit;
  resize: none;
  outline: none;
}

.node-textarea {
  flex: 0 0 auto;
  min-height: 118px;
  padding: 12px;
  color: var(--text-primary);
  font-size: calc(13px * var(--node-text-content-scale, 1));
  line-height: 1.55;
  overflow: visible;
  white-space: pre-wrap;
  word-break: break-word;
}

.rich-editor:empty::before {
  content: attr(data-placeholder);
  color: #a8b1bf;
  pointer-events: none;
}

.rich-editor.readonly {
  cursor: default;
}

.mention-token {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 132px;
  min-height: 26px;
  margin: 0 2px;
  padding: 2px 6px 2px 3px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
  vertical-align: middle;
  white-space: nowrap;
}

.mention-token img {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  object-fit: cover;
}

.mention-token span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-textarea::placeholder,
.generation-prompt::placeholder,
.image-caption::placeholder {
  color: #a8b1bf;
}

.image-preview {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  height: var(--image-preview-height, 136px);
  min-height: 0;
  margin: 10px 10px 0;
  border-radius: 7px;
  background: transparent;
  overflow: hidden;
}

.image-preview.empty {
  height: var(--image-preview-height, 136px);
  min-height: 0;
  border: 1px dashed var(--border-strong);
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    #f8fafc;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.image-preview img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  border-radius: 7px;
  background:
    linear-gradient(45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(148, 163, 184, 0.12) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(148, 163, 184, 0.12) 75%),
    #f8fafc;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  object-fit: cover;
}

.image-preview.generated {
  max-height: none;
}

.pick-image,
.replace-image {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-secondary);
  cursor: pointer;
}

.pick-image {
  width: 46px;
  height: 46px;
}

.replace-image {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 30px;
  height: 30px;
}

.zoom-image {
  position: absolute;
  right: 8px;
  top: 8px;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  color: var(--text-secondary);
  cursor: pointer;
}

.zoom-image:hover {
  border-color: var(--border-strong);
  background: #fff;
  color: var(--text-primary);
}

.image-caption {
  flex: 0 0 auto;
  min-height: 48px;
  padding: 8px 10px 2px;
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
}

.image-output-panel {
  flex: 0 0 auto;
  display: grid;
  gap: 6px;
  padding: 8px 10px 4px;
}

.image-output-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.image-output-meta span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.image-output-badge {
  flex: 0 0 auto;
  padding: 3px 6px;
  border-radius: 6px;
  background: rgba(14, 165, 233, 0.1);
  color: #0369a1;
  font-size: 10px;
  font-weight: 900;
}

.image-output-note {
  width: 100%;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 8px;
  background: #fff;
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.image-output-note:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.12);
}

.image-output-note::placeholder {
  color: #a8b1bf;
}

.image-node-actions {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 6px 10px 10px;
}

.image-node-actions button {
  min-height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.image-node-actions button:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--hover-bg);
}

.image-node-actions button:disabled {
  opacity: 0.46;
  cursor: not-allowed;
}

.resize-corner {
  position: absolute;
  z-index: 8;
  width: 18px;
  height: 18px;
  background: transparent;
}

.resize-corner.top-left {
  left: -6px;
  top: -6px;
  cursor: nwse-resize;
}

.resize-corner.top-right {
  right: -6px;
  top: -6px;
  cursor: nesw-resize;
}

.resize-corner.bottom-left {
  left: -6px;
  bottom: -6px;
  cursor: nesw-resize;
}

.resize-corner.bottom-right {
  right: -6px;
  bottom: -6px;
  cursor: nwse-resize;
}

.node-handle {
  position: absolute;
  z-index: 5;
  width: 12px;
  height: 12px;
  border: 2px solid #111827;
  border-radius: 999px;
  background: #111827;
  cursor: crosshair;
}

.node-handle.input {
  left: -7px;
  top: 122px;
  background: #fff;
}

.node-handle.output {
  right: -7px;
  top: 72px;
}

.node-image .node-handle.output {
  top: calc(50% - 6px);
}

.node-image .node-handle.input {
  top: calc(50% - 6px);
}

.node-handle.prompt {
  top: 84px;
}

.node-handle.reference {
  top: 168px;
}

.node-handle.generation {
  top: 182px;
}

.node-handle.connected {
  background: var(--accent);
  border-color: var(--accent);
}

.generation-body {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  min-height: 0;
  overflow: visible;
  padding: 10px 12px 12px;
}

.generation-scroll {
  display: flex;
  min-height: 0;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 9px;
  overflow: visible;
}

.generation-footer {
  display: grid;
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.98);
}

.mention-index {
  position: absolute;
  z-index: 24;
  display: grid;
  gap: 3px;
  max-height: 184px;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
  overflow-y: auto;
}

.text-mention-index {
  left: 12px;
  right: 12px;
  top: 92px;
}

.generation-mention-index {
  left: 12px;
  right: 12px;
  top: 86px;
}

.mention-index button {
  display: grid;
  grid-template-columns: 28px 56px 1fr;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.mention-index button.active,
.mention-index button:hover {
  background: var(--hover-bg);
}

.mention-index img {
  width: 28px;
  height: 28px;
  border-radius: 5px;
  object-fit: cover;
}

.mention-index span {
  font-size: 12px;
  font-weight: 900;
}

.mention-index small {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.linked-block {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fbfcfe;
  padding: 8px;
}

.linked-block p {
  display: -webkit-box;
  min-height: 39px;
  max-height: 58px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.linked-label,
.control-label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 800;
}

.generation-prompt {
  flex: 0 0 auto;
  min-height: 116px;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  font-size: 12px;
  line-height: 1.45;
  overflow: visible;
  white-space: pre-wrap;
  word-break: break-word;
}

.linked-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.linked-count {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.reference-block {
  flex: 0 0 auto;
  min-height: 76px;
}

.reference-list {
  display: grid;
  gap: 6px;
  max-height: none;
  overflow: hidden;
}

.reference-list p {
  min-height: auto;
  color: var(--text-muted);
  font-size: 12px;
}

.reference-chip {
  display: grid;
  grid-template-columns: 24px 1fr;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.reference-chip img {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  object-fit: cover;
}

.reference-chip span {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.control-group {
  display: grid;
  gap: 6px;
}

.control-hint {
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.35;
}

.segmented {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.segmented.aspect-grid {
  grid-template-columns: repeat(3, 1fr);
}

.segmented.count-segmented,
.segmented.four-option-segmented {
  grid-template-columns: repeat(4, 1fr);
}

.segmented button {
  min-height: 36px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.segmented button.active {
  border-color: #111827;
  color: #111827;
  box-shadow: inset 0 0 0 1px #111827;
}

.node-status,
.node-error {
  margin: 0;
  font-size: 11px;
  line-height: 1.35;
}

.node-status {
  color: var(--text-muted);
}

.node-error {
  color: var(--danger);
}

.generate-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  border: 0;
  border-radius: 7px;
  background: #050505;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
}

.generate-button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(255, 255, 255, 0.34);
  border-top-color: #fff;
  border-radius: 999px;
  animation: image-canvas-node-spin 0.7s linear infinite;
}

.node-header,
.node-handle,
.resize-corner {
  touch-action: none;
}

@keyframes image-canvas-node-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 760px) {
  .node-header {
    min-height: 56px;
    padding: 0 8px 0 12px;
  }

  .node-remove {
    width: 48px;
    height: 48px;
    opacity: 1;
  }

  .node-handle {
    width: 30px;
    height: 30px;
    border-width: 3px;
  }

  .node-handle.input {
    left: -16px;
  }

  .node-handle.output {
    right: -16px;
  }

  .resize-corner {
    width: 44px;
    height: 44px;
  }

  .resize-corner.top-left {
    left: -12px;
    top: -12px;
  }

  .resize-corner.top-right {
    right: -12px;
    top: -12px;
  }

  .resize-corner.bottom-left {
    left: -12px;
    bottom: -12px;
  }

  .resize-corner.bottom-right {
    right: -12px;
    bottom: -12px;
  }

  .pick-image {
    width: 64px;
    height: 64px;
  }

  .replace-image,
  .zoom-image {
    width: 52px;
    height: 52px;
  }

  .image-node-actions button,
  .segmented button,
  .generate-button,
  .mention-index button {
    min-height: 58px;
  }
}
</style>
