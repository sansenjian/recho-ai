# Recho-AI 当前架构与目标架构

> 版本：2026-06-29
> 范围：记录当前仓库真实状态，并给出单个 Render Docker 后端内 Node Gateway + Go sidecar 的可落地规划。

## 结论

Recho-AI 的后端不应该全部重写成 Go，也不应该继续把图片、存储、额度这些重资源链路都压在 Node 里。更稳妥的边界是：

- Node Gateway 负责变化快、贴近产品体验的部分：Chat、MCP、Skill、Admin BFF、响应格式兼容。
- Go sidecar 负责稳定、重资源、强一致的部分：生图、参考图、图片存储、历史记录、额度扣减、幂等、异步任务。

当前仓库不计划把 Node 和 Go 拆成两个 Render 后端服务。目标生产形态是一个 Render Docker 后端：Node 对外提供统一 API，Go 作为本机 sidecar 运行在 `127.0.0.1:3001`，由 Node 按路由代理 Go-owned 能力。

## 当前架构

```text
浏览器
  |
  | VITE_API_BASE_URL
  v
Render 静态前端
  |
  v
Render Docker 后端：recho-gateway
  |
  |-- Node Gateway :3000
  |     - /api/chat
  |     - /api/skills
  |     - /api/tools
  |     - /api/admin/*
  |     - Go-owned 路由代理
  |     - 生图 fallback 503
  |
  |-- Go sidecar :3001
        - /api/image/generate
        - /api/image/references
        - /api/image/storage/*
        - /api/credits
        - /api/config/app
        - /api/config/supabase
```

当前仓库依据：

- `render.yaml` 只定义了一个 Docker 后端服务：`recho-gateway`。
- `Dockerfile` 把 `backend/gateway` 和 `backend/go-gateway` 构建进同一个运行镜像。
- `scripts/start-render-backend.sh` 先启动 Go，等待 `/ready`，再启动 Node。
- `backend/gateway/src/routes/go-sidecar.ts` 在 Node 中把部分 `/api/*` 请求代理到 Go。
- `src/lib/api-base.ts` 支持 `VITE_API_BASE_URL`，并保留 `VITE_IMAGE_API_BASE_URL` 用于独立图片服务或本地验证。

## 目标架构

```text
用户层
  |-- Vercel 前端：recho-ai.vercel.app
  |-- Render 前端：recho-ai.onrender.com
  |
  v
Nginx / Cloudflare / 自定义域（可选统一入口）
  |
  v
Render Docker 后端：recho-gateway
  |
  |-- Node Gateway :3000（唯一对外 API 入口）
  |     - /api/chat
  |     - /api/skills
  |     - /api/tools
  |     - /api/admin/*
  |     - /api/config 聚合 / 管理员 BFF
  |     - /api/image/* -> 代理到 Go sidecar
  |     - /api/credits* -> 代理到 Go sidecar
  |
  |-- Go sidecar :3001（仅容器内访问）
        - /api/image/*
        - /api/credits
        - /api/config/app
        - 后台图片永久化 worker
        - 未来 /api/ws 或进度通道
  |
  v
Supabase / PostgreSQL
  - RPC: reserve_user_credits
  - RPC: refund_user_credits
  - table: idempotency_keys
  - table: image_history / image_generations / image_attempts
  - table: app_settings / provider_settings
  |
  v
外部服务
  - OpenAI-compatible APIs / lucen.plus
  - Tencent COS
```

可选边缘层只负责域名、TLS、缓存和 WAF。除非未来明确引入路径分流，否则前端稳定访问 Node Gateway，Go 不直接暴露给浏览器。

当前目标是一个 Render Docker 后端内的两个进程。未来只有在流量或团队协作需要独立扩缩容时，才重新评估拆成多个 Render 后端服务。

- **Node Gateway**：产品编排、Chat 流式输出、MCP、Skill、Admin BFF、响应格式兼容、公开 API 入口。
- **Go sidecar**：生图、图片存储代理、图片历史、额度 mutation、幂等、后台 worker、生图进度推送。

## 职责边界

