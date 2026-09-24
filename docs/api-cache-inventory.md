# API 缓存打标清单（双网关）

> 对应 `docs/weak-network-optimization-plan.md` §2.2 阶段一产出物。
> 用途：缓存策略实施（§2.3）前的接口可缓存性盘点。**HTTP 缓存**与**前端 in-flight 去重**是两个独立机制，分开判定：
> - **HTTP 缓存**（§2.3，后端注入 ETag/Cache-Control）：仅允许作用于标为「可缓存」的幂等读接口，其余一律 `no-store`。
> - **in-flight 去重**（§3，前端 `apiFetch`）：仅对满足全部条件的请求合并——幂等读方法（实现取 GET/HEAD/OPTIONS）+ **无请求体** + **未显式 `cache: 'no-store'`** + **未携带自定义请求头或凭据**；任一不满足即不去重。
>
> 判定规则：方法幂等性（GET/HEAD/OPTIONS/PUT/DELETE 幂等；POST、PATCH 非幂等）× 是否改变状态（扣费 / 写库 / 触发任务），双维度取「非幂等 或 改状态 → 写（no-store）」。

图例：`可缓存` = 可加 ETag + 短 TTL；`no-store` = 禁止缓存（写接口及身份敏感接口）；`代理` = 转发标注的目标网关。

## 流量入口说明

生产流量统一先到 **Node 网关**（单一入口）。其中 Go-owned 路由（图片生成、额度、部分配置）由 Node 的 go-sidecar 代理转发给 Go 网关（`backend/gateway/src/routes/go-sidecar.ts`）。因此下表同时标注 **owner**，缓存头最终在**实际响应的网关**上写入，实现侧需逐网关覆盖。

---

## 一、Node 网关（`backend/gateway/src/routes/*`，owner=node）

### 1. 公开 / 会话 / 用户接口

| 方法 | 路径 | 文件:行 | 语义 | 打标 |
|---|---|---|---|---|
| POST | `/api/chat` | routes/chat.ts:18 | 流式聊天，长连接 | **no-store**（流式，不可缓存） |
| GET | `/api/skills` | routes/skills.ts:6 | 技能定义 | 可缓存（TTL 60s） |
| GET | `/api/tools` | routes/tools.ts:6 | MCP 工具列表 | 可缓存（TTL 30s） |
| GET | `/api/api-keys` | routes/api-keys.ts | 查询本人 API 密钥 | **no-store**（身份敏感，只返回当前用户自己的 key） |
| POST | `/api/api-keys` | routes/api-keys.ts | 签发本人 API 密钥（绑定当前登录用户） | **no-store**（写） |
| DELETE | `/api/api-keys/:id` | routes/api-keys.ts | 撤销本人 API 密钥 | **no-store**（写，只能撤销自己的） |
| GET | `/health` | routes/health.ts:10 | 健康检查 | 不处理（监控专用） |

### 2. 图片接口（Node 旧实现 / 兼容路径）

| 方法 | 路径 | 文件:行 | 语义 | 打标 |
|---|---|---|---|---|
| POST | `/api/image/references` | routes/image.ts:138 | 参考图上传（写存储） | **no-store**（写 + 上传） |
| GET | `/api/image/storage/*` | routes/image.ts:198 | 存储对象代理下载 | 可缓存（图片字节，长 TTL） |
| POST | `/api/image/generate` | routes/image.ts:245 | 生图（Go 接管前遗留 503 迁移提示） | **no-store**（写 + 扣费） |
| POST | `/api/image/events` | routes/image-events.ts:60 | 事件上报 | **no-store**（写） |

### 3. Config 接口

| 方法 | 路径 | 文件:行 | 语义 | 打标 |
|---|---|---|---|---|
| GET | `/api/config/supabase` | routes/config.ts:8 | Supabase 公开配置 | 可缓存（TTL 60s） |
| GET | `/api/config/app` | routes/config.ts:18 | 应用公开配置 | 可缓存（TTL 60s；写后主动失效） |

### 4. Admin 接口（仅管理员，低并发；含管理员/用户敏感数据，一律 no-store）

