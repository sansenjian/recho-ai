<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ModelOption } from '../types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import PromptBox from './PromptBox.vue'
import { shiftImageMentionsAfterRemoval } from '../lib/message-image-mention'
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

const { t } = useI18n()

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

// --- @ 引用已上传图片 ---
//
// 与斜杠命令同一套交互（弹出、上下选择、Enter 确认），但触发符是 @ 且只在
// 文本里插入一个「图N」标记。它不改发送内容的结构——图片仍然走 pendingImages
// 整批发送，@ 只是让用户在文本里点明「这张图是干什么用的」。多图时没有这个
// 标记，模型无法区分哪张图对应哪句描述。
const showMentionMenu = ref(false)
const mentionFilter = ref('')
const mentionHighlight = ref(0)

/**
 * 已上传图片的引用项。
 *
 * 插入正文的是 `{{image:N}}` 这样的结构化标记，而不是「@图N」这种自然语言
 * 文本——与画布的引用标记（`{{image:节点id}}`，见 image-mention-editor）保持
 * 同一套写法。原因是这个标记会作为消息正文发给模型：如果它随界面语言变，
 * 同一段对话在中文和英文下就是两种含义，而且改语言会让已有消息里的标记失去
 * 对应关系。标记语言无关，显示层再决定怎么展示。
 *
 * label 只用于菜单里给人看，不进入正文。
 */
const mentionItems = computed(() => (props.pendingImages || []).map((src, index) => ({
  index,
  token: `{{image:${index + 1}}}`,
  label: t('chat.mentionLabel', { index: index + 1 }),
  src,
})))

const filteredMentions = computed(() => {
  const q = mentionFilter.value.trim().toLowerCase()
  if (!q) return mentionItems.value
  // 按序号搜（「2」）或按显示名搜（「图2」/「Image 2」）都能命中。
  return mentionItems.value.filter(item =>
    item.label.toLowerCase().includes(q) || String(item.index + 1) === q,
  )
})

const currentModelStatus = computed(() => {
  if (props.currentModel?.status === 'recommended') return t('chat.recommended')
  if (props.currentModel?.status === 'slow') return t('chat.backup')
  return ''
})

const compactModelLabel = computed(() => {
  const label = props.currentModel?.label || t('chat.model')
  return label.replace(/^DeepSeek\s+/, '').replace(/\s+Flash$/, ' Flash')
})

const activeSkillOption = computed(() => {
  if (!props.activeSkill) return null
  return (props.skills || []).find(skill => skill.name === props.activeSkill) || null
})

const skillOnlyFallbackText = computed(() => {
  if (!props.activeSkill) return ''
  const label = activeSkillOption.value?.description || props.activeSkill
  return t('chat.useSkill', { skill: props.activeSkill, label })
})

const canSubmit = computed(() => Boolean(inputValue.value.trim() || skillOnlyFallbackText.value))

/** 模型目录里的 level/hint 是 i18n key，只能在这里解析后渲染。 */
function modelLevel(model: ModelOption) {
  return model.levelKey ? t(model.levelKey) : ''
}

function modelHint(model: ModelOption) {
  return model.hintKey ? t(model.hintKey) : ''
}

/** 下拉行右侧只保留一个标签：状态（推荐/慢速）优先，其次是档位，最后回落到「可用」。 */
function modelBadge(model: ModelOption) {
  if (model.status === 'recommended') return t('chat.recommended')
  if (model.status === 'slow') return t('chat.slower')
  return modelLevel(model) || (model.status === 'available' ? t('chat.available') : '')
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

  // detect @ mention of an uploaded image
  updateMentionState(t)
}

/**
 * @ 引用的触发判定。
 *
 * 只在光标前那一段里找最后一个 @，并且要求它到光标之间没有空白——所以
 * "邮箱 a@b.com" 或已经写完的 "@图1 不错" 都不会再弹菜单，只有正在输入的
 * 那个 @ 才会。没有可引用图片（pendingImages 为空）时直接不弹，避免给出一个
 * 选不出东西的空菜单。
 */
function updateMentionState(textarea: HTMLTextAreaElement) {
  const items = mentionItems.value
  if (!items.length) {
    showMentionMenu.value = false
    return
  }

  const caret = textarea.selectionStart ?? textarea.value.length
  const beforeCaret = textarea.value.slice(0, caret)
  const atIndex = beforeCaret.lastIndexOf('@')
  if (atIndex < 0) {
    showMentionMenu.value = false
    return
  }

  const query = beforeCaret.slice(atIndex + 1)
  if (/\s/.test(query)) {
    showMentionMenu.value = false
    return
  }

  mentionFilter.value = query
  mentionHighlight.value = 0
  showMentionMenu.value = true
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
  showMentionMenu.value = false
  skillFilter.value = ''
}