| 模块 | 当前 owner | 目标 owner | 说明 |
|---|---|---|---|
| Chat 流式输出 | Node | Node | Go 不注册 `/api/chat`，Chat 只由 Node Gateway 负责。 |
| MCP 工具 | Node | Node | Node SDK 生态是当前事实来源。 |
| Skill 系统 | Node | Node | Prompt、工具策略、配置变化快，适合留在 Node。 |
| Admin 后台 | Node | Node BFF | 后台负责聚合和权限编排，具体 mutation 进入对应 owner。 |
| API 配置管理 | Node Admin BFF | Node Admin BFF + 服务读取配置 | 管理员可设置 provider、base URL、模型、开关、价格等；Go 在处理图片链路时读取最终配置。 |
| 图片生成 | Go，经 Node sidecar 代理 | Go | Node 不再新增图片管线逻辑。 |
| 参考图上传 | Go，经 Node sidecar 代理 | Go | 大文件、图片格式处理归 Go。 |
| 图片存储代理 | Go，经 Node sidecar 代理 | Go | 路径安全、限流、缓存策略在 owner 服务内维护。 |
| 图片历史 | 迁移中混合 | Go | 前端 API 路径保持稳定，内部 owner 收口到 Go。 |
| 额度 mutation | Go/RPC，Node 后台读取 | Go + Supabase RPC | 一个业务状态只能有一个最终写入 owner。 |
| 公共配置 | 混合 | 按领域拆分 | 可保留 facade，但最终配置来源必须清晰。 |

## 额度与幂等

额度必须靠数据库原子操作保护，不能依赖 Node 事件循环顺序。

当前项目已有命名应继续沿用：

- `reserve_user_credits(user_id, amount, metadata)`
- `refund_user_credits(user_id, amount, related_transaction_id, metadata)`
- `user_credit_balances`
- `credit_transactions`
- `idempotency_keys`

不要在文档或代码里新增 `reserve_image_credits` / `refund_image_credits` 这组名字，除非数据库函数、Go、Node、测试一起做正式重命名迁移。

基础生图 Saga：

```text
POST /api/image/generate
  -> 验证用户、参数、模型、额度策略
  -> 如果传入 Idempotency-Key，先占用幂等 key
  -> 调用 Supabase RPC 预扣额度
  -> 调用生图 provider
  -> 处理图片与持久化
  -> 完成幂等记录
  -> 返回结果

如果预扣后失败：
  -> 退款
  -> 标记幂等记录 failed
  -> 写入 attempt / error 记录
```

## 认证

Go 继续通过 Supabase JWKS 或等价可信配置验证用户 JWT。目标架构里，Node 和 Go 都应该能独立解析基础用户身份，不能互相依赖对方完成鉴权。

Admin 权限编排留在 Node BFF。后台如果要调整额度、图片状态或 provider 配置，必须走对应 owner 的服务/RPC，避免 Node 和 Go 同时直接写同一个业务状态。

## 管理员后台配置 API

管理员后台应该支持配置 provider API，常规运营不需要重新部署。

建议后台可配置项：

- Chat provider：名称、base URL、API key 引用、默认模型、启用状态、优先级。
- Image provider：名称、base URL、加密 API key、生图模型、编辑模型、启用状态、超时时间、重试次数。
- API key 必须应用层 AES-256-GCM 加密后再落库；明文只在 Node/Go 进程内存中短暂存在。Node Gateway 与 Go sidecar 必须使用同一个 `PROVIDER_API_KEY_MASTER_KEY` 解密后台配置。
- 生图价格：单图消耗额度、免费生图开关、游客生图开关、最大参考图数量。
- 前端公共配置：可见模型列表、功能开关、维护公告。

安全规则：

- 只有管理员能读取和修改 provider 配置。
- API key 不能返回给前端。
- 尽量存密文或 secret 引用；如果存在 Supabase，必须限制为 service role 访问。
- Node 和 Go 可以短时间缓存配置，但配置变更后应能刷新，不应为了换 key 或换模型重新部署。
- 环境变量保留为兜底配置，用于冷启动、数据库异常或紧急回滚。

推荐数据流：

```text
Admin UI
  -> Node Admin BFF
  -> Supabase app_settings / provider_settings
  -> Node 和 Go 读取最终生效配置
```

Node 是后台编排层；Go 在处理 Go-owned 图片路由前，必须读取最终的图片 provider、额度价格和开关配置。

## 生图快速返回方案

目标：OpenAI-compatible provider 返回临时 URL 后，Go 先把临时 URL 返回给前端，让用户快速看到结果；COS 永久化放到后台异步完成。

```text
前端 POST /api/image/generate
  -> Go 验证 auth、参数、模型、额度
  -> Go 预扣额度
  -> Go 调用 OpenAI-compatible 图片 API
  -> provider 返回临时图片 URL
  -> Go 创建图片记录：status = processing
  -> Go 立即返回临时 URL 给前端
  -> 后台 worker 下载临时 URL
  -> worker 生成原图 / WebP 预览 / WebP 缩略图
  -> worker 上传 COS
  -> worker 更新数据库：status = ready，写入永久 URL
  -> 前端刷新或轮询，拿到 COS 永久 URL
```

前端响应必须显式表达“临时可看，永久化处理中”：

```json
{
  "images": [
    {
      "id": "img_...",
      "status": "processing",
      "temporaryUrl": "https://...",
      "previewUrl": "https://...",
      "storagePath": null,
      "expiresAt": "2026-06-29T12:00:00Z"
    }
  ],
  "creditBalance": {
    "balance": 12
  }
}
```

