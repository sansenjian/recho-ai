# recho-ai

Recho-AI 是一个 Vue 3 + Vite 的 AI 聊天与生图应用。前端负责聊天、画布、生图工作流和管理后台；后端当前采用 Node Gateway + Go sidecar 的形态，Node 负责 Chat、MCP、Skill、Admin BFF 和统一外部入口，Go 承接图片生成、图片存储、额度和幂等。

## 快速开始

```bash
npm install
npm run dev
```

常用命令：

| 命令 | 说明 |
|---|---|
| `npm run dev` | 同时启动 Node Gateway、Go Gateway 和 Vite 前端；前端请求 `/api` 到 Node，Go-owned 路由由 Node 代理到 Go。 |
| `npm run dev:node` | 只启动 Node Gateway 和 Vite 前端，用于排查非生图链路；旧 Node 生图实现已下线。 |
| `npm run dev:frontend` | 只启动 Vite 前端，默认端口 5173。 |
| `npm run dev:backend` | 只启动 Node Gateway，默认端口 3000。 |
| `npm run dev:go` | 同 `npm run dev`，同时启动 Node、Go sidecar 和 Vite。 |
| `npm test` | 运行 Vitest 测试。 |
| `npm run build` | 运行 Vue 类型检查并构建前端。 |
| `cd backend/gateway && npm run build` | 编译 Node Gateway TypeScript。 |
| `cd backend/gateway && npm run typecheck` | 仅检查 Node Gateway 类型。 |
| `cd backend/go-gateway && go test ./...` | 运行 Go Gateway 测试。 |

## 项目结构

| 路径 | 说明 |
|---|---|
| `src/` | Vue 前端、聊天状态、画布、生图 UI、管理后台。 |
| `backend/gateway/src/` | Node/Express Gateway 源码。 |
| `backend/gateway/skills/` | 内置 Skill 定义。 |
| `backend/go-gateway/` | Go Gateway / Go sidecar，承接图片、额度、幂等能力。 |
| `supabase/migrations/` | Supabase / PostgreSQL 迁移脚本。 |
| `docs/` | 项目架构、迁移、部署和功能规划文档。 |

## 本地请求路径

开发模式下，Vite 把 `/api` 代理到 Node Gateway（`3000`）。`npm run dev` 会给 Node 注入 `GO_GATEWAY_BASE_URL=http://127.0.0.1:3001`，因此 `/api/image/*`、`/api/credits*`、`/api/config/app`、`/api/config/supabase` 会由 Node 代理到 Go sidecar（`3001`）。前端不需要设置 `VITE_IMAGE_API_BASE_URL`；该变量只保留给独立图片服务或专项验证使用。

## 文档入口

- [文档索引](./docs/README.md)
- [当前架构与目标架构](./docs/recho-ai-architecture-current-and-target.md)
- [Node.js 与 Go 网关未来分工分析](./docs/gateway-division-analysis.md)
- [Go Gateway Migration](./docs/go-gateway-migration.md)

当前架构事实优先以 [当前架构与目标架构](./docs/recho-ai-architecture-current-and-target.md) 为准；其它历史方案用于对照和追溯。
