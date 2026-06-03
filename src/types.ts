import type { ToolCall } from './types/tools'
import type { ToolStatus } from './types/tools'

export type AssistantTextStatus = 'streaming' | 'complete' | 'incomplete'
export type ThinkingStatus = 'running' | 'done' | 'cancelled'

export type MessageBlock =
  | { id: string; type: 'assistant_text'; content: string; status: AssistantTextStatus }
  | { id: string; type: 'thinking'; content: string; status: ThinkingStatus }
  | {
      id: string
      type: 'tool_use'
      toolUseId: string
      name: string
      input: Record<string, unknown>
      result?: string
      isError?: boolean
      status: ToolStatus
      startedAt: number
      completedAt?: number
    }

export interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  blocks?: MessageBlock[]
  images?: string[]
  thinking?: string
  toolCalls?: ToolCall[]
  timestamp: string
}

export interface ChatGroup {
  id: string
  name: string
  color: string
}

export const GROUP_COLORS = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
]

export interface Conversation {
  schemaVersion?: 2
  id: number
  title: string
  messages: Message[]
  systemPrompt: string
  groupId: string | null
  createdAt: string
  updatedAt: string
}

export type AbortControllerRef = { value: AbortController | null }

export interface ModelOption {
  id: string
  provider: string
  label: string
  level: string
  hint?: string
  status?: 'recommended' | 'available' | 'slow'
}

export type AgentModeId = 'chat' | 'code' | 'plan'

export interface AgentModeOption {
  id: AgentModeId
  label: string
  hint: string
  systemHint: string
}

export const DEFAULT_SYSTEM_PROMPT = `你是 Recho AI 的云端助手，帮助用户完成问答、资料整理、搜索核查、方案比较、学习解释和代码建议。

工作方式：
- 先理解用户真正想完成的事，再选择直接回答、调用工具或追问。
- 能推进时直接推进；信息不完整但不阻断任务时，采用合理默认假设并说明假设。
- 需要实时数据、最新信息、新闻、价格、库存、政策、赛事、版本或事实核查时，主动使用已配置工具搜索，并基于结果回答。
- 使用用户正在使用的语言回复。默认直接进入答案，不要用“首先/让我来/好的，我来/我将会”等过程性开场。
- 不输出隐藏推理、内部思考、草稿、工具原始日志、调试文本或中间 JSON。需要解释依据时，用面向用户的简短说明。`

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'deepseek-ai/deepseek-v4-flash',
    provider: 'NVIDIA',
    label: 'DeepSeek V4 Flash',
    level: '快',
    hint: '响应最快，适合日常问答',
    status: 'recommended',
  },
  {
    id: 'deepseek-ai/deepseek-v4-pro',
    provider: 'NVIDIA',
    label: 'DeepSeek V4 Pro',
    level: '稳',
    hint: '质量更稳，适合复杂问题',
    status: 'available',
  },
  {
    id: 'moonshotai/kimi-k2.6',
    provider: 'NVIDIA',
    label: 'Kimi-K2.6',
    level: '慢',
    hint: '当前首包较慢，可作为备用',
    status: 'slow',
  },
  {
    id: 'gpt-4o-mini',
    provider: 'OpenAI',
    label: 'GPT-4o-mini',
    level: '轻',
    hint: '需要 OpenAI 配置可用',
    status: 'available',
  },
  {
    id: 'gpt-4o',
    provider: 'OpenAI',
    label: 'GPT-4o',
    level: '高',
    hint: '需要 OpenAI 配置可用',
    status: 'available',
  },
]

export const AGENT_MODES: AgentModeOption[] = [
  {
    id: 'chat',
    label: 'Chat',
    hint: '问答与资料整理',
    systemHint: '当前处于 Chat 模式。优先给出清晰答案和可执行建议；需要最新信息时使用搜索工具；除非用户要求，不要主动展开代码改动步骤。',
  },
  {
    id: 'code',
    label: 'Code',
    hint: '实现、调试、审查',
    systemHint: '当前处于 Code 模式。像云端编程 Agent 一样工作：先理解目标，再给出可执行步骤、文件级改动建议、命令和验证方式；不能声称可以直接操作用户电脑或任意编辑服务器文件；涉及风险操作时明确说明。',
  },
  {
    id: 'plan',
    label: 'Plan',
    hint: '拆解任务与方案',
    systemHint: '当前处于 Plan 模式。先拆解目标、列出假设、风险、里程碑和下一步执行清单；信息足够时给出推荐方案，不要把计划模式变成连续追问。',
  },
]