| 方法 | 路径 | 文件:行 | 语义 | 打标 |
|---|---|---|---|---|
| GET | `/admin/credits/me` · `/admin/credits/users` · `/admin/credits/overview` · `/admin/credits/transactions` · `/admin/credits/users/:userId` · `/admin/credits/codes` · `/admin/credits/codes/:codeId/redemptions` | routes/admin-credits.ts | 额度查询（管理） | **no-store**（返回当前管理员/用户数据，未定义身份分区缓存键与登出失效，不可缓存） |
| POST | `/admin/credits/users/:userId/adjust`· `/admin/credits/codes` | routes/admin-credits.ts:115,163 | 调额 / 建码 | **no-store**（写） |
| PATCH | `/admin/credits/codes/:codeId` | routes/admin-credits.ts:175 | 改码 | **no-store**（写） |
| GET | `/admin/images` · `/admin/images/storage-overview` | routes/admin-images.ts:47,65 | 管理列表 | **no-store**（管理，身份敏感） |
| PATCH | `/admin/images/bulk/visibility` · `/admin/images/:id/visibility` | routes/admin-images.ts:77,113 | 可见性变更 | **no-store**（写） |
| POST | `/admin/images/bulk/archive` · `/admin/images/bulk/delete` | routes/admin-images.ts:89,101 | 归档 / 删除 | **no-store**（写） |
| GET | `/admin/image-attempts` | routes/admin-image-attempts.ts:38 | 尝试记录查询 | **no-store**（管理，身份敏感） |
| GET | `/admin/system` · `/admin/settings` | routes/admin-system.ts:82,94 | 系统/设置查询 | **no-store**（管理，身份敏感） |
| PATCH | `/admin/settings` · `/admin/settings/providers/:providerId` · `/admin/settings/admin-users/:ruleId` | routes/admin-system.ts:121,153,190 | 设置 / Provider / 用户规则更新 | **no-store**（写） |
| POST | `/admin/settings/providers` · `/admin/settings/admin-users` | routes/admin-system.ts:133,173 | 新增 Provider / admin 用户 | **no-store**（写） |
| GET | `/announcements` | routes/admin-announcements.ts:45 | 公告查询（公开） | 可缓存（TTL 30s） |
| GET | `/admin/announcements` | routes/admin-announcements.ts:56 | 公告查询（管理） | **no-store**（管理，身份敏感） |
| POST | `/admin/announcements` | routes/admin-announcements.ts:71 | 发布公告 | **no-store**（写） |
| PATCH | `/admin/announcements/:announcementId` | routes/admin-announcements.ts:83 | 更新公告 | **no-store**（写） |
| GET | `/admin/api-keys` | routes/api-keys.ts | 全站 API 密钥列表（管理） | **no-store**（管理，含归属用户信息） |
| POST | `/admin/api-keys` | routes/api-keys.ts | 签发密钥（管理入口） | **no-store**（写） |
| DELETE | `/admin/api-keys/:id` | routes/api-keys.ts | 撤销任意密钥（管理） | **no-store**（写） |

---

## 二、Go 网关（`backend/go-gateway/internal/handler/*`，owner=go，经 Node go-sidecar 代理）

### 5. 健康 / 配置

| 方法 | 路径 | 文件 | 语义 | 打标 |
|---|---|---|---|---|
| GET | `/health` · `/ready` · `/live` · `/` | handler/health.go:99-104 | 健康检查 | 不处理（监控专用） |
| GET | `/api/config/supabase` · `/api/config/app` | handler/config.go:59-62 | 公开配置 | 可缓存（TTL 60s） |

### 6. 额度

| 方法 | 路径 | 文件 | 语义 | 打标 |
|---|---|---|---|---|
| GET | `/api/credits` | handler/credits.go:186 | 余额查询（按 user.ID） | **no-store**（身份敏感；未定义身份分区缓存键与登出失效） |
| POST | `/api/credits/redeem` | handler/credits.go:187 | 兑换码核销 | **no-store**（写 + 余额变化） |

### 7. 图片（实际 owner）

| 方法 | 路径 | 文件 | 语义 | 打标 |
|---|---|---|---|---|
| POST | `/api/image/generate` | handler/image.go:136 | 生图（写 + 扣费） | **no-store**（写，绝不可缓存） |
| POST | `/api/image/references` | handler/image.go:211 | 参考图上传 | **no-store**（写 + 上传） |
| GET | `/api/image/storage/{encodedPath}` | handler/image.go:279 | 存储对象代理 | 可缓存（图片字节，长 TTL） |
| GET | `/api/image/history` | handler/image.go:348 | 历史列表 | `scope=public` 可缓存（TTL 30s）；`scope=mine` **no-store**（身份敏感） |
| GET | `/api/image/history/:id` | handler/image.go:422 | 历史详情 | `scope=public` 可缓存（TTL 30s）；`scope=mine` **no-store**（身份敏感） |
| DELETE | `/api/image/history/:id` | handler/image.go:457 | 删除单条 | **no-store**（写） |
| DELETE | `/api/image/history` | handler/image.go:487 | 清空历史 | **no-store**（写） |
| GET | `/api/image/diagnostics` | handler/image.go:534 | 服务诊断 | 不处理（运维专用，未对外注册） |

---

## 三、执行摘要

- **总接口数**：Node 44 条 + Go 16 条（含健康/实时）。
- **可缓存（读）**：约 10 条 —— 主推 `scope=public` 历史、`/api/config/*`、`/api/skills`、`/api/tools`、`/announcements`、存储对象代理。
- **no-store（写 / 身份敏感）**：约 44 条 —— 生图、上传、删除、额度调整、`/api/credits`、`scope=mine` 历史、API 密钥（用户与管理两侧）、全部 admin 接口（含管理 GET，避免跨身份缓存串数据）。
- **不处理（监控/实时）**：health、diagnostics。

## 四、实施注意事项（§2.3 对照）

1. 缓存头在**实际响应网关**写入：`/api/image/*`、`/api/credits*` 由 Go 网关输出（经 Node 代理时需透传 `Cache-Control`/`ETag` 头，go-sidecar 目前会过滤 `content-encoding`/`content-length` 等——新头需加入透传白名单）。
2. Admin 写操作成功后，需主动失效同域读缓存（如 `PATCH /admin/settings` 后清 `/api/config/app`）。
3. 历史接口区分 `public`/`mine` 作用域：`mine` 含私有数据，响应头用 `private`；`public` 可用较短 `public, max-age`。
4. 前端条件请求（`If-None-Match`）仅对可缓存读接口启用，且保证 304 时必有本地缓存可回退。