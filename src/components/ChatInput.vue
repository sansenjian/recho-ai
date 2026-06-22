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

const compactModelLabel = computed(() => {
  const label = props.currentModel?.label || '模型'
  return label.replace(/^DeepSeek\s+/, '').replace(/\s+Flash$/, ' Flash')
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
  <footer class="composer-footer">
    <div class="composer-shell">
      <div class="composer-input-wrap">
        <div v-if="pendingImages && pendingImages.length > 0" class="pending-images">
          <div v-for="(img, idx) in pendingImages" :key="idx" class="pending-image">
            <img :src="img" alt="" />
            <button type="button" title="移除图片" @click="emit('removeImage', idx)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <textarea
          v-model="inputValue"
          class="chat-input"
          :placeholder="activeSkill ? '输入消息...' : '要求后续变更'"
          rows="1"
          :disabled="isLoading"
          @keydown="handleKeydown"
          @input="onInput"
        />

        <div v-if="showSkillMenu && filteredSkills.length > 0" class="skill-menu">
          <div
            v-for="(s, idx) in filteredSkills"
            :key="s.name"
            class="skill-option"
            :class="{ active: idx === skillHighlight }"
            @click="pickSkill(s)"
            @mouseenter="skillHighlight = idx"
          >
            <span class="skill-icon">
              <svg v-if="s.icon === 'languages'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <path d="M5 8h10" /><path d="M8 4v4" /><path d="M3 12c3.5 0 6.5-2.5 7.5-6" /><path d="M7 12c1.3 1.6 3 2.7 5 3.2" /><path d="M14 20l4-9 4 9" /><path d="M16 16h4" />
              </svg>
              <svg v-else-if="s.icon === 'code'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <path d="M8 9l-4 3 4 3" /><path d="M16 9l4 3-4 3" /><path d="M13 5l-2 14" />
              </svg>
              <svg v-else-if="s.icon === 'file-text'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h6" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
              </svg>
            </span>
            <span class="skill-copy">
              <strong>/{{ s.name }}</strong>
              <small>{{ s.description }}</small>
            </span>
          </div>
        </div>
      </div>

      <div class="composer-bottom-row">
        <div class="composer-actions left">
          <button class="composer-icon-button plus" type="button" title="上传图片" @click="emit('upload')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="19" height="19">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        <div class="composer-actions right">
          <div class="model-picker">
            <button
              class="model-selector-btn"
              type="button"
              :aria-expanded="showModelDropdown"
              aria-haspopup="listbox"
              @click="showModelDropdown = !showModelDropdown"
            >
              <span class="model-name">{{ compactModelLabel }}</span>
              <svg class="model-chevron" viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>

            <div v-if="showModelDropdown" class="model-dropdown">
              <div class="model-dropdown-title">模型</div>
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
                  <span>{{ m.label }}</span>
                  <small>{{ m.provider }}</small>
                </span>
                <span class="model-option-hint">{{ m.hint }}</span>
                <span class="model-check" aria-hidden="true">
                  <svg v-if="m.id === currentModel?.id" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
              </button>
            </div>
          </div>
          <button
            v-if="isLoading"
            class="composer-submit stop"
            type="button"
            title="停止"
            @click="emit('stop')"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
          <button
            v-else
            class="composer-submit"
            :class="{ ready: inputValue.trim() }"
            :disabled="!inputValue.trim()"
            type="button"
            title="发送"
            @click="handleSubmit"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.composer-footer {
  flex-shrink: 0;
  padding: 12px 20px 16px;
  border-top: 0;
  background: hsl(var(--background) / 0.96);
  backdrop-filter: blur(14px);
}

.composer-shell {
  position: relative;
  width: min(760px, 100%);
  margin: 0 auto;
  overflow: visible;
  border: 1px solid hsl(var(--border));
  border-bottom-color: transparent;
  border-radius: 24px;
  background: hsl(var(--card));
  box-shadow: var(--shadow-sm), 0 12px 30px hsl(var(--foreground) / 0.04);
}

.pending-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 12px 0;
}

.pending-image {
  position: relative;
  width: 58px;
  height: 58px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--muted));
}

.pending-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pending-image button {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 5px;
  background: hsl(var(--background) / 0.9);
  color: hsl(var(--foreground));
  cursor: pointer;
}

.composer-model-row {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 42px;
  padding: 7px 12px;
  border-bottom: 0;
  background: hsl(var(--background));
}

.model-selector-btn {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  gap: 6px;
  height: 32px;
  padding: 0 9px;
  border: 0;
  border-radius: var(--radius-md, 7px);
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  transition: background 150ms ease, color 150ms ease;
}

.model-picker {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}

.model-selector-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.model-selector-btn:hover .model-name,
.model-selector-btn:hover .model-chevron,
.model-selector-btn[aria-expanded="true"] .model-name,
.model-selector-btn[aria-expanded="true"] .model-chevron {
  color: hsl(var(--foreground));
}

.model-icon,
.skill-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: hsl(var(--foreground));
}

