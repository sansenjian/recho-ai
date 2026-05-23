<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ModelOption } from '../types'

interface SkillOption {
  name: string
  description: string
  icon: string
}

const props = defineProps<{
  isLoading?: boolean
  currentModel?: ModelOption
  models?: ModelOption[]
  pendingImages?: string[]
  skills?: SkillOption[]
  activeSkill?: string | null
}>()

const emit = defineEmits<{
  submit: [value: string]
  stop: []
  changeModel: [model: ModelOption]
  removeImage: [index: number]
  upload: []
  selectSkill: [name: string | null]
}>()

const inputValue = ref('')
const showModelDropdown = ref(false)

// --- slash command ---
const showSkillMenu = ref(false)
const skillFilter = ref('')
const skillHighlight = ref(0)

const filteredSkills = computed(() => {
  const q = skillFilter.value.toLowerCase()
  if (!q) return (props.skills || [])
  return (props.skills || []).filter(s =>
    s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  )
})

const currentModelStatusLabel = computed(() => {
  if (props.currentModel?.status === 'recommended') return '推荐'
  if (props.currentModel?.status === 'slow') return '备用'
  return props.currentModel?.level || '可用'
})

function modelStatusLabel(model: ModelOption) {
  if (model.status === 'recommended') return '推荐'
  if (model.status === 'slow') return '较慢'
  return model.level
}

function onInput(e: Event) {
  const t = e.target as HTMLTextAreaElement
  t.style.height = 'auto'
  t.style.height = t.scrollHeight + 'px'

  // detect slash command at start of input
  const val = t.value
  if (val.startsWith('/') && !val.includes(' ')) {
    showSkillMenu.value = true
    skillFilter.value = val.slice(1)
    skillHighlight.value = 0
  } else {
    showSkillMenu.value = false
  }
}

// Parse inline slash command: "/skill query" → auto-select skill, keep query
function tryParseSlashCommand(val: string): { skill: string | null; query: string } {
  if (!val.startsWith('/')) return { skill: null, query: val }
  const spaceIdx = val.indexOf(' ')
  if (spaceIdx === -1) return { skill: null, query: val }
  const maybeSkill = val.slice(1, spaceIdx)
  const query = val.slice(spaceIdx + 1).trim()
  if (!query) return { skill: null, query: val }
  const found = (props.skills || []).find(s => s.name === maybeSkill)
  if (found) return { skill: found.name, query }
  return { skill: null, query: val }
}

function pickSkill(skill: SkillOption) {
  emit('selectSkill', skill.name)
  inputValue.value = ''
  showSkillMenu.value = false
  skillFilter.value = ''
}

function dismissSkill() {
  emit('selectSkill', null)
}

