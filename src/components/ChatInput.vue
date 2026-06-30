<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ModelOption } from '../types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Plus, ChevronDown, X, Languages, Code, FileText, Search, Square, Send, Check } from '@lucide/vue'

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

function skillIcon(name: string) {
  if (name === 'languages') return Languages
  if (name === 'code') return Code
  if (name === 'file-text') return FileText
  return Search
}
</script>

<template>
  <footer class="shrink-0 border-t-0 bg-background/96 px-5 pb-4 pt-3 backdrop-blur-[14px] max-sm:px-2.5 max-sm:pb-2.5 max-sm:pt-2">
    <div class="relative mx-auto w-full max-w-[760px] overflow-visible rounded-3xl border border-b-0 border-border bg-card shadow-sm shadow-foreground/5 max-sm:rounded-[11px]">
      <div class="relative">
        <div v-if="pendingImages && pendingImages.length > 0" class="flex flex-wrap gap-1.5 px-3 pt-2.5">
          <div v-for="(img, idx) in pendingImages" :key="idx" class="relative h-[58px] w-[58px] overflow-hidden rounded-lg border border-border bg-muted">
            <img :src="img" alt="" class="h-full w-full object-cover" />
            <button
              type="button"
              title="移除图片"
              class="absolute right-1 top-1 inline-flex h-[18px] w-[18px] items-center justify-center rounded border-0 bg-background/90 text-foreground"
              @click="emit('removeImage', idx)"
            >
              <X class="h-3 w-3" />
            </button>
          </div>
        </div>

        <Textarea
          v-model="inputValue"
          class="chat-input min-h-[76px] w-full resize-none border-0 bg-transparent px-5 pb-2 pt-[22px] text-lg leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 max-sm:min-h-[54px] max-sm:px-3 max-sm:pb-2 max-sm:pt-3.5 max-sm:text-[15px]"
          :placeholder="activeSkill ? '输入消息...' : '要求后续变更'"
          rows="1"
          :disabled="isLoading"
          @keydown="handleKeydown"
          @input="onInput"
        />

        <div
          v-if="showSkillMenu && filteredSkills.length > 0"
          class="absolute -left-px -right-px bottom-[calc(100%+13px)] z-50 max-h-[min(430px,calc(100vh-230px))] overflow-auto rounded-[21px] border border-border bg-popover p-[7px] shadow-[0_18px_60px_hsl(var(--foreground)/0.14)] [scrollbar-color:hsl(var(--muted-foreground)/0.22)_transparent] [scrollbar-width:thin]"
        >
          <div
            v-for="(s, idx) in filteredSkills"
            :key="s.name"
            class="flex min-h-[42px] cursor-pointer items-center gap-3 rounded-[14px] px-3.5 py-[7px] hover:bg-muted"
            :class="{ 'bg-muted': idx === skillHighlight }"
            @click="pickSkill(s)"
            @mouseenter="skillHighlight = idx"
          >
            <component :is="skillIcon(s.icon)" class="h-4 w-4 shrink-0 text-muted-foreground" />
            <div class="flex min-w-0 flex-1 items-baseline gap-2">
              <strong class="shrink-0 text-base font-semibold">/{{ s.name }}</strong>
              <small class="min-w-0 flex-1 truncate text-[15px] leading-snug text-muted-foreground">{{ s.description }}</small>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 border-t-0 border-b-0 px-3.5 pb-2.5 pt-1.5 max-sm:items-end max-sm:px-2 max-sm:pb-1.5 max-sm:pt-1">
        <div class="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8 text-muted-foreground"
            title="上传图片"
            @click="emit('upload')"
          >
            <Plus class="h-[19px] w-[19px]" />
          </Button>
        </div>

        <div class="flex shrink-0 items-center justify-end gap-1.5">
          <div class="relative inline-flex items-center">
            <Button
              variant="ghost"
              size="sm"
              class="h-8 gap-1.5 px-2 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              :aria-expanded="showModelDropdown"
              aria-haspopup="listbox"
              @click="showModelDropdown = !showModelDropdown"
            >
              <span class="min-w-0 truncate text-[13px] font-semibold">{{ compactModelLabel }}</span>
              <ChevronDown class="h-[13px] w-[13px] opacity-70" />
            </Button>

            <div
              v-if="showModelDropdown"
              class="absolute bottom-[calc(100%+12px)] right-0 z-50 w-[min(300px,calc(100vw-32px))] max-h-80 overflow-auto rounded-2xl border border-border bg-popover p-2 shadow-[0_18px_60px_hsl(var(--foreground)/0.14)] max-sm:-right-12 max-sm:w-[min(300px,calc(100vw-20px))]"
            >
              <div class="px-3.5 pb-2 pt-1 text-sm text-muted-foreground">模型</div>
              <button
                v-for="m in models"
                :key="m.id"
                class="flex w-full min-h-[44px] items-center gap-3 rounded-[10px] border-0 bg-transparent px-3.5 py-2 text-left text-foreground hover:bg-muted"
                :class="{ 'bg-muted': m.id === currentModel?.id }"
                type="button"
                role="option"
                :aria-selected="m.id === currentModel?.id"
                @click.stop="selectModel(m)"
              >
                <span class="flex min-w-0 flex-1 flex-col gap-px">
                  <span class="truncate text-[15px] font-medium">{{ m.label }}</span>
                  <small class="truncate text-[11px] text-muted-foreground">{{ m.provider }}</small>
                </span>
                <span class="hidden text-[11px] text-muted-foreground">{{ m.hint }}</span>
                <span class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true">
                  <Check v-if="m.id === currentModel?.id" class="h-[18px] w-[18px]" />
                </span>
              </button>
            </div>
          </div>

          <Button
            v-if="isLoading"
            variant="destructive"
            size="icon"
            class="h-9 w-9 rounded-full"
            title="停止"
            @click="emit('stop')"
          >
            <Square class="h-[13px] w-[13px] fill-current" />
          </Button>
          <Button
            v-else
            size="icon"
            class="h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!inputValue.trim()"
            title="发送"
            @click="handleSubmit"
          >
            <Send class="h-[14px] w-[14px] fill-current" />
          </Button>
        </div>
      </div>
    </div>
  </footer>
</template>
