# Agent 平台体验规划

> 目标：参考 `NanmiCoder/cc-haha` 的源码设计思路，完善 recho-ai 的云端 AI 对话平台体验。本文只沉淀可迁移的架构与产品能力，不引入本地电脑控制、服务器文件编辑或面向用户的 Permissions 交互。

## 背景

当前项目已经具备 Vue 3 前端、Express 网关、OpenAI-compatible 流式对话、MCP 工具调用和基础 skill 选择能力。但近期暴露出几个体验问题：

- 工具调用和思考过程在结束后容易消失，无法作为运行记录长期参考。
- 思考过程依赖临时字段显示，刷新或异常结束后不稳定。
- 工具状态只有 `running` / `done`，无法表达失败、超时、取消。
- SSE 事件协议偏薄，前端主要在 assistant 文本上做追加，难以稳定区分正文、思考、工具和状态。
- skill 只是简单 prompt 注入，尚未形成可治理的能力目录。

`cc-haha` 中最值得借鉴的不是具体桌面端能力，而是它把模型输出统一成 typed events，再映射成可持久化 UI block 的架构。

## 平台边界

recho-ai 是云平台，不是本地 Agent 客户端。因此必须遵守以下边界：

- 不向用户展示本地文件系统权限、电脑控制权限或服务器文件编辑权限。
- 不声称模型可以直接操作用户电脑或直接修改服务器项目文件。
- 工具能力仅来自后端安全配置的 API / MCP connector。
- MCP 只暴露云端可治理连接器，不让普通用户配置服务器本地命令。
- 高风险工具需要服务端策略控制，而不是把 Permissions 交给普通用户处理。

## 近期目标

先解决运行记录的根问题：把 assistant 文本、思考过程、工具调用、工具结果、状态变化都变成独立、可持久化、可恢复的结构化数据。

成功标准：

- 工具调用和思考过程在生成结束后仍保留在消息上方或对应 turn 中。
- 刷新页面后，历史会话仍能看到工具调用、工具结果和思考摘要。
- 工具失败、超时、停止时，UI 不再一直转圈。
- SSE 异常结束时，前端能把本轮标记为 incomplete，而不是静默成功。
- 旧 localStorage 会话能正常迁移。

## Phase 1：结构化流事件

### 后端事件协议

在 `backend/gateway/src/services/chat-loop.ts` 中扩展 SSE 事件，逐步从简单 `delta` 过渡到显式生命周期事件：

```ts
type RunEvent =
  | { type: 'content_start'; blockType: 'text' | 'tool_use'; blockId: string; toolName?: string; toolUseId?: string }
  | { type: 'content_delta'; blockId: string; text?: string; toolInput?: string }
  | { type: 'thinking_delta'; blockId: string; content: string }
  | { type: 'tool_call'; id: string; name: string; arguments: Record<string, unknown>; status: 'running' }
  | { type: 'tool_result'; id: string; name: string; result: string; isError: boolean }
  | { type: 'tool_end'; id?: string; status: 'done' | 'error' | 'timeout' | 'cancelled' }
  | { type: 'status'; state: 'thinking' | 'streaming' | 'tool_executing' | 'idle'; label?: string }
  | { type: 'message_complete'; finishReason?: string; incomplete?: boolean }
  | { type: 'error'; error: string; retryable?: boolean }
```

兼容策略：

- 保留现有 `delta` / `done` 一段时间，前端同时支持新旧事件。
- 所有工具事件必须携带稳定 `toolUseId`。
- 工具执行抛错、超时或用户停止时，后端合成 `tool_result`，并标记 `isError: true`。

### 前端解析

更新以下文件：

- `src/utils/sse-events.ts`
- `src/workers/sse-parser.worker.ts`
- `src/composables/useStream.ts`
- `src/composables/useChatLoop.ts`

前端不再只把流内容追加到 `assistantMsg.content`。应维护一个当前 run 的 blocks：

```ts
type MessageBlock =
  | { id: string; type: 'assistant_text'; content: string }
  | { id: string; type: 'thinking'; content: string; active?: boolean }
  | { id: string; type: 'tool_use'; toolUseId: string; name: string; input: unknown; status: ToolStatus; partialInput?: string }
  | { id: string; type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
```

## Phase 2：持久化运行记录

### Message 数据模型

当前 `Message` 主要是 `{ role, content, thinking?, toolCalls? }`。建议升级为：

```ts
interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  blocks?: MessageBlock[]
  images?: string[]
  timestamp: string
}
```

迁移策略：

- 旧消息没有 `blocks` 时，按原样渲染 `content`。
- 新 assistant 消息同时保留 `content` 作为兼容字段，但 UI 优先渲染 `blocks`。
- localStorage 增加 schema version，例如 `recho-conversations:v2` 或在数据内写入 `version`。

