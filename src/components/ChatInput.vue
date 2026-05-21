<script setup lang="ts">
import { ref } from 'vue'
import type { ModelOption } from '../types'

defineProps<{
  isLoading?: boolean
  currentModel?: ModelOption
  models?: ModelOption[]
}>()

const emit = defineEmits<{
  submit: [value: string]
  stop: []
  changeModel: [model: ModelOption]
}>()

const inputValue = ref('')
const showModelDropdown = ref(false)

function selectModel(m: ModelOption) {
  emit('changeModel', m)
  showModelDropdown.value = false
}

function handleSubmit() {
  const trimmed = inputValue.value.trim()
  if (!trimmed) return
  emit('submit', trimmed)
  inputValue.value = ''

  const ta = document.querySelector('.chat-input') as HTMLTextAreaElement | null
  if (ta) {
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}

function autoResize(e: Event) {
  const t = e.target as HTMLTextAreaElement
  t.style.height = 'auto'
  t.style.height = t.scrollHeight + 'px'
}
</script>

<template>
  <footer class="chat-footer">
    <div class="input-container">
      <textarea
        v-model="inputValue"
        class="chat-input"
        placeholder="输入 / 作为命令"
        rows="1"
        :disabled="isLoading"
        @keydown="handleKeydown"
        @input="autoResize"
      />
      <div class="input-actions">
        <button class="input-icon-btn" title="Attach file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <button
          v-if="isLoading"
          class="stop-btn"
          title="Stop"
          @click="emit('stop')"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
        <button
          v-else
          class="send-btn"
          :class="{ active: inputValue.trim() }"
          :disabled="!inputValue.trim()"
          @click="handleSubmit"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
    <div class="footer-bar">
      <div class="footer-left">
        <span class="footer-link">请求权限</span>
        <span class="footer-link">+</span>
      </div>
      <div class="footer-right">
        <div class="model-selector" @click="showModelDropdown = !showModelDropdown">
          <span class="model-badge">{{ currentModel?.label }} · {{ currentModel?.level }}</span>
          <div class="model-dot"></div>
          <svg class="chevron" viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </div>
        <div v-if="showModelDropdown" class="model-dropdown">
          <div
            v-for="m in models"
            :key="m.id"
            class="model-option"
            :class="{ active: m.id === currentModel?.id }"
            @click.stop="selectModel(m)"
          >
            <span class="model-option-provider">{{ m.provider }}</span>
            <span class="model-option-name">{{ m.label }}</span>
            <span class="model-option-level">{{ m.level }}</span>
          </div>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.chat-footer {
  padding: 12px 24px 16px;
  background: #fff;
  border-top: 1px solid transparent;
  flex-shrink: 0;
}

.input-container {
  max-width: 720px;
  margin: 0 auto 8px;
  position: relative;
}

.chat-input {
  width: 100%;
  padding: 12px 56px 12px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--input-bg);
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--text-primary);
  resize: none;
  outline: none;
  transition: border-color 0.15s, background 0.15s;
  max-height: 200px;
  min-height: 44px;
}

.chat-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.chat-input::placeholder {
  color: #b0b0be;
}

.chat-input:focus {
  border-color: var(--accent);
  background: #fff;
}

.input-actions {
  position: absolute;
  right: 12px;
  bottom: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.input-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s;
}

.input-icon-btn:hover {
  background: var(--hover-bg);
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s;
}

.send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.stop-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: #ef4444;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s;
}

.stop-btn:hover {
  opacity: 0.85;
}

.footer-bar {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 4px;
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.footer-link {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s;
}

.footer-link:hover {
  color: var(--text-primary);
}

.footer-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-badge {
  font-size: 11px;
  color: var(--text-secondary);
}

.model-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  position: relative;
}

.model-selector .chevron {
  color: var(--text-secondary);
  transition: transform 0.15s;
}

.model-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  padding: 6px;
  min-width: 220px;
  z-index: 100;
}

.model-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.model-option:hover {
  background: var(--hover-bg);
}

.model-option.active {
  background: rgba(99, 102, 241, 0.08);
}

.model-option-provider {
  width: 50px;
  font-size: 11px;
  font-weight: 500;
  color: var(--accent);
}

.model-option-name {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
}

.model-option-level {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 6px;
  background: var(--input-bg);
  border-radius: 4px;
}
</style>

