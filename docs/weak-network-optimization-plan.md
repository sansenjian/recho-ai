# 弱网体验优化规划（缓存 / 请求去重 / 离线缓存 / 渲染优化）

> 适用范围：recho-ai 以生图为核心的 To-C 场景。本文档对应四项优化：缓存策略、请求合并/去重、Service Worker 离线缓存、前端渲染优化。
> 目标：在不引入新基础架构的前提下，显著改善网络较差用户的加载与交互体验。

## 背景与现状快照

| 维度 | 现状 |
|---|---|
| 生图链路 | 普通 HTTP 长请求（6 分钟超时），无 SSE；Go 网关已有 `image_generation_jobs` 任务队列基建 |
| 历史存储 | localStorage + IndexedDB 本地历史 + Supabase/COS 远端（`useImageGen.ts`） |
| 图片缓存 | 已设置 `Cache-Control: max-age=31536000`，走 COS 公开 URL |
| API 缓存 | 历史 / 作品 / 配置接口无 `ETag`、无 `Cache-Control` |
| 图片加载 | Gallery 已用 `loading="lazy"`，无 `decoding="async"` |
| 构建产物 | 未做路由级代码分割，重型 `ImageCanvas.vue` 进入首屏 |
| Service Worker | 未注册 |

---

## 2. 缓存策略

### 2.1 目标

- 减少重复请求流量，弱网下读取历史 / 作品 / 配置几乎不花流量。
- 生图接口绝不缓存，避免中间层缓存导致结果错乱或重复扣费。

### 2.2 方案

| 接口 | 策略 | 说明 |
|---|---|---|
| `POST /api/image/generate` | `Cache-Control: no-store` | 写接口，必须 no-store |
| `GET /api/image/history*` | `ETag` + `Cache-Control: private, max-age=30` + 客户端条件请求 | 30s 内直接 304，省流量 |
| `GET /api/image/history/:id`（详情） | 同上 | 详情可复用 |
| `GET /api/config/*` | `ETag` + `Cache-Control: private, max-age=60` | 配置低频变更 |
| 图片 / 缩略图 | 维持现状 `max-age=31536000` | 已有，不动 |

### 2.3 实施要点

- 后端在响应头统一注入缓存策略（Node 网关 `index.ts` / Go 网关 handler 层）。
- `ETag` 可从请求响应体计算（弱 hash），或从 `updated_at` 派生。
- 前端 `fetch` 改进：读接口带 `If-None-Match`，收到 304 使用本地缓存。
- 客户端"记忆上一次结果"（会话内内存缓存 30s）作为补充，减少闪空状态。

### 2.4 收益预估

- 历史列表首次 100KB → 30s 内重复请求 ≈ 0 字节（304）。
- 弱网翻页场景流量下降最明显。

---

## 3. 请求合并 / 去重

### 3.1 目标

- 同一时间窗内对同一幂等接口的重复请求，只发一次。
- 不占用、反而节省后端资源；写接口绝不合并。

### 3.2 方案

| 类别 | 做法 | 适用场景 |
|---|---|---|
| 前端 inflight 去重 | 统一 `apiFetch` 内部维护 pending Map：同 key（method+url+query）且未完成时复用同一 Promise | 历史、作品、配置等 GET |
| 后端读合并（可选） | 短时间窗（100ms）把相同读请求合并为一次上游调用 | 历史列表热点接口 |
| 写接口 | 禁用合并；生图已有幂等键（`createIdempotencyKey`），保持现状 | generate / delete 等 |

### 3.3 实施要点

- 仅对幂等 GET 生效；`401/403/4xx` 不缓存失败结果，允许重试。
- pending Map 需在请求完成/失败时清理，避免内存累积（参考 LRU 上限策略）。
- 后端合并涉及内存中的 pending table，需设置 TTL 与上限。

### 3.4 收益

- 组件重复挂载 / 快速切页时，后端收到请求数直降。
- 对弱网而言，重复请求被复用也意味着少一次往返竞争带宽。

---

## 4. Service Worker 离线缓存

### 4.1 目标

- 二次打开秒开（静态壳缓存），断网/弱网仍可回看已加载的作品与历史。

### 4.2 方案（分阶段）

| 阶段 | 内容 | 优先级 |
|---|---|---|
| 阶段 A | 注册 SW，precache Vite 构建产物（`workbox` 或手写） | 高 |
| 阶段 B | 运行时缓存 API 响应（历史 / 配置）与图片（thumbnail / preview） | 中 |
| 阶段 C | 离线提示（`navigator.onLine` + SW 事件）、队列化提交 | 低 |

### 4.3 实施要点

- 版本管理：每次构建产出新 SW 版本，用 `skipWaiting` + `clients.claim`，避免旧缓存污染。
- 缓存清理：限制缓存大小（LRU），图片缓存设上限，避免 IndexedDB/Cache 无限增长。
- 敏感数据：历史含用户私有数据，缓存须限定当前登录用户作用域，登出时清空。
- 与现有 IndexedDB 历史（`recho-private-image-history-db`）共用边界，避免双写一读混乱。

### 4.4 风险提示

- SW 生命周期与缓存失效是主要维护成本；缓存策略错误会导致"永久旧版本"。
- 建议先做阶段 A（静态壳），验证收益后再扩展图片与 API 缓存。

---

## 5. 前端渲染优化

### 5.1 目标

- 首屏更快、弱网不白屏、长列表不卡顿。

### 5.2 方案（按收益排序）

| # | 做法 | 说明 |
|---|---|---|
| 1 | 路由级代码分割 | 重型组件（`ImageCanvas.vue`、Gallery 弹层）动态 `import()`，不进首屏包 |
| 2 | 骨架屏 | 生图等待 / 历史加载占位，弱网不白屏 |
| 3 | `decoding="async"` | `<img>` 解码不阻塞主线程（覆盖 Gallery 全部图片） |
| 4 | `v-memo` 长列表 | 图库 / 历史几百项时跳过无变化项 diff |
| 5 | `requestIdleCallback` | 预加载、统计等非关键逻辑放空闲执行 |
| 6 | hover/进入预加载 | 交互前预载 preview，弱网先 thumb 占位再升级（复用 `useGalleryDetailPreview` 模式） |

### 5.3 实施要点

- Vite 配置：确认 `build.rollupOptions` 触发自动分包；对超 200KB 的 chunk 加 `manualChunks` 提示。
- 骨架屏用现有 shadcn 占位组件（`Skeleton`）实现，避免新依赖。
- `v-memo` 需与列表 key 结合，避免误跳过有内容变化的项。

---

## 执行优先级建议

| 优先级 | 项目 | 成本 | 收益 |
|---|---|---|---|
| P0 | §2 缓存策略（ETag/no-store） | 低（纯服务端头） | 高（重复读 0 流量） |
| P0 | §3 前端 inflight 去重 | 低（apiFetch 收口） | 中高（少一半重复请求） |
| P0 | §5.1 路由代码分割 | 低（import() 拆分） | 高（首屏体积下降） |
| P1 | §5.2 骨架屏 + §5.4 decoding | 低 | 中（弱网感知提升） |
| P1 | §4 阶段 A 静态壳 SW | 中 | 中高（二次打开秒开） |
| P2 | §4 阶段 B/C + §5.5/5.6 | 中高 | 中（需产品确认刚需） |

> 说明：§1（SSE 流式）不在本规划内——生图当前为普通长请求，聊天开放给 C 端后再评估。