### UI 渲染

重点更新：

- `src/components/ChatMessage.vue`
- `src/components/ThinkingActivity.vue`
- `src/components/ToolActivity.vue`
- `src/components/StreamingStatus.vue`

展示规则：

- 同一轮中，工具调用和思考过程显示在最终回答上方，因为它们通常先发生。
- thinking block 默认折叠，但保留预览和展开能力。
- tool block 显示工具名、参数摘要、耗时、状态和结果摘要。
- 失败、超时、取消用明确 badge 显示，避免无限 loading。
- 工具详情可展开查看完整参数和完整结果。

## Phase 3：Skill 能力目录

当前 skill 来自 `backend/gateway/skills/index.json`，字段较少：

- `name`
- `description`
- `icon`
- `system_prompt`
- `tools`

建议扩展为轻量 metadata + 详情懒加载：

```ts
interface SkillSummary {
  name: string
  description: string
  icon?: string
  category?: string
  requiresTools?: string[]
  recommendedModels?: string[]
}

interface SkillDetail extends SkillSummary {
  systemPrompt: string
  examples?: string[]
  safetyNotes?: string[]
}
```

API 规划：

- `GET /api/skills`：只返回列表 metadata。
- `GET /api/skills/:name`：返回完整 skill detail。
- 启动时校验 `requiresTools` 是否存在于 `/api/tools`。
- 用户选择 skill 后，本轮请求记录 `skillName`，便于历史会话回放。

## Phase 4：云端 MCP 治理

MCP 管理应采用云平台安全模型：

```ts
interface McpConnectorStatus {
  name: string
  transport: 'http' | 'sse'
  enabled: boolean
  status: 'connected' | 'needs-auth' | 'failed' | 'disabled' | 'checking'
  statusLabel: string
  statusDetail?: string
  summary: string
  canReconnect: boolean
}
```

治理能力：

- connector allowlist / denylist。
- URL pattern policy，deny 优先于 allow。
- 租户级或管理员级配置。
- 工具执行超时、参数大小、结果大小限制。
- 服务端日志中记录 tool name、耗时、状态，不记录敏感参数全文。

不做：

- 不暴露 stdio command 给普通用户。
- 不让用户批准服务器本地命令。
- 不展示本地文件/电脑控制权限。

## Phase 5：会话增强

可在结构化 blocks 稳定后加入：

- Fork conversation from here：从某条消息创建分支会话。
- Rewind to this turn：删除某条消息之后的上下文并继续。
- 会话列表显示 model、message count、last activity、估算 token / cost。
- 导出 transcript：保留 text、thinking、tool_use、tool_result 的结构化记录。

## Phase 6：质量门禁

参考 `cc-haha` 的 lane-based quality gate，做轻量版本即可。

建议脚本：

- `npm test`：Vitest 单元测试。
- `npm run build`：前端类型检查和构建。
- `cd backend/gateway && npm run typecheck`：网关类型检查。
- 后续可增加 `npm run quality` 聚合执行。

建议 lane：

- frontend：Vue components、composables、SSE parser。
- gateway：chat loop、MCP manager、routes。
- persistence：localStorage migration fixtures。
- provider：OpenAI-compatible stream/event normalization。
- security：MCP connector policy、rate limit、result truncation。

每次质量门禁输出：

- `artifacts/quality/latest/report.json`
- `artifacts/quality/latest/report.md`
- 每个 lane 的 log 文件。

## 推荐落地顺序

1. 扩展 `ToolStatus`，补齐 error / timeout / cancelled。
2. 后端工具失败时始终发送 `tool_result` 和 `tool_end`。
3. 增加 `message_complete` / `status` 事件，前端识别 incomplete。
4. 引入 `MessageBlock`，先只用于当前 assistant 消息。
5. localStorage 加 schema migration，持久化 blocks。
6. 重构 `ToolActivity` 和 `ThinkingActivity` 渲染 blocks。
7. 扩展 skill metadata，并校验 skill 工具依赖。
8. 增加 MCP connector status DTO 和 allow/deny policy。
9. 加会话 fork / rewind。
10. 增加轻量 quality gate。

## 第一批验收用例

- 模型先输出 thinking，再调用工具，再输出最终回答，刷新后三者都保留。
- 工具超时后 UI 显示 timeout，不再一直转圈。
- 用户点击停止后，当前 run 显示 cancelled，已产生的内容保留。
- 后端 SSE 中断时，本轮显示 incomplete。
- 旧会话没有 blocks 时仍正常显示。
- 选择 web-search skill 后，只允许使用声明过且后端存在的工具。