.model-prefix {
  flex: 0 0 auto;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.model-name {
  min-width: 0;
  overflow: hidden;
  color: currentColor;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-status,
.model-option-status {
  flex: 0 0 auto;
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 700;
}

.model-check {
  display: inline-flex;
  width: 22px;
  flex: 0 0 22px;
  align-items: center;
  justify-content: center;
  color: hsl(var(--muted-foreground));
}

.model-status.slow,
.model-option-status.slow {
  color: hsl(var(--muted-foreground));
}

.model-chevron {
  flex: 0 0 auto;
  color: currentColor;
  opacity: 0.72;
}

.model-dropdown,
.skill-menu {
  position: absolute;
  z-index: 50;
  overflow: auto;
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  background: hsl(var(--popover));
  box-shadow: 0 18px 60px hsl(var(--foreground) / 0.14), var(--shadow-sm);
}

.model-dropdown {
  bottom: calc(100% + 12px);
  right: 0;
  width: min(300px, calc(100vw - 32px));
  max-height: 320px;
  padding: 10px 6px;
}

.model-dropdown-title {
  padding: 4px 14px 8px;
  color: hsl(var(--muted-foreground));
  font-size: 14px;
  line-height: 1.25;
}

.model-option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 8px 12px 8px 14px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: hsl(var(--foreground));
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}

.model-option:hover,
.model-option.active,
.skill-option:hover,
.skill-option.active {
  background: hsl(var(--muted));
}

.model-option-main,
.skill-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.model-option-main span,
.skill-copy strong {
  overflow: hidden;
  color: hsl(var(--foreground));
  font-size: 15px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option-main small,
.skill-copy small,
.model-option-hint {
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option-main {
  flex: 1 1 auto;
}

.model-option-main small {
  display: none;
}

.model-option-hint {
  display: none;
}

.composer-input-wrap {
  position: relative;
}

.chat-input {
  width: 100%;
  min-height: 76px;
  max-height: 210px;
  padding: 22px 20px 8px;
  border: 0;
  background: transparent;
  color: hsl(var(--foreground));
  font-family: inherit;
  font-size: 18px;
  line-height: 1.5;
  outline: none;
  resize: none;
}

.chat-input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.chat-input::placeholder {
  color: hsl(var(--muted-foreground));
}

.skill-menu {
  right: -1px;
  bottom: calc(100% + 13px);
  left: -1px;
  max-height: min(430px, calc(100vh - 230px));
  padding: 7px;
  border-radius: 21px;
  scrollbar-color: hsl(var(--muted-foreground) / 0.22) transparent;
  scrollbar-width: thin;
}

.skill-menu::-webkit-scrollbar {
  width: 10px;
}

.skill-menu::-webkit-scrollbar-track {
  background: transparent;
}

.skill-menu::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background: hsl(var(--muted-foreground) / 0.22);
  background-clip: padding-box;
}

.skill-option {
  display: flex;
  align-items: center;
  min-height: 42px;
  gap: 12px;
  padding: 7px 14px;
  border-radius: 14px;
  cursor: pointer;
}

.skill-icon {
  width: 26px;
  color: hsl(var(--muted-foreground));
}

.skill-copy {
  flex: 1 1 auto;
  flex-direction: row;
  align-items: baseline;
  gap: 9px;
}

.skill-copy strong {
  flex: 0 0 auto;
  font-size: 16px;
  font-weight: 600;
}

.skill-copy small {
  flex: 1 1 auto;
  font-size: 15px;
  line-height: 1.35;
}

.composer-bottom-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px 10px 14px;
  border-top: 0;
  border-bottom: 0;
}

.composer-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.model-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.composer-actions.left {
  min-width: 0;
}

.composer-actions.right {
  justify-content: flex-end;
}

.composer-icon-button,
.composer-submit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--radius-md, 7px);
  cursor: pointer;
  font-family: inherit;
  transition: background 150ms ease, color 150ms ease, opacity 150ms ease, box-shadow 150ms ease;
}

.composer-icon-button {
  background: transparent;
  color: hsl(var(--muted-foreground));
}

.composer-icon-button.plus {
  width: 32px;
  height: 32px;
  color: hsl(var(--muted-foreground));
}

.composer-icon-button:hover {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.composer-submit {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  box-shadow: var(--shadow-sm);
}

.composer-submit.ready {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.composer-submit:hover:not(:disabled) {
  opacity: 0.9;
}

.composer-submit.stop {
  background: hsl(var(--destructive));
  color: hsl(var(--destructive-foreground));
}

.composer-submit:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

@media (max-width: 640px) {
  .composer-footer {
    padding: 8px 10px 10px;
  }

  .composer-shell {
    border-radius: 11px;
  }

  .composer-model-row {
    min-height: 40px;
    padding: 6px 10px;
  }

  .model-prefix {
    display: none;
  }

  .model-name {
    max-width: 180px;
    font-size: 13px;
  }

  .model-dropdown {
    right: -48px;
    width: min(300px, calc(100vw - 20px));
  }

  .chat-input {
    min-height: 54px;
    padding: 14px 12px 8px;
    font-size: 15px;
  }

  .composer-bottom-row {
    align-items: flex-end;
    padding: 5px 7px 7px 9px;
  }

  .composer-icon-button,
  .model-selector-btn {
    height: 30px;
  }

  .composer-icon-button.plus {
    width: 30px;
    height: 30px;
  }

  .model-id {
    display: none;
  }
}

@media (max-width: 420px) {
  .model-name {
    max-width: 138px;
  }

  .model-status {
    font-size: 11px;
  }

  .composer-meta {
    font-size: 11px;
  }
}
</style>
