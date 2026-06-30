# 后端架构规划

> 文档状态：早期规划，内容早于当前 Node Gateway + Go sidecar 架构。
> 当前架构事实请看 [Recho-AI 当前架构与目标架构](./recho-ai-architecture-current-and-target.md)。本文仅作历史参考。

> 适用于 recho-ai 项目：前期只做 API 聚合转发，后期引入 AI 生态。

---

## 总体架构

采用**分层设计**，用 Node.js 做网关层，Python 做 AI 服务层，前后端解耦、各自演进。

```
backend/
├── gateway/          # Node.js + Express (BFF 层)
│   ├── 统一路由 /api/chat
│   ├── 多模型聚合 (OpenAI / Claude / 国产)
│   ├── 流式转发 SSE
│   ├── 鉴权 / 限流 / 日志
│   └── 反向代理到 Python 服务
│
└── ai-service/       # Python + FastAPI (AI 核心)
    ├── 前期：空着或简单 health check
    └── 后期：RAG、向量检索、本地模型、Agent
```

---

## 为什么选择这套组合

| 职责 | Node 网关 | Python AI 服务 |
|------|-----------|----------------|
| 前期工作 | 转发 API、SSE、限流 | 几乎不用写 |
| 后期扩展 | 不变 | 加 RAG、向量库、模型推理 |
| 团队成本 | 前端同语言 | 需要 Python，但 AI 生态不可替代 |

---

## 前期 Node 网关核心职责

只做三件事：

1. **统一入口** — 前端只发请求到 `/api/chat`，由后端决定调用哪家模型
2. **流式转发** — 用 Server-Sent Events (SSE) 把 AI 的流式输出直通前端，实现打字机效果
3. **多模型切换** — 根据请求参数 `model` 字段，路由到 OpenAI、Claude、Kimi 等不同提供商

### 最小可运行示例

```js
// POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { model, messages } = req.body

  const client = getClientByModel(model) // openai / claude / kimi
  const stream = await client.chat.completions.create({
    model,
    messages,
    stream: true,
  })

  // SSE 直通前端
  res.setHeader('Content-Type', 'text/event-stream')
  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }
  res.end()
})
```

---

## 演进路线

### Phase 1：最小可用（1-2 周）

- Node 网关直连第三方 AI API
- 支持 1-2 个模型（如 OpenAI GPT-4 + 国产 Kimi）
- SSE 流式输出
- 无 AI 服务层，Python 目录保留为空或只放 `health` 接口

### Phase 2：智能增强（1-3 个月）

- Python 服务加入 **RAG**：知识库文档向量化 + 检索
- Node 网关新增 `/api/chat/rag` 路由
- 流程：用户提问 -> Python 检索相关上下文 -> Node 拼接上下文 -> 发给大模型

### Phase 3：模型下沉（3-6 个月）

- 本地部署中小模型（如 Llama、Qwen）
- Python 负责模型推理（vLLM / llama.cpp）
- Node 只做网关和路由，不再直连第三方

---

## 备选：零后端起步

如果项目还处在验证阶段，也可以先用 **Vercel AI SDK** 直接从前端调 OpenAI，等验证通过后再搭后端。

| 方案 | 适用场景 | 迁移成本 |
|------|----------|----------|
| Vercel AI SDK（零后端） | 验证 MVP、快速 Demo | 中，需拆分出后端 |
| Node 网关（推荐） | 确定要做、长期维护 | 低，后期加 Python 即可 |

---

## 技术栈版本建议

| 组件 | 推荐 | 说明 |
|------|------|------|
| 网关运行时 | Node.js 20 LTS | 原生 fetch、原生 Web Streams |
| 网关框架 | Express 4.x 或 Fastify 4.x | Fastify 性能更好，Express 生态更熟 |
| AI SDK | `openai`、`@anthropic-ai/sdk` 等 | 官方 SDK，直接支持流式 |
| Python 运行时 | Python 3.11+ | |
| Python 框架 | FastAPI | 原生异步、自动生成文档 |
| 向量库（后期） | `chromadb` 或 `qdrant` | Chroma 本地开发最轻量 |

---

## 下一步行动

1. 在 `backend/gateway/` 初始化 Express 项目
2. 配置 `.env` 存放各平台 API Key
3. 实现 `/api/chat` 单一流式接口
4. 跑通前端 -> Node -> OpenAI 的完整链路