图片持久化状态：

| 状态 | 含义 | 前端行为 |
|---|---|---|
| `processing` | provider 已成功，永久存储处理中 | 展示临时 URL 和同步中状态。 |
| `ready` | COS 上传和数据库更新完成 | 使用永久预览图 / 原图 URL。 |
| `failed` | provider 未返回可用图片 | 展示错误；如已预扣则退款。 |
| `persistence_failed` | provider 成功，但后台持久化重试后失败 | 临时 URL 未过期时继续展示，并在后台暴露修复入口。 |

关键规则：

- 不能只靠进程内 goroutine。返回临时 URL 前必须先写入持久化任务，避免 Render 重启导致任务丢失。
- worker 下载和上传都要有重试退避。超过最大次数后标记 `persistence_failed`，并在管理员后台可见。
- 第一个版本可以按“5 分钟后刷新”做；更好的体验是前 1 分钟每 5-10 秒轻轮询，之后降低频率直到 5 分钟。
- provider 临时 URL 可能过期。已知过期时间时写入 `expiresAt`，一旦 COS URL ready，前端优先切到永久 URL。
- 额度策略要明确：只要 provider 返回可用图，通常就算成功消耗额度；如果后续永久化失败，进入后台补偿/修复流程，不要静默反复退款。

## 参考图方案

目标：浏览器先安全压缩，在保留 2K 参考图细节的前提下降低传输体积；Go 接收 WebP 二进制，再传给 OpenAI-compatible `/images/edits`。

```text
用户选择 JPEG / PNG / HEIC，最大 5 MB
  -> 前端解码并修正方向
  -> 前端转 WebP
  -> 最大边 = 2048 px（2K 参考图）
  -> quality 默认 0.85-0.90，按体积和画质自适应
  -> multipart/form-data 上传 WebP 二进制
  -> Go 校验 MIME、大小、尺寸、auth、参考图数量
  -> Go 把 WebP 传给 OpenAI /images/edits
  -> provider 返回 PNG 或临时 URL（生成图最高支持 4K，按模型/provider 能力生效）
  -> Go 处理结果：原图 + WebP 预览 + WebP 缩略图
  -> 上传 COS
```

建议上传协议：

```http
POST /api/image/references
Content-Type: multipart/form-data

file: reference.webp
metadata: {
  "sourceMime": "image/jpeg",
  "sourceName": "input.jpg",
  "width": 2048,
  "height": 1536,
  "quality": 0.86
}
```

校验规则：

- 前端选择阶段允许 JPEG、PNG、HEIC。
- 正常上传路径只把压缩后的 WebP 二进制传给 Go。
- 参考图最大边为 2048 px；服务端必须强校验尺寸、MIME、上传体积和参考图数量。
- 不设置 500 KB 硬目标；压缩策略优先保证 2K 参考图可用画质，再在可接受范围内降低体积。
- 生成图最高支持 4K；实际可选尺寸由 provider/model 能力和后台配置共同决定。
- 上传前去掉 EXIF 和 GPS 信息。
- 保留调试需要的尺寸和来源 MIME，不把用户本地完整文件名作为公开数据。
- 如果浏览器不支持 HEIC 解码，要给明确错误；或者引入专门的前端解码方案。

实现前需要确认：如果目标 provider 或模型的 `/images/edits` 不接受 WebP，Go 要么转成 PNG 再转发，要么在管理员配置里标记该 provider 不支持 WebP 参考图。

## 迁移计划

### 阶段 1：稳定当前 sidecar 模式

- 保持 Render 单 Docker 后端作为生产路径，直到 Go-owned API 完成等价验证。
- 保持 Node 作为公开 API 入口。
- 保持 `backend/gateway/src/routes/go-sidecar.ts` 的代理规则显式可查。
- Node fallback 路由不再新增生图、存储、额度 mutation 逻辑。
- 维护额度退款、幂等 replay/conflict、图片历史保存失败等测试。
- 生图快速返回前，先设计持久化任务表和异步 worker。
- 管理员后台暴露 `persistence_failed` 图片和重试/修复入口。

### 阶段 2：准备 Vercel 前端

- 如果 Vercel 成为主前端，再添加 `vercel.json`。
- 配置 `VITE_API_BASE_URL` 指向稳定 API 域名。
- 后端 CORS 增加 Vercel 生产域名和预览域名。
- 验证 Render 前端和 Vercel 前端都能调用同一个后端。
- 实现前端参考图压缩：WebP、最大边 2048 px，质量按 0.85-0.90 区间自适应。

### 阶段 3：加固单 Render Docker 后端

