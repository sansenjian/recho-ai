<script setup lang="ts">
const props = defineProps<{
  zoom: number
  minZoom: number
  maxZoom: number
  zoomLabel: string
}>()

const emit = defineEmits<{
  'update:zoom': [value: number]
}>()

function setZoom(value: number) {
  emit('update:zoom', Math.min(props.maxZoom, Math.max(props.minZoom, value)))
}

function handleZoomInput(event: Event) {
  if (event.currentTarget instanceof HTMLInputElement) {
    setZoom(Number(event.currentTarget.value))
  }
}
</script>

<template>
  <div class="bottom-toolbar non-selectable">
    <button class="tool-button active" type="button" title="选择">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <path d="m5 3 14 8-6 2-3 6L5 3Z" />
      </svg>
    </button>
    <button class="tool-button" type="button" title="移动画布">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <path d="M18 11V7a2 2 0 0 0-4 0v4" />
        <path d="M14 10V6a2 2 0 0 0-4 0v8" />
        <path d="M10 12.5 8.5 11A2.1 2.1 0 0 0 5 12.5l4.1 5.4A5 5 0 0 0 13.1 20H16a4 4 0 0 0 4-4v-5a2 2 0 0 0-4 0v1" />
      </svg>
    </button>
    <span class="toolbar-divider" />
    <button class="tool-button" type="button" title="缩小" @click="setZoom(zoom - 0.08)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
        <circle cx="11" cy="11" r="7" />
        <path d="M8 11h6" />
        <path d="m16 16 4 4" />
      </svg>
    </button>
    <input
      class="zoom-range"
      type="range"
      :min="minZoom"
      :max="maxZoom"
      :value="zoom"
      step="0.02"
      aria-label="缩放"
      @input="handleZoomInput"
    >
    <button class="tool-button" type="button" title="放大" @click="setZoom(zoom + 0.08)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="18" height="18">
        <circle cx="11" cy="11" r="7" />
        <path d="M8 11h6" />
        <path d="M11 8v6" />
        <path d="m16 16 4 4" />
      </svg>
    </button>
    <span class="zoom-pill">{{ zoomLabel }}</span>
  </div>
</template>

<style scoped>
.bottom-toolbar {
  position: absolute;
  left: 22px;
  bottom: 18px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(12px);
}

.tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.tool-button:hover {
  border-color: var(--border);
  background: var(--hover-bg);
  color: var(--text-primary);
}

.tool-button.active {
  background: #050505;
  color: #fff;
}

.toolbar-divider {
  width: 1px;
  height: 22px;
  background: var(--border);
}

.zoom-range {
  width: 92px;
  accent-color: #111827;
}

.zoom-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 24px;
  padding: 0 7px;
  border-radius: 999px;
  background: #111827;
  color: #fff;
  font-size: 12px;
  font-weight: 900;
}

@media (max-width: 760px) {
  .bottom-toolbar {
    left: 10px;
    right: 10px;
    bottom: 10px;
    display: grid;
    grid-template-columns: 44px 44px 1px 44px minmax(0, 1fr) 44px minmax(42px, auto);
    justify-content: stretch;
    padding: 8px;
  }

  .tool-button {
    width: 44px;
    height: 44px;
  }

  .zoom-pill {
    min-width: 44px;
    height: 44px;
    padding: 0 8px;
  }

  .zoom-range {
    width: 100%;
    min-width: 0;
    height: 34px;
  }

  .toolbar-divider {
    align-self: center;
  }
}

@media (max-width: 380px) {
  .bottom-toolbar {
    grid-template-columns: 38px 38px 1px 38px minmax(58px, 1fr) 38px minmax(42px, auto);
    gap: 5px;
  }

  .tool-button {
    width: 38px;
    height: 38px;
  }

  .zoom-pill {
    height: 38px;
  }
}
</style>
