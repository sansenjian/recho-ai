# Node.js 与 Go 网关未来分工分析

> 更新时间：2026-06-26

---

## 一、现状概览

当前架构为 **双网关并行 + 条件代理**：

```text
                        ┌─────────────────┐
                        │   前端 (Vue 3)   │
                        └────────┬────────┘
                                 │ /api/*
                                 ▼
                        ┌─────────────────┐
                        │  Node.js Express │  ← 端口 3000（主入口）
                        │  (go-sidecar.ts) │
                        └───┬─────────┬───┘
                代理到 Go │         │ 本地处理
                          ▼         ▼
                  ┌───────────┐  ┌──────────────┐
                  │ Go (chi)  │  │ Node 路由:     │
                  │ 端口 3001 │  │ chat / skills │
                  │           │  │ tools / admin │
                  │ 图片/额度  │  │ health / 代理  │
                  │ 配置读取   │  │               │
                  └─────┬─────┘  └──────────────┘
                        │
                  直连 PostgreSQL
```

Node.js `go-sidecar.ts` 根据 `GO_GATEWAY_BASE_URL` 环境变量决定是否将请求代理到 Go。当前 Render 生产环境已启用代理，覆盖路径：

| 代理路径 | Go Handler | 状态 |
|---|---|---|
| `/api/image/*` | ImageHandler | 已代理（生产运行中） |
| `/api/credits*` | CreditsHandler | 已代理（生产运行中） |
| `/api/config/app` | ConfigHandler | 已代理（生产运行中） |
| `/api/config/supabase` | ConfigHandler | 已代理（生产运行中） |
| `/api/chat` | 无 | Go 侧已删除，Chat 仅归 Node |

---

## 二、两网关能力对比

| 维度 | Node.js | Go |
|---|---|---|
| 核心聊天 | ✅ 完整（Skill 注入、MCP 工具、TAOR 循环、重试、限流、多模型路由） | ⚠️ 轻量（仅基础转发，无 Skill/MCP/重试） |
| 图片生成 | ✅（但已代理到 Go） | ✅ 完整（libvips 处理、COS/S3 上传、幂等、重试） |
| 图片历史 CRUD | ✅（但已代理到 Go） | ✅ 完整 |
| 额度管理 | ✅（但已代理到 Go） | ✅ 完整（含幂等） |
| 应用配置 | ✅（但已代理到 Go） | ✅ 完整 |
| Skill 系统 | ✅ | ❌ |
| MCP 工具管理 | ✅ | ❌ |
| 管理后台（5 模块） | ✅ | ❌ |
| 图片事件分析 | ✅ | ❌ |
| 数据库访问 | HTTP → PostgREST | pgx 直连（零 HTTP 开销、原子事务） |
| 图片处理 | sharp（Node 原生） | libvips（更快、更低内存，需 CGO） |
| 原子事务支持 | ❌（多步需写成 RPC） | ✅（`Begin → QueryRow → QueryRow → Commit`） |
| GOMEMLIMIT 内存控制 | ❌ | ✅（Go 1.19+ 自动软限制 GC） |
| WebAssembly 可移植 | ❌ | ✅（TinyGo / Wazero） |

---

## 三、分工原则

### Go 适合的场景

1. **高吞吐数值管线** — 图片编解码、S3 上传、并发处理
2. **需要原子事务的多步 DB 操作** — Node 的 PostgREST 单次只能一个 SQL，多步必须预写 RPC
3. **内存/并发控制** — GOMEMLIMIT 比 Node.js 手动控制更可靠
4. **长期稳定、低变化的基础设施层**

### Node.js 适合的场景

1. **高度动态、频繁迭代的功能** — Skill 定义、MCP 连接管理、Admin UI 后端
2. **与 JavaScript 生态紧耦合** — Supabase JS SDK、MCP SDK (Node.js 原生)
3. **需要快速原型验证的新功能** — TypeScript 开发反馈循环更快
4. **已有成熟实现的存量功能** — chat 核心逻辑、admin 全部模块

---

## 四、推荐分工方案

### Go 网关 — 稳定基础设施层

| 模块 | 理由 |
|---|---|
| **图片管线**（generate/references/storage） | 已成熟。libvips 性能优势 + COS/S3 上传 + 幂等 + 重试 — 功能完整，不再频繁变更 |
| **图片历史 CRUD** | 已成熟。简单 CRUD，适合 pgx 直连 |
| **额度管理**（balance/redeem） | 已成熟。需原子事务（预留+退款），Go 原生支持 |
| **应用配置** | 已成熟。读取 app_settings 表的简单映射 |
| **健康检查**（health/ready/live） | 已实现。K8s 风格探针，Node 侧无需重复 |

### Node.js 网关 — 动态业务逻辑层

| 模块 | 理由 |
|---|---|
| **核心聊天**（chat loop + tool calling） | 频繁迭代。Skill 注入、MCP 工具解析、TAOR 流式循环 — 依赖 Node.js MCP SDK 和自有 Skill 引擎，短期不可能迁移 |
| **Skill 系统** | 纯 Node.js 生态。Markdown 定义 → 前端展示 → 注入 system prompt → 过滤工具 — 全链 JavaScript |
| **MCP 工具管理** | 纯 Node.js 生态。MCP SDK 连接管理、工具发现、schema 转换 — 依赖 Node.js 原生 |
| **管理后台**（credits/images/attempts/system/announcements） | 低流量、高变更频率。CRUD + PostgREST 完全满足，无需迁移 |
| **图片事件分析** | 低流量。用户行为追踪、事件存储 |

