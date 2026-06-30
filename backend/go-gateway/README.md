# Go Gateway

高性能 API 网关，使用 Go 语言重写 Node.js Express 网关。

## 迁移策略

当前 Go 网关以并行服务方式引入，不直接替换 `backend/gateway` 的 Node.js 网关。

- Node 网关仍然是默认 HTTP 入口，Chat / MCP / Admin BFF 继续由 Node 处理。
- Go 网关建议监听 `3001`，负责图片生成、图片存储、额度和幂等链路。
- 本地 `npm run dev` / `npm run dev:go` 会同时启动 Node 和 Go，并给 Node 注入 `GO_GATEWAY_BASE_URL=http://127.0.0.1:3001`。
- 本地默认路径是前端请求 `/api` 到 Node，再由 Node 代理图片、额度和配置路由到 Go；`VITE_IMAGE_API_BASE_URL` 只保留给独立图片服务或专项验证使用。
- Node 旧生图实现已下线；没有 Go sidecar 或 `GO_GATEWAY_BASE_URL` 时，Node `/api/image/generate` 只返回迁移提示。

## 快速开始

### 前置要求

- Go 1.25+
- PostgreSQL 连接（通过 `DATABASE_URL` 或 Supabase `POSTGRES_URL`）

### 安装依赖

```bash
cd backend/go-gateway
go mod tidy
```

### 运行

```bash
# 开发模式
go run ./cmd/server/

# 或在项目根目录启动 Node + Go + Vite
npm run dev

# 构建
go build -o go-gateway ./cmd/server/
./go-gateway
```

### 环境变量

```bash
# Server
PORT=3001
APP_ENV=development
CORS_ORIGIN=http://localhost:5173

# Supabase Database
POSTGRES_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
SUPABASE_URL=https://[PROJECT].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[SERVICE_ROLE_KEY]
# Optional: defaults to SUPABASE_URL/auth/v1/.well-known/jwks.json
SUPABASE_JWKS_URL=

# Image Generation
# Fallback only. Prefer admin-managed encrypted provider settings.
IMAGE_GEN_API_KEY=[API_KEY]
IMAGE_GEN_BASE_URL=https://lucen.plus/v1
IMAGE_CREDIT_COST_PER_IMAGE=0.5

# Required when API keys are configured in Admin Provider settings.
# Use the same value for Node Gateway and Go Gateway.
# Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
PROVIDER_API_KEY_MASTER_KEY=[32_BYTE_BASE64URL_OR_HEX_KEY]

# Analytics
IMAGE_ANALYTICS_ENABLED=false
IMAGE_EVENTS_ENABLED=false
CANVAS_CONTEXT_ENABLED=false

# Admin
ADMIN_USER_IDS=user_id_1,user_id_2
ADMIN_USER_EMAILS=admin@example.com
```

## 项目结构

```text
backend/go-gateway/
├── cmd/server/main.go           # 应用入口
├── internal/
│   ├── config/                   # 配置加载
│   ├── handler/                  # HTTP 处理器
│   │   ├── health.go            # 健康检查
│   │   └── credits.go           # 额度管理
│   ├── middleware/               # 中间件
│   │   └── auth.go              # 认证
│   ├── repository/               # 数据库操作
│   │   └── credit.go            # 额度数据
│   ├── service/                  # 业务逻辑
│   │   └── credit.go            # 额度服务
│   └── pkg/
│       ├── response/             # 响应工具
│       └── supabase/             # Supabase 客户端
├── go.mod
└── Dockerfile
```

## API 端点

### 健康检查

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 服务信息 |
| `/health` | GET | 健康检查 |
| `/ready` | GET | 就绪检查（含数据库） |
| `/live` | GET | 存活检查 |

### 额度管理

| 端点 | 方法 | 描述 | 认证 |
|------|------|------|------|
| `/api/credits` | GET | 获取余额 | 需要 |
| `/api/credits/redeem` | POST | 兑换码 | 需要 |

## 与 Node.js 网关对比

| 指标 | Node.js | Go |
|------|--------|-----|
| 冷启动 | 3-10s | 50-200ms |
| 内存占用 | 100-200MB | 30-50MB |
| 并发能力 | 中等 | 高 |
| 开发效率 | 高 | 中 |

## 当前迁移状态

已引入：

- 健康检查：`/health`、`/ready`、`/live`
- 前端配置：`/api/config/app`、`/api/config/supabase`
- 额度接口：`/api/credits`、`/api/credits/redeem`
- 图片生成和历史基础接口：`/api/image/generate`、`/api/image/history`

不再提供：

- Chat 转发：`/api/chat` 只由 Node Gateway 负责，Go 不注册 chat 路由。

仍需补齐或验证：

- `/api/config/app` 读取数据库 `app_settings`
- 图片相关 API 与现有 Node 网关的错误格式、鉴权边界和响应字段等价性
- 图片存储代理和公开作品访问权限

## 部署

### Docker

```bash
docker build -t recho-go-gateway .
docker run -p 3001:3000 --env-file .env recho-go-gateway
```

### Render

1. 创建新 Web Service
2. 设置构建命令：`go build -o server ./cmd/server`
3. 设置启动命令：`./server`
4. 配置环境变量