/**
 * 选中一张图片，把光标前的 @查询 替换成 @图N 标记。
 *
 * 替换而不是追加：用户是在输入 @ 的过程中选的，那段 "@查询" 只是个临时筛选词，
 * 留着会变成正文。替换后补一个空格，方便继续打字。
 */
function pickMention(item: { token: string; index: number }) {
  const textarea = document.querySelector('.chat-input') as HTMLTextAreaElement | null
  const token = `${item.token} `

  if (!textarea) {
    inputValue.value = `${inputValue.value}${token}`
    showMentionMenu.value = false
    return
  }

  const caret = textarea.selectionStart ?? inputValue.value.length
  const beforeCaret = inputValue.value.slice(0, caret)
  const afterCaret = inputValue.value.slice(caret)
  const atIndex = beforeCaret.lastIndexOf('@')

  // atIndex < 0 说明菜单弹出后用户又改了文本；此时退化成在光标处插入，不吞字符。
  if (atIndex < 0) {
    inputValue.value = `${beforeCaret}${token}${afterCaret}`
  } else {
    inputValue.value = `${beforeCaret.slice(0, atIndex)}${token}${afterCaret}`
  }

  showMentionMenu.value = false

  // 光标落到标记之后，并让 textarea 重新量高。
  void nextTick(() => {
    const next = textarea.selectionStart
    const position = atIndex < 0 ? caret + token.length : atIndex + token.length
    textarea.setSelectionRange(position, position)
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
    void next
  })
}

/**
 * 移除附图时修正正文里已插入的标记序号。
 *
 * 标记的 N 是附图数组下标，所以从中间删掉一张会让后面所有标记整体前移一位——
 * 这种错位比越界更危险：越界会被渲染层清掉，错位只是安静地指向另一张图，模型
 * 收到错误序号、界面显示错误标签，全程没有提示。
 *
 * 必须由父组件显式告知「删掉了哪一张」：只比较数组长度是推不出来的——3 张变 2 张
 * 可能是删了第一张，也可能是删了最后一张，而这两者要做的修正完全不同。
 */
function handleRemovedImage(index: number) {
  if (!inputValue.value.includes('{{image:')) return
  inputValue.value = shiftImageMentionsAfterRemoval(inputValue.value, index)
}

defineExpose({ handleRemovedImage })

function dismissSkill() {
  emit('selectSkill', null)
}

