<script setup lang="ts">
import type { CanvasNodeType } from '../lib/image-canvas-model'

defineProps<{
  x: number
  y: number
  hasNode: boolean
}>()

const emit = defineEmits<{
  rename: []
  duplicate: []
  delete: []
  'create-node': [type: CanvasNodeType]
}>()
</script>

<template>
  <div
    class="context-menu non-selectable"
    :style="{ transform: `translate(${x}px, ${y}px)` }"
    @click.stop
  >
    <template v-if="hasNode">
      <button type="button" @click="emit('rename')">
        <span class="menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </span>
        <span>重命名</span>
      </button>
      <button type="button" @click="emit('duplicate')">
        <span class="menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <rect x="8" y="8" width="11" height="11" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
          </svg>
        </span>
        <span>复制节点</span>
      </button>
      <button type="button" class="danger" @click="emit('delete')">
        <span class="menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="m6 6 1 15h10l1-15" />
          </svg>
        </span>
        <span>删除</span>
      </button>
    </template>
    <template v-else>
      <button type="button" @click="emit('create-node', 'text')">
        <span class="menu-icon">T</span>
        <span>文本节点</span>
      </button>
      <button type="button" @click="emit('create-node', 'image')">
        <span class="menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </span>
        <span>图片节点</span>
      </button>
      <button type="button" @click="emit('create-node', 'generation')">
        <span class="menu-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
          </svg>
        </span>
        <span>生图节点</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.context-menu {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 30;
  width: 176px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.16);
  backdrop-filter: blur(10px);
}

.context-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 40px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  text-align: left;
}

.context-menu button:hover {
  background: var(--hover-bg);
}

.context-menu button.danger {
  color: var(--danger);
}

.context-menu button.danger .menu-icon {
  color: var(--danger);
}

.menu-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 900;
}
</style>