### Chat 端点：不迁移

Go 侧 `/api/chat` 能力已删除，Chat 只由 Node Gateway 负责。原因是 Chat 的产品能力不只是流式转发，还包括：
- Skill system prompt 注入
- MCP 工具列表获取和 schema 转换
- TAOR 工具调用循环（agentic loop）
- 模型路由和负载均衡
- 重试/限流逻辑

这些能力深度依赖 Node.js 的 Skill Loader 和 MCP Manager 模块。Go 不再保留纯转发版本，避免形成第二套不完整 Chat 行为。

---

## 五、迁移路线图

### 第 1 阶段（✅ 已完成）

- [x] Go 图片管线（生成 / 参考图上传 / 存储代理）
- [x] Go 图片历史 CRUD
- [x] Go 额度管理（含幂等）
- [x] Go 应用配置
- [x] Node.js go-sidecar 代理中间件
- [x] Render 生产环境启用代理

### 第 2 阶段（当前）

- [x] PgBouncer 兼容性修复（禁 prepared statement）
- [x] 缺失 RPC 函数恢复（admin_image_storage_overview 等）
- [x] 图片生成结果截断（count 控制）
- [ ] Go 网关独立健康检查接入 Render 就绪探针

### 第 3 阶段（短期 — 1~3 个月）

- [x] 删除 Go `/api/chat` 能力，Chat 仅保留在 Node Gateway
- [ ] Go 侧增加请求追踪（OpenTelemetry / 结构化日志）
- [ ] Node 侧 admin 模块拆分独立路由文件（如规模增长）
- [ ] 统一错误码体系（Go ↔ Node 对齐）

  > 建议优先推进统一错误码体系，以降低双网关维护成本。

### 第 4 阶段（中期 — 3~6 个月）

- [ ] 如团队具备 Rust/Wasm 能力，评估图片处理迁移到 wasm
- [ ] 如 Node 侧 Chat 负载成为瓶颈，优先优化 Node Gateway 或拆专用 Node Chat Worker，而不是在 Go 重建 Skill/MCP 链路
- [ ] 数据库直连监控指标接入 Render dashboard

### 第 5 阶段（长期 — 6 个月+）

- [ ] 根据负载评估是否将 Node.js 降级为纯 Skill/MCP/Admin API 服务器
- [ ] Go 成为唯一面向终端用户的高流量网关
- [ ] 如 Supabase 推出 Go SDK，评估替代 pgx 直连方案

---

## 六、关键技术决策记录

### 为什么不把所有东西都用 Go 重写？

1. **Skill 系统**是 Node.js 生态的原生产物 — Markdown 解析、动态 system prompt 拼接、工具白名单过滤 — 在 Go 中重建需大量工程投入，收益有限
2. **MCP Manager** 依赖 Node.js MCP SDK（`@modelcontextprotocol/sdk`），Go 端无等价生态
3. **Admin 模块**流量极低、全 CRUD — 用 PostgREST HTTP 完全够用，迁移到 Go 投入产出比低
4. **Go 不保留 ChatHandler** — 纯转发会制造第二套不完整行为，Chat/MCP/Skill 统一留在 Node

### 为什么选择 pgx 直连而非 PostgREST HTTP？

| pgx 直连 | PostgREST HTTP |
|---|---|
| 零 HTTP 往返 | 每次查询一次 HTTP |
| 原子事务 `BEGIN→QUERY→QUERY→COMMIT` | 多步必须预写 RPC 函数 |
| 可写任意 SQL | 受 RLS + schema 约束 |
| 需自管理连接池和 PgBouncer 兼容 | 无需管理连接 |
| 适合 OLTP 高频操作 | 适合低频 CRUD |

Go 网关处理的是图片生成管线（每张图涉及：预留额度→检查上游→处理图片→上传→记录历史→确认扣除），多步原子事务是刚需。Node.js 的 PostgREST HTTP 方式无事务支持，必须提前写好 `reserve_user_credits` 等 RPC 函数，且每个 RPC 仍是一步原子操作。

### PgBouncer 42P05 已修复

见 [PR #55](https://github.com/sansenjian/recho-ai/pull/55)：检测 `pooler.supabase.com` / `:6543` 连接字符串 → 设置 `QueryExecModeExec` 禁用 prepared statement 缓存。

---

## 七、架构收益总结

| 指标 | 迁移前（纯 Node） | 迁移后（Node + Go） |
|---|---|---|
| 图片处理吞吐 | sharp 同步阻塞 Node 事件循环 | libvips C 库，Go goroutine 并发 |
| 数据库操作 | HTTP → PostgREST → PG（双向网络开销） | pgx 直连（单 TCP 连接池） |
| 原子事务 | 不支持，必须预写 RPC | Go `database/sql` 原生支持 |
| 内存控制 | V8 堆 + 手动 `--max-old-space-size` | `GOMEMLIMIT` 自动软限制 |
| 图片生成并发 | 受 Node 单线程限制 | goroutine 并发 + S3 multipart 并发 |
| Skill/MCP 灵活度 | 原生支持 | 不支持（短期无需） |
| Admin 迭代速度 | TypeScript 快速原型 | 不支持（短期无需） |

**结论**：将稳定的高吞吐基础设施层（图片管线、额度管理）移到 Go，保留迭代频繁的业务逻辑层（Chat/Skill/MCP/Admin）在 Node.js，是目前最优解。