function handleKeydown(e: KeyboardEvent) {
  // 输入法组合期间不要抢键：中文输入时 Enter 是确认候选词，不是选中菜单项。
  if (e.isComposing || e.keyCode === 229) return

  if (showMentionMenu.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mentionHighlight.value = Math.min(mentionHighlight.value + 1, filteredMentions.value.length - 1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      mentionHighlight.value = Math.max(mentionHighlight.value - 1, 0)
      return
    }
    if (e.key === 'Enter' && filteredMentions.value.length > 0) {
      e.preventDefault()
      pickMention(filteredMentions.value[mentionHighlight.value])
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      showMentionMenu.value = false
      return
    }
  }

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
  if (!props.currentModel) return
  const trimmed = inputValue.value.trim()
  const fallbackText = skillOnlyFallbackText.value
  if (!trimmed && !fallbackText) return

  // Support inline "/skill query" format
  const parsed = tryParseSlashCommand(trimmed)
  if (parsed.skill) {
    emit('selectSkill', parsed.skill)
    emit('submit', parsed.query)
  } else {
    emit('submit', trimmed || fallbackText)
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
    <!--
        输入框的阴影分两档：未聚焦时也要能看出这是一个可输入的框（原先 0.04 的
        透明度几乎等于没有），聚焦后再加一档，让当前在哪儿一目了然。
        group 是给内部元素（如光标、placeholder）留的联动钩子。
      -->
      <PromptBox
        class="mx-auto w-full max-w-[760px] overflow-visible"
      >
        <template #default>
        <div class="relative">
          <div v-if="pendingImages && pendingImages.length > 0" class="flex flex-wrap gap-1.5 px-3 pt-2.5">
            <div v-for="(img, idx) in pendingImages" :key="idx" class="relative h-[58px] w-[58px] overflow-hidden rounded-lg border border-border bg-muted">
              <img :src="img" alt="" class="h-full w-full object-cover" />
              <button
                type="button"
                :title="t('chat.removeImage')"
                class="absolute right-1 top-1 inline-flex h-[18px] w-[18px] items-center justify-center rounded border-0 bg-background/90 text-foreground"
                @click="emit('removeImage', idx)"
              >
                <X class="h-3 w-3" />
              </button>
            </div>
          </div>

          <Textarea
            v-model="inputValue"
            :aria-label="t('chat.messageInput')"
            class="chat-input min-h-[76px] w-full resize-none border-0 bg-transparent px-5 pb-2 pt-[22px] text-lg leading-relaxed text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 max-sm:min-h-[54px] max-sm:px-3 max-sm:pb-2 max-sm:pt-3.5 max-sm:text-[15px]"
            :placeholder="activeSkill ? t('chat.inputPlaceholder') : t('chat.followUpPlaceholder')"
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
          <!--
            @ 引用菜单。复用斜杠命令的外观，但每项左边带缩略图——引用图片时
            光看「图2」认不出是哪张，必须能直接看到。
          -->
          <div
            v-if="showMentionMenu && filteredMentions.length > 0"
            class="absolute -left-px -right-px bottom-[calc(100%+13px)] z-50 max-h-[min(430px,calc(100vh-230px))] overflow-auto rounded-[21px] border border-border bg-popover p-[7px] shadow-[0_18px_60px_hsl(var(--foreground)/0.14)] [scrollbar-color:hsl(var(--muted-foreground)/0.22)_transparent] [scrollbar-width:thin]"
          >
            <div
              v-for="(item, idx) in filteredMentions"
              :key="item.index"
              class="flex min-h-[42px] cursor-pointer items-center gap-3 rounded-[14px] px-3.5 py-[7px] hover:bg-muted"
              :class="{ 'bg-muted': idx === mentionHighlight }"
              @click="pickMention(item)"
              @mouseenter="mentionHighlight = idx"
            >
              <img
                :src="item.src"
                alt=""
                class="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
              />
              <div class="flex min-w-0 flex-1 items-baseline gap-2">
                <strong class="shrink-0 text-base font-semibold">{{ item.label }}</strong>
                <small class="min-w-0 flex-1 truncate text-[15px] leading-snug text-muted-foreground">
                  {{ idx === mentionHighlight ? t('chat.mentionHint') : t('chat.mentionOrdinal', { index: item.index + 1 }) }}
                </small>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 border-t-0 border-b-0 px-3.5 pb-2.5 pt-1.5 max-sm:items-end max-sm:px-2 max-sm:pb-1.5 max-sm:pt-1">
          <div class="flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              :title="t('chat.uploadImage')"
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
                class="h-7 gap-1.5 px-2 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                :aria-expanded="showModelDropdown"
                aria-haspopup="listbox"
                @click="showModelDropdown = !showModelDropdown"
              >
                <span class="min-w-0 truncate text-[13px] font-semibold">{{ compactModelLabel }}</span>
                <span v-if="currentModelStatus" class="shrink-0 text-[11px] font-medium text-muted-foreground">{{ currentModelStatus }}</span>
                <ChevronDown class="h-[13px] w-[13px] opacity-70" />
              </Button>

              <div
                v-if="showModelDropdown"
                class="absolute bottom-[calc(100%+12px)] right-0 z-50 w-[min(300px,calc(100vw-32px))] max-h-80 overflow-auto rounded-2xl border border-border bg-popover p-2 shadow-[0_18px_60px_hsl(var(--foreground)/0.14)] max-sm:-right-12 max-sm:w-[min(300px,calc(100vw-20px))]"
              >
                <div class="px-3.5 pb-2 pt-1 text-sm text-muted-foreground">{{ t('chat.model') }}</div>
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
                    <small class="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span class="shrink-0">{{ m.provider }}</span>
                      <span v-if="modelHint(m)" class="min-w-0 truncate">· {{ modelHint(m) }}</span>
                    </small>
                  </span>
                  <span v-if="modelBadge(m)" class="shrink-0 text-[11px] font-medium text-muted-foreground">{{ modelBadge(m) }}</span>
                  <span class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true">
                    <Check v-if="m.id === currentModel?.id" class="h-[18px] w-[18px]" />
                  </span>
                </button>
              </div>
            </div>

            <Button
              v-if="isLoading"
              variant="destructive"
              size="icon-sm"
              class="rounded-full"
              :title="t('chat.stop')"
              @click="emit('stop')"
            >
              <Square class="h-[13px] w-[13px] fill-current" />
            </Button>
            <Button
              v-else
              size="icon-sm"
              class="rounded-full bg-primary text-primary-foreground shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canSubmit || !currentModel"
              :title="t('chat.send')"
              @click="handleSubmit"
            >
              <Send class="h-[14px] w-[14px] fill-current" />
            </Button>
          </div>
        </div>
        </template>
      </PromptBox>
  </footer>
</template>