- 保持 Node 和 Go 在同一个 Render Docker 服务内运行。
- 保持 `GO_GATEWAY_BASE_URL=http://127.0.0.1:3001`，Go 只接受容器内代理访问。
- 在启动脚本中先启动 Go，等待 `/ready` 或 `/health`，再启动 Node。
- 给 Render health check 指向 Node 的 `/health`，Node 启动前必须确认 Go sidecar 已就绪。
- 可选引入 Cloudflare / Nginx 做域名、TLS、缓存和 WAF，但不把 Go 直接暴露给浏览器。

### 阶段 4：图片最终 owner 收口到 Go

- `/api/image/generate` 经 Node 代理到 Go。
- `/api/image/references` 经 Node 代理到 Go。
- `/api/image/storage/*` 经 Node 代理到 Go。
- `/api/image/history*` 等价验证后收口到 Go。
- 生产稳定后继续保留 Node 503 fallback 作为缺少 sidecar 配置时的明确错误，不再恢复旧 Node 生图管线。

### 阶段 5：后台任务与实时进度

- Go 增加 worker：过期图片清理、失败补偿、统计报表、永久化重试。
- 前端有明确进度 UI 后，再增加 `/api/ws` 或其它实时通道。
- 生图进度和 Chat SSE 分开，不要混成一条链路。

## 路由表

| 路由 | 当前行为 | 目标行为 |
|---|---|---|
| `/api/chat` | Node 负责产品 chat；Go 不注册该路由 | Node only |
| `/api/skills` | Node | Node |
| `/api/tools` | Node | Node |
| `/api/admin/*` | Node | Node BFF |
| `/api/admin/provider-settings` | 尚未最终定型 | Node BFF，管理员 only |
| `/api/config/app` | sidecar 模式下代理到 Go | 按领域确定 owner，必要时保留 Node facade |
| `/api/config/supabase` | sidecar 模式下代理到 Go | 按领域确定 owner，必要时保留 Node facade |
| `/api/image/generate` | sidecar 配置存在时 Node 代理到 Go | Go |
| `/api/image/references` | sidecar 配置存在时 Node 代理到 Go | Go |
| `/api/image/storage/*` | sidecar 配置存在时 Node 代理到 Go | Go |
| `/api/image/history*` | 迁移敏感，改动前要核对当前代码 | Go |
| `/api/credits` | sidecar 配置存在时 Node 代理到 Go | Go |
| `/api/ws` | 当前不是最终生产链路 | 需要进度 UI 后由 Go 承担 |

## 非目标

- 不在图片迁移里重写 Skill、MCP、Admin 到 Go。
- 不允许 Node 和 Go 同时最终写入同一个业务状态。
- 不让 Supabase RPC 调外部 API 或对象存储。
- 在 Node facade 仍承担兼容职责时，不让前端直接依赖 Go 内部响应形状。

## 验收标准

| 维度 | 要求 |
|---|---|
| 职责清晰 | 每个可变业务状态只有一个最终写入 owner。 |
| 额度安全 | 并发请求不能把余额扣成负数；Go 生图扣费读取后台 `app_settings.image_credit_cost_per_image`。 |
| 幂等可靠 | 重试不会重复扣费，也不会重复返回不一致结果；带 `Idempotency-Key` 时幂等服务不可用则拒绝扣费请求。 |
| 失败处理 | 预扣后的失败必须退款，或进入可见补偿流程。 |
| 快速生图响应 | 可以先返回 provider 临时 URL，同时有持久化任务和状态。 |
| 参考图上传 | 前端压缩 WebP，参考图最大边 2048 px，服务端强校验体积、类型、尺寸。 |
| 生成图尺寸 | 生成图最高支持 4K，实际尺寸由 provider/model 能力和后台配置决定。 |
| 前端兼容 | 迁移期间公开 API 路径和响应字段保持兼容。 |
| 部署清晰 | 当前和目标都按单 Render Docker 后端记录：Node 对外，Go 作为本机 sidecar。 |
| 可观测 | Node 和 Go 记录 request id、user id、latency、provider status、error type。 |

## 近期待办

- 决定 `docs/node-go-architecture-plan.md` 是保留为历史高层计划，还是由本文替代。
- 只有在真实引入 Vercel 部署时，再添加 `vercel.json`；Vercel 前端仍指向同一个 Render Docker 后端。
- 清理其它文档里的 `reserve_image_credits` 表述，改成当前项目实际使用的 `reserve_user_credits`。
- Go `/api/chat` 能力已删除；后续不要在 Go 中新增 Chat/MCP/Skill 链路。
- 切换 `/api/image/history*` 到 Go 前，先核对当前路由和响应字段。
- 继续扩展 `provider_settings`；当前 Go 生图扣费已接入 `app_settings.image_credit_cost_per_image`。
- 设计异步图片永久化任务表和图片状态字段。
- 实现浏览器端 2K 参考图压缩和 multipart WebP 上传。