function handleKeydown(e: KeyboardEvent) {
  if (showSkillMenu.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      skillHighlight.value = Math.min(skillHighlight.value + 1, filteredSkills.value.length - 1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      skillHighlight.value = Math.max(skillHighlight.value - 1, 0)
      return
    }
    if (e.key === 'Enter' && filteredSkills.value.length > 0) {
      e.preventDefault()
      pickSkill(filteredSkills.value[skillHighlight.value])
      return
    }
    if (e.key === 'Escape') {
      showSkillMenu.value = false
      return
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
  if (e.key === 'Backspace' && inputValue.value === '' && props.activeSkill) {
    dismissSkill()
  }
}

function handleSubmit() {
  const trimmed = inputValue.value.trim()
  if (!trimmed && !props.activeSkill) return

  // Support inline "/skill query" format
  const parsed = tryParseSlashCommand(trimmed)
  if (parsed.skill) {
    emit('selectSkill', parsed.skill)
    emit('submit', parsed.query)
  } else {
    emit('submit', trimmed)
  }

  inputValue.value = ''
  showSkillMenu.value = false

  const ta = document.querySelector('.chat-input') as HTMLTextAreaElement | null
  if (ta) {
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }
}

function selectModel(m: ModelOption) {
  emit('changeModel', m)
  showModelDropdown.value = false
}
</script>

<template>
  <footer class="chat-footer">
    <!-- active skill tag -->
    <div v-if="activeSkill" class="skill-tag-row">
      <div class="skill-tag">
        <span class="skill-tag-label">/{{ activeSkill }}</span>
        <button class="skill-tag-close" @click="dismissSkill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
    <!-- Pending images preview -->
    <div v-if="pendingImages && pendingImages.length > 0" class="pending-images">
      <div v-for="(img, idx) in pendingImages" :key="idx" class="pending-img-wrap">
        <img :src="img" class="pending-img" />
        <button class="pending-img-remove" @click="emit('removeImage', idx)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
    <div class="composer-toolbar">
      <div class="toolbar-left">
        <button
          class="model-selector"
          type="button"
          :aria-expanded="showModelDropdown"
          aria-haspopup="listbox"
          @click="showModelDropdown = !showModelDropdown"
        >
          <span class="model-selector-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
              <path d="M12 2a4 4 0 0 1 4 4v1h1a4 4 0 0 1 0 8h-1v1a4 4 0 0 1-8 0v-1H7a4 4 0 0 1 0-8h1V6a4 4 0 0 1 4-4Z" />
              <path d="M9 9h6v6H9z" />
            </svg>
          </span>
          <span class="model-selector-text">
            <span class="model-selector-label">模型</span>
            <span class="model-selector-name">{{ currentModel?.label }}</span>
          </span>
          <span class="model-selector-status" :class="currentModel?.status">{{ currentModelStatusLabel }}</span>
          <svg class="chevron" viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        <div v-if="showModelDropdown" class="model-dropdown" role="listbox">
          <button
            v-for="m in models"
            :key="m.id"
            class="model-option"
            :class="{ active: m.id === currentModel?.id }"
            type="button"
            role="option"
            :aria-selected="m.id === currentModel?.id"
            @click.stop="selectModel(m)"
          >
            <span class="model-option-main">
              <span class="model-option-name">{{ m.label }}</span>
              <span class="model-option-provider">{{ m.provider }}</span>
            </span>
            <span class="model-option-hint">{{ m.hint }}</span>
            <span class="model-option-level" :class="m.status">{{ modelStatusLabel(m) }}</span>
          </button>
        </div>
      </div>
      <div class="toolbar-right">
        <span class="footer-link">云端工具</span>
      </div>
    </div>

    <div class="input-container">
      <textarea
        v-model="inputValue"
        class="chat-input"
        :placeholder="activeSkill ? '输入消息...' : '输入 / 作为命令'"
        rows="1"
        :disabled="isLoading"
        @keydown="handleKeydown"
        @input="onInput"
      />
      <!-- skill suggestions dropdown -->
      <div v-if="showSkillMenu && filteredSkills.length > 0" class="skill-dropdown">
        <div
          v-for="(s, idx) in filteredSkills"
          :key="s.name"
          class="skill-option"
          :class="{ highlighted: idx === skillHighlight }"
          @click="pickSkill(s)"
          @mouseenter="skillHighlight = idx"
        >
          <span class="skill-option-icon">{{ s.icon === 'languages' ? '🌐' : s.icon === 'code' ? '🔍' : s.icon === 'file-text' ? '📝' : '⚡' }}</span>
          <div class="skill-option-info">
            <span class="skill-option-name">/{{ s.name }}</span>
            <span class="skill-option-desc">{{ s.description }}</span>
          </div>
        </div>
      </div>
      <div class="input-actions">
        <button class="input-icon-btn" title="上传图片" @click="emit('upload')">
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
        <span class="footer-link">输入 / 选择技能</span>
      </div>
      <div class="footer-right">
        <span class="footer-link">{{ currentModel?.id }}</span>
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

.composer-toolbar {
  max-width: 720px;
  margin: 0 auto 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  position: relative;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  min-width: 0;
}

.pending-images {
  max-width: 720px;
  margin: 0 auto 8px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pending-img-wrap {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}

.pending-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pending-img-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.pending-img-remove:hover {
  background: rgba(0, 0, 0, 0.7);
}

/* skill tag */
.skill-tag-row {
  max-width: 720px;
  margin: 0 auto 8px;
}

.skill-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid var(--accent);
  border-radius: 16px;
  font-size: 12px;
}

.skill-tag-label {
  font-weight: 600;
  color: var(--accent);
}

.skill-tag-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}

.skill-tag-close:hover {
  background: rgba(99, 102, 241, 0.2);
}

/* skill dropdown */
.skill-dropdown {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  padding: 4px;
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
}

.skill-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
}

.skill-option:hover,
.skill-option.highlighted {
  background: var(--hover-bg);
}

.skill-option-icon {
  font-size: 16px;
  width: 24px;
  text-align: center;
}

.skill-option-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.skill-option-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.skill-option-desc {
  font-size: 11px;
  color: var(--text-secondary);
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

.model-selector {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  max-width: min(520px, 100%);
  padding: 5px 8px 5px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.model-selector:hover {
  border-color: rgba(99, 102, 241, 0.35);
  background: #fbfbff;
}

.model-selector-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: var(--accent);
}

.model-selector-text {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.model-selector-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.model-selector-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-selector-status {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--input-bg);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.model-selector-status.recommended,
.model-option-level.recommended {
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
}

.model-selector-status.slow,
.model-option-level.slow {
  background: rgba(245, 158, 11, 0.12);
  color: #92400e;
}

.model-selector .chevron {
  color: var(--text-secondary);
  transition: transform 0.15s;
}

.model-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  padding: 8px;
  width: min(420px, calc(100vw - 48px));
  z-index: 100;
}

.model-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.15s;
}

.model-option:hover {
  background: var(--hover-bg);
}

.model-option.active {
  background: rgba(99, 102, 241, 0.08);
}

.model-option-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 150px;
  min-width: 0;
}

.model-option-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option-provider {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
}

.model-option-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option-level {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  padding: 2px 6px;
  background: var(--input-bg);
  border-radius: 999px;
}

@media (max-width: 640px) {
  .composer-toolbar {
    align-items: stretch;
    flex-direction: column;
    gap: 6px;
  }

  .toolbar-right {
    display: none;
  }

  .model-selector {
    width: 100%;
    justify-content: flex-start;
  }

  .model-selector-text {
    flex: 1;
  }

  .model-dropdown {
    width: 100%;
  }

  .model-option {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .model-option-main {
    width: calc(100% - 56px);
  }

  .model-option-hint {
    flex-basis: 100%;
    padding-left: 0;
  }
}
</style>
