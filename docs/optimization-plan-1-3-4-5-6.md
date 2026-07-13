# Recho-AI 优化计划：1、3、4、5、6

> 文档状态：实施中（第 1 项原子启动/退款一致性和第 5 项 durable job/worker 主流程已完成）
> 基线日期：2026-07-11
> 适用范围：图片幂等与积分一致性、全链路可观测性、双网关契约测试、图片任务编排、IndexedDB 会话持久化

> 当前执行范围：优先完成生图链路（第 1、5 项，以及第 3、4 项中直接服务 `/api/image/*` 的部分）。IndexedDB 和其他非生图优化暂缓。

## 结论

这五项优化应分成两条主线推进：

```text
后端可靠性：3 可观测性 -> 4 契约测试 -> 5 编排加固 -> 1 一致性加固
前端持久化：6 IndexedDB 会话持久化，可与后端主线并行
```

当前仓库已经完成部分基础工作：

- Go 图片 Handler 已将主要生成流程下沉到 `internal/orchestrator`，并使用 Saga 表达异步持久化补偿。
- 已存在持久化的 `idempotency_keys`、额度预扣/退款 RPC，以及顺序执行路径下的累计退款检查。
- Go 已启用请求 ID 中间件，Node 代理已有超时、客户端断开取消和图片尝试记录。
- Node 代理与 Go Handler/Orchestrator 已有局部测试。
- 聊天 Store 仍使用 `localStorage`，通过 500 ms debounce 降低流式输出期间的同步写入频率。

因此，本计划不是从零重写。重点是补齐进程崩溃恢复、统一观测字段、跨网关契约、持久化任务状态和会话数据迁移。

## 范围与非目标

本计划只覆盖上一轮确认的 `1、3、4、5、6` 五项优化。

不在本计划中处理：

- 不重写 Chat、MCP、Skill 或 Admin 到 Go。
- 不改变前端公开 API 路径。
- 不把所有接口一次性迁移到 OpenAPI。
- 不在 IndexedDB 迁移中同时重构聊天 UI。
- 不把数据库事务扩展到外部图片 Provider 或对象存储。
- 不把五项优化合并成一个大 PR。

## 当前基线

| 编号 | 优化项 | 当前状态 | 主要剩余工作 |
|---|---|---|---|
| 1 | 图片幂等与积分一致性 | 生图主链路及对账入口已完成 | 部署 migrations 后启用对账并观察审计结果 |
| 3 | Node/Go 全链路可观测性 | 生图生命周期关联日志已完成 | 在部署平台配置基于日志/审计表的告警规则 |
| 4 | 双网关契约测试 | 生图基础及真实不可用场景已完成 | 外部 Provider 成功/部分返回继续由 Go 故障注入测试覆盖 |
| 5 | 图片任务编排下沉 | durable job/worker 主流程完成 | 线上验证后再评估移除兼容 saga |
| 6 | IndexedDB 会话持久化 | 暂缓 | 后续再处理聊天会话 Repository、迁移和附件 |

已核实的关键文件：

- [Go 图片 Handler](../backend/go-gateway/internal/handler/image.go)
- [Go 图片编排](../backend/go-gateway/internal/orchestrator/image_generate.go)
- [Go 幂等 Repository](../backend/go-gateway/internal/repository/idempotency.go)
- [Node Go Sidecar 代理](../backend/gateway/src/routes/go-sidecar.ts)
- [聊天 Store](../src/stores/chat.ts)
- [幂等键数据库迁移](../supabase/migrations/20260613160000_add_idempotency_keys.sql)
- [额度数据库迁移](../supabase/migrations/202606070001_add_user_credits.sql)

## 1. 图片幂等与积分一致性

### 目标

保证同一次用户操作在重试、超时、取消、进程重启和部分失败时：

- 不重复调用图片 Provider。
- 不重复扣费。
- 不重复退款。
- 成功结果可以重放。
- 未完成任务可以恢复或进入可见的补偿流程。
- 数据库记录和对象存储不会长期失配。

### 已有基础

当前实现已经具备以下能力：

- 登录用户的额度生图必须携带 `Idempotency-Key`。
- `idempotency_keys` 使用 `(user_id, idem_key, scope)` 唯一约束。
- 已完成记录会比较请求指纹：相同请求可以重放，不同请求返回冲突。仍在处理中的记录会返回冲突；过期、超时或失败记录目前会被新请求重领，并覆盖旧指纹，因此尚未保证“同一 Key 永远只能对应同一请求体”。
- `reserve_user_credits` 使用数据库原子更新预扣额度。
- `refund_user_credits` 使用原始生图交易的事务级 advisory lock，累计退款检查与流水插入已形成并发原子上限。
- 图片编排在 Provider 失败、部分返回和异步持久化失败时尝试退款。
- 对象上传和历史保存已通过 Saga 反向补偿。

### 主要缺口

当前一致性仍依赖进程内执行窗口：

- `idempotency_keys` 获取仍是单独的前置声明，但对额度生图的 processing claim、额度预扣、初始 staging job 和 transaction 绑定已由 `start_image_generation_job` 在同一个数据库事务中完成。
- 异步持久化运行在 goroutine 中，Render 重启或进程退出时任务会丢失。
- 退款失败主要记录日志，没有持久化的 `refund_pending` 状态供 Worker 重试。
- `processing` 幂等记录可以被超时重领，但无法单独证明旧 Provider 调用是否已经成功。
- 成功响应在异步持久化完成前已经返回，客户端看到结果不代表永久存储已经完成。
- 目前缺少定期对账，无法自动清理长期处理中的任务和孤立对象。

### 目标状态模型

不要把分析指标表直接当作业务任务表。实施前应先决定：扩展现有 `image_generation_attempts`，还是新增专门的 `image_generation_jobs`。如果指标表需要保留追加写语义，应新增任务表。

推荐最小状态：

```text
reserved -> provider_processing -> persistence_pending -> completed
    |               |                     |
    +---------------+---------------------+-> failed
                                             |
                                             +-> refund_pending -> refunded
```

每个任务至少保存：

```text
generation_id
user_id
idempotency_key
request_hash
status
credit_transaction_id
reserved_amount
provider_request_id
result_manifest
last_error_code
retry_count
locked_until
created_at
updated_at
```

`result_manifest` 只保存恢复任务需要的结果引用和对象路径，不保存密钥或大型图片数据。

### 实施步骤

1. [x] 建立持久化图片任务状态。
   - 在调用 Provider 前写入任务记录。
   - 每次状态转换使用带旧状态条件的更新。
   - 为 Worker 增加 `locked_until` 和重试计数。

2. [x] 收紧额度与任务的数据库事务边界。
   - `start_image_generation_job` 将 processing claim、预扣额度、写入 staging job 和幂等 transaction ID 绑定放入同一个 RPC 事务。
   - 不允许先查询余额再扣减。
   - 完成和退款都使用幂等状态转换。

3. 将异步持久化改为可恢复任务。
   - 返回临时图片 URL 前，先持久化任务和 Provider 结果引用。
   - goroutine 可以作为低延迟执行器，但不能是任务的唯一事实来源。
   - Worker 重新领取 `persistence_pending` 任务时必须可安全重放。

4. 增加退款待处理状态。
   - 退款失败时写入 `refund_pending`，保留原额度交易 ID、金额和原因。
   - Worker 重试退款，成功后标记 `refunded`。
   - 管理后台展示长期未完成和退款待处理任务。

5. [x] 增加对账与孤立对象清理。
   - 扫描长时间停留在处理中状态的任务。
   - 对比任务记录、图片历史和对象路径。
   - 清理没有有效任务或历史引用的孤立对象。
   - 对账操作本身必须幂等，并保留审计日志。

### 验收标准

- 10 个相同幂等键并发请求只调用一次 Provider、只扣一次额度。
- 相同 Key 和不同请求体返回 `409`，不会复用旧结果。
- 在额度预扣、Provider 调用、持久化、历史写入和幂等完成阶段分别注入失败，余额和状态均可恢复。
- 进程在预扣后退出，Worker 能退款或继续任务，不留下永久 `processing`。
- 同一笔失败任务重复执行退款，累计退款不超过原扣费。
- 已完成请求重试时直接返回缓存结果，不重新生成。
- 对账可以发现并处理长期任务、退款待处理和孤立对象。

## 3. Node/Go 全链路可观测性

### 目标

拿到任意失败请求的 `request_id` 后，可以还原请求经过 Node、Go、Provider、数据库和对象存储的完整过程，同时不泄露密钥、Token 或图片数据。

### 已有基础

- Node 与 Go 使用同一合法字符规则接收请求 ID；缺失或非法 ID 会生成 UUID v4，并通过请求头和响应头暴露。
- Node Sidecar 将同一个请求 ID 传给 Go，且不会让上游响应覆盖 Node 已确定的关联 ID。
- Node 与 Go 都会输出一行 JSON 请求完成日志，基础字段统一为 snake_case，并只包含固定安全字段。
- Node Gateway 错误和 Go 通用 HTTP 错误已增加稳定 `code`，同时保留原有 `error` 字段。
- Go CORS 已允许并暴露 `X-Request-ID`；Sidecar 已覆盖正常 POST、超时、不可用和真实客户端断开取消。
- 图片尝试记录包含 `request_id`、Provider、HTTP 状态和耗时字段。
- 图片生成记录已经包含 Provider、模型、延迟和图片大小等指标字段。

### 主要缺口

- 图片任务的 `generation_id`、幂等键和额度交易 ID 没有稳定地出现在每个阶段日志中。
- 当前错误码以 Gateway 和通用 HTTP 分类为主，图片 Provider、存储、历史与退款仍缺少领域级错误码表。
- 图片 Provider 启动、成功、失败和持久化排队已输出安全 JSON 生命周期日志；旧兼容 saga 的少量自由文本日志仍保留。
- 对账任务会把长期任务和孤立对象写入审计表；部署平台上的仪表盘和告警规则仍需结合实际日志平台配置。

### 统一字段

所有 Node/Go 请求日志使用同一组基础字段：

```text
timestamp
level
service
request_id
user_id
route
method
status_code
duration_ms
generation_id
idempotency_key_hash
credit_transaction_id
provider
provider_status
error_code
```

安全规则：

- 不记录 `Authorization`、API Key、Cookie、完整请求体和图片 Base64。
- 幂等键只记录哈希或短前缀。
- Prompt 默认记录长度、模型和可选哈希，不默认记录全文。
- 用户 ID 可以记录内部 UUID，但不能混入公开错误响应。

### 实施步骤

1. [x] Node 接受合法 `X-Request-ID`，否则生成 UUID。
2. [x] Node 将请求 ID 写入请求上下文、响应头和所有 Go 代理请求。
3. [x] Go 优先沿用 Node 的请求 ID；只有直接访问 Go 且缺失时才生成。
4. [x] Node 和 Go 已封装统一 snake_case 请求完成日志；图片业务阶段日志仍需逐步替换。
5. [x] 已建立 Gateway、通用 HTTP 与生图主链路稳定错误码：

```text
IDEMPOTENCY_CONFLICT
INSUFFICIENT_CREDITS
CREDIT_SERVICE_UNAVAILABLE
PROVIDER_TIMEOUT
PROVIDER_BAD_RESPONSE
STORAGE_UPLOAD_FAILED
HISTORY_SAVE_FAILED
REFUND_PENDING
GO_SIDECAR_UNAVAILABLE
```

6. [~] 已通过生命周期 JSON 日志和对账审计表建立可聚合数据源；部署平台告警规则待上线配置：
   - Node -> Go 代理错误率和超时率。
   - Provider 成功率、首响应耗时和总耗时。
   - 持久化、预览图和缩略图处理耗时。
   - `refund_pending` 数量和最长等待时间。
   - 长时间未完成任务数量。
   - Chat 首 Token 时间和流中断原因。

第一阶段不要求立刻引入完整 OpenTelemetry。统一请求 ID、结构化日志和稳定错误码完成后，再评估 tracing 平台。

### 第一阶段实施结果（2026-07-12）

已完成：

- Node 与 Go 请求 ID 校验、生成、响应头回写和 Sidecar 透传。
- Node 与 Go 安全 JSON 请求完成日志，统一使用 `request_id`、`status_code`、`duration_ms` 等 snake_case 字段。
- Node Gateway 的超时、请求体和 Sidecar 错误码；Go 通用 HTTP 状态错误码。
- Sidecar 正常 POST、不可用、超时、上游响应头覆盖和真实客户端断开取消测试。
- 兑换额度的幂等错误重放复用带 `code` 的同一错误体。

当前收尾状态：

- Provider 启动/成功/失败和持久化排队日志已包含 `request_id`、`generation_id`、额度交易 ID、Provider host 和领域错误码，不记录 prompt、密钥或图片数据。
- 对外生图主链路已返回稳定领域错误码；Worker 的持久化、历史和退款错误继续写入任务 `last_error_code`。
- Provider 原生 request ID 和幂等键哈希仍取决于上游响应支持；部署平台仪表盘、告警和可选 tracing 需要在上线环境配置。

### 验收标准

- 同一个请求在 Node 与 Go 日志中使用相同 `request_id`。
- 失败请求可以关联到图片任务、额度交易和 Provider 调用。
- 日志中不出现 API Key、Authorization、Cookie 或 Base64 图片。
- 主要错误可以按稳定 `error_code` 聚合。
- 自动化测试覆盖请求 ID 生成、透传、响应头和错误路径。

## 4. 双网关契约测试

### 目标

保证 Node Gateway 与 Go Gateway 对 Go 所有路由的请求、响应、错误和取消语义保持一致，避免单侧修改造成线上兼容性回归。

### 已有基础

- `contracts/go-owned-api.json` 已成为 Node 实际代理路由的单一测试契约来源。
- Node 契约测试逐条验证 11 个 method/path、query、认证/幂等/引用 Header 和 JSON/二进制请求体。
- Go 契约测试读取同一 JSON，通过 chi route walking 和真实 Handler 场景验证路由、状态、请求 ID 与错误码。
- 真实集成测试会构建并启动 Go 二进制，再通过生产 Node Sidecar 跑公共配置和未认证额度错误场景。
- GitHub Actions 已增加聚焦契约工作流；Sidecar 客户端断开取消仍由独立真实 HTTP 测试覆盖。

### 主要缺口

- 当前契约只要求成功状态、通用错误结构、关键 Header 和凭据无关的响应字段，尚未描述所有嵌套图片对象。
- Provider、Supabase 和对象存储参与的成功/部分失败路径仍由各层测试覆盖，没有进入真实双进程场景。
- multipart 边界、超大上传和长流响应仍主要由专门 Sidecar/Handler 测试覆盖，未重复放入共享 JSON。

### 契约范围

第一阶段只覆盖 Node 公开入口实际代理的 Go-owned API 路由：

```text
/api/image/*
/api/credits*
/api/config/* 中由 Go 管理的部分
```

Go 自身的 `/health`、`/ready` 和条件启用的诊断路由不属于第一阶段代理契约；如果未来通过 Node 或公网暴露，再加入契约范围。

契约至少描述：

- 路由、HTTP 方法、查询参数。
- JSON 与 multipart 请求体。
- `Authorization`、`X-Request-ID`、`Idempotency-Key` 等 Header。
- 请求体和上传大小限制。
- 成功响应字段、可空字段和内容类型。
- `400/401/402/403/409/413/415/422/429/502/503/504` 的语义。
- Go 不可用、上游超时和客户端断开时的行为。

### 测试分层

1. Go Handler 契约测试。
   - 使用契约样例调用真实 Handler。
   - 校验状态码、响应结构、Header 和错误码。

2. Node 代理契约测试。
   - 使用可控的模拟 Go Server。
   - 校验路径、查询参数、Header、Body、流式传输、取消和错误映射。

3. 最小双进程集成测试。
   - 真实启动 Node 与 Go。
   - 模拟图片 Provider、Supabase 和对象存储。
   - 通过 Node 公开入口运行关键正常路径和失败路径。

契约文件可以从一个小型 OpenAPI 文档开始。不要一次描述 Chat、MCP、Skill 和 Admin。

### 第一阶段实施结果（2026-07-12）

已完成：

- 共享 JSON 契约覆盖 Node 公开代理的 11 个 Go method/path 组合。
- Node 和 Go 测试共同读取同一契约，不再维护两份路由 fixture。
- Node 代理契约覆盖 query、`Authorization`、`X-Request-ID`、`Idempotency-Key`、引用 Header 和请求体类型。
- Go Handler 契约覆盖 chi 路由注册、公共配置响应和 `401 UNAUTHORIZED` 错误结构。
- 真实 Node -> Go 进程测试不读取仓库 `.env`，也不连接 Supabase、存储或 Provider。
- `.github/workflows/contracts.yml` 在相关 PR 和 `master` 变更时运行契约测试、Gateway typecheck 和 Go build。

当前收尾状态：

- 真实 Node -> Go 进程测试已覆盖生图路由、请求 ID 和 `STORAGE_UNAVAILABLE` 领域错误；Provider 成功、部分返回、持久化失败和退款待处理由 Go 层真实 HTTP Provider + 故障注入测试覆盖。
- 图片结果、历史和额度响应的完整嵌套 Schema 可在公开响应发生兼容性变化时继续扩充。

### 验收标准

- Go Handler 和 Node 代理共同验证同一份契约样例。
- `Idempotency-Key`、`X-Request-ID` 和认证 Header 不丢失。
- Go 返回的错误状态和错误码经过 Node 后保持预期语义。
- Node 超时和客户端取消会终止上游请求，但不会中断已脱离请求上下文的补偿任务。
- Go 不可用时 Node 返回稳定的 `502/504` 错误结构。
- 契约不兼容变更会在 CI 中失败。

## 5. 图片任务编排下沉与加固

### 目标

保持 HTTP Handler 简单，将图片生成、额度、Provider、存储、历史、幂等和补偿集中到可测试、可恢复的业务用例层。

### 当前状态

该项主体已经完成：

```text
HTTP Handler
  -> ImageOrchestrator
      -> CreditService
      -> IdempotencyService
      -> ProviderSettingsService
      -> StorageService
      -> ImageJobRepository (staging/lease/manifest)
          -> ImageJobWorker
              -> StorageService / CreditService / IdempotencyService
```

[image.go](../backend/go-gateway/internal/handler/image.go) 主要负责请求读取、校验、身份上下文和 HTTP 响应；[image_generate.go](../backend/go-gateway/internal/orchestrator/image_generate.go) 负责幂等、额度、Provider 调用和 durable staging；`image_job_processor.go`/`image_job_worker.go` 负责可恢复持久化、退款和补偿。兼容 saga 仅作为显式 rollout fallback。

### 剩余加固

1. [x] 将异步持久化从“只有 goroutine”升级为“持久化任务 + Worker”。
2. [x] 让编排层写入明确的任务状态和阶段结果。
3. [x] Provider 调用继续通过显式接口，并由任务阶段统一超时、重试和错误分类。
4. [x] 存储操作返回可补偿的对象清单，manifest 保留确定路径和校验信息。
5. [x] 将额度与任务状态的数据库操作收敛到清晰事务边界（归入第 1 项）。
6. [x] 保持接口定义在使用方附近，不引入通用 `BaseRepository` 或过度领域框架。

### 实施方式

后续改动继续以行为加固为主：

- 保持 Handler 的请求/响应行为不变。
- 将额度事务、并发退款上限和对账入口接入现有 Job 状态机。
- 在迁移和观测确认后移除兼容 saga，而不是再次进行大规模搬迁。

### 图片一致性与 Durable Job 实施结果（2026-07-12）

已完成并接入 Go Gateway：

- `image_generation_jobs` 作为持久化任务事实来源，状态包含 `staging`、`persistence_pending`、`persistence_processing`、`refund_pending`、`completed`、`failed` 和 `refunded`。
- 请求路径先创建带租约的 staging job，再逐张上传原始对象并保存版本化 manifest，全部成功后才激活任务。
- manifest 只保存对象路径、SHA-256、大小和生成元数据，不保存 Provider URL、Base64 或密钥。
- `ImageJobProcessor` 按 `staged -> stored -> history_saved` 阶段恢复；每个阶段使用 owner + `lease_token` + 未过期 `locked_until` fencing。
- `ImageJobWorker` 使用 `FOR UPDATE SKIP LOCKED`、heartbeat、持久化退避重试和 `refund_pending` 退款重试；丢失租约或取消时不再执行终态写入、退款或清理。
- 补偿状态转换同时保存最新 manifest，终态后清理 staging 与已知永久对象；历史写入使用现有 upsert 语义。
- 新增退款 RPC 原子化 migration：按原始生图交易使用事务级 advisory lock，串行累计退款计算与退款流水插入，避免并发 Worker 超额退款。
- 新增 `start_image_generation_job` RPC：在 Provider 调用前原子完成幂等 claim、额度预扣和 staging job 创建；未知网络结果重试时复用原任务，不重复扣费。
- 已登录额度生图复用预先创建的 staging job；Provider 失败进入 durable `refund_pending`，不再依赖请求进程直接退款；部分返回的退款金额和 returned count 会在 staging 租约内记录。
- Go `main` 默认启动 Worker，可通过 `IMAGE_JOB_WORKER_ENABLED=false` 在迁移 rollout 期间保留兼容 saga 路径，并在 graceful shutdown 时等待 Worker 退出。
- 关键故障注入测试覆盖 manifest 恢复、校验和、重试、退款失败、租约丢失、慢退款和正常 heartbeat 停止。

可靠性收尾状态：

- 新增周期性对账入口和 service-role-only 审计表，只删除超过宽限期、位于受管生图前缀且没有任务/历史引用的对象。
- 对账默认关闭；部署 migration 后通过 `IMAGE_RECONCILIATION_ENABLED=true` 启用，支持周期、任务陈旧阈值和孤立对象宽限期配置。
- 兼容 saga 继续在显式关闭 Worker 或数据库不可用时保留，待生产观察确认后再决定是否移除。

### 验收标准

- Handler 测试不需要真实 Provider、数据库或对象存储。
- Orchestrator 可以独立测试所有主要状态转换和补偿路径。
- 进程重启后，未完成的持久化任务可以重新领取。
- 相同任务重复执行不会生成重复历史或重复对象。
- 代码移动与一致性规则变化位于不同 PR，便于定位回归。

## 6. IndexedDB 会话持久化

> 当前暂缓：本阶段只验收生图链路，不推进聊天会话持久化。

### 目标

将会话持久化从同步、整库写入的 `localStorage` 升级为异步、分记录、可迁移的 IndexedDB，同时保证旧用户会话无损升级。

### 当前状态

[src/stores/chat.ts](../src/stores/chat.ts) 当前行为：

- 会话、分组和当前会话 ID 分别保存在 `localStorage`。
- 对 `conversations` 使用深度 Watch。
- 流式输出期间使用 500 ms debounce 合并写入。
- 写入时剥离消息图片，避免大型 Base64 阻塞和配额问题。
- `beforeunload` 与 `pagehide` 会刷新挂起写入。

这些优化降低了当前卡顿，但仍存在同步序列化、整库重写、容量限制和缺少正式迁移版本的问题。

### 推荐数据结构

建议使用轻量 `idb` 封装浏览器 IndexedDB：

| Object Store | 内容 | 主键或索引 |
|---|---|---|
| `conversations` | 标题、分组、模型、系统提示词、创建和更新时间 | `id`、`updatedAt` |
| `messages` | 用户和助手消息 | `[conversationId, id]`、`[conversationId, timestamp]` |
| `attachments` | 本地图片 Blob 与元数据 | `id`、`conversationId` |
| `groups` | 会话分组 | `id` |
| `meta` | 当前会话、数据库版本、迁移状态 | `key` |

Vue Store 不直接调用 IndexedDB。新增 Repository 边界：

```ts
interface ChatRepository {
  listConversations(): Promise<ConversationSummary[]>
  loadMessages(conversationId: string): Promise<Message[]>
  saveConversation(conversation: ConversationSummary): Promise<void>
  saveMessage(conversationId: string, message: Message): Promise<void>
  deleteConversation(conversationId: string): Promise<void>
  saveAttachment(attachment: ChatAttachment): Promise<void>
}
```

### 初始化与懒加载

应用启动时：

1. 打开 IndexedDB。
2. 只加载分组、会话摘要和当前会话 ID。
3. 只加载当前会话的消息。
4. 切换会话时再加载对应消息。
5. 完成后设置 `isHydrated = true`。

Store 应复用唯一初始化 Promise，防止并发初始化：

```ts
let hydrationPromise: Promise<void> | undefined

export function ensureChatHydrated() {
  hydrationPromise ??= hydrateChatState()
  return hydrationPromise
}
```

初始化完成前禁止把默认空状态写回数据库。

### 流式消息写入

不要继续对整个会话数组做深度持久化：

- 用户消息提交后立即保存。
- 助手占位消息立即保存。
- SSE Delta 继续实时更新内存状态。
- 每 500-1000 ms 节流更新当前助手消息。
- 流结束、取消或报错时立即最终保存。
- 标题、分组和系统提示词只更新会话摘要。

这里应使用节流而不是纯防抖。长时间持续输出时，纯防抖可能一直不落盘。

### 图片与附件

- 远程永久 URL 直接保存在消息或附件元数据中。
- 本地图片以 Blob 保存到 `attachments`。
- 消息只保存 `attachmentIds`。
- 展示时通过 `URL.createObjectURL()` 创建临时地址。
- 组件卸载或图片切换时调用 `URL.revokeObjectURL()`。
- 不持久化 `blob:` URL，因为刷新后会失效。

### 从 localStorage 无损迁移

1. 检查 `meta` 中的迁移版本。
2. 读取并校验 `recho-conversations`、`recho-groups` 和 `recho-active-conversation`。
3. 在单个 IndexedDB 事务中写入会话、消息、分组和迁移标记。
4. 等待事务提交。
5. 从 IndexedDB 回读并核对数量及当前会话。
6. 确认成功后才删除旧 `localStorage` 数据。

迁移失败时必须保留旧数据，并允许应用继续从 `localStorage` 恢复。至少保留一个版本的兼容回退。

### 多标签页策略

第一版可以采用“最后写入获胜”，但必须显式实现：

- 使用 `BroadcastChannel` 通知会话摘要变更。
- 每条记录保存 `updatedAt` 或递增版本。
- 发现远端版本更新时重新加载，不静默覆盖较新记录。
- 后续如需要协同编辑，再引入更复杂冲突合并。

### 验收标准

- 旧用户首次升级不会丢失会话、分组和当前会话选择。
- 迁移中途刷新或异常退出不会删除旧数据。
- 单条损坏消息不会阻止其他会话加载。
- 大会话启动时只加载摘要和当前会话消息。
- 流式输出高频更新会被合并为有限次数的单消息写入。
- IndexedDB 配额不足时显示可恢复错误，不静默丢数据。
- 删除会话会同时删除消息和附件。
- 多标签页修改遵循明确的版本或最后写入策略。

## 推荐实施顺序

### PR 1：请求 ID、结构化日志和错误码

- Node 入口生成和回写 `X-Request-ID`。
- Node -> Go 全链路透传。
- 统一图片链路日志字段和错误码。
- 补请求 ID 与脱敏测试。

### PR 2：双网关契约与 CI

- 建立 Go-owned 路由的最小 OpenAPI 或等价契约。
- Go Handler 与 Node 代理共同消费契约样例。
- 增加真实 Node + Go 最小集成测试。

### PR 3：图片任务持久化

- 建立业务任务表和状态转换。
- 将 Provider 结果与持久化阶段写入任务记录。
- 引入可恢复 Worker，保留现有 Handler 响应。

### PR 4：幂等与额度事务加固

- 收紧任务创建、幂等获取、额度预扣和账务流水的事务边界。
- 增加完成、失败、退款待处理和幂等退款状态转换。
- 补并发和故障注入测试。

### PR 5：对账与孤立对象清理

- 处理超时任务和 `refund_pending`。
- 对比任务、历史和对象存储清单。
- 增加管理后台可见性和人工重试入口。

### PR 6：Chat Repository 与 IndexedDB

- 增加 `idb`、数据库 Schema 和 Repository。
- Store 改为异步 Hydration 和按会话加载。
- 流式更新改为单消息节流写入。

### PR 7：localStorage 迁移与附件

- 实现可恢复的旧数据迁移。
- 将本地图片改为 Blob 附件。
- 增加配额、损坏记录、多标签页和迁移中断测试。

`PR 1-5` 是连续的后端可靠性改造。`PR 6-7` 可以在接口边界确认后并行推进。

## 实施前核实清单

每个 PR 开始前重新核实以下事实，避免文档老化：

- `idempotency_keys` 的状态、过期和重领规则是否已变更。
- `image_generation_attempts` 是指标表还是业务任务表，是否允许原地扩展。
- 额度 RPC 的函数签名仍为 `reserve_user_credits` 和 `refund_user_credits`。
- Node Sidecar 的超时、流式响应和客户端断开处理是否保持现状。
- Go Orchestrator 是否仍在 goroutine 中执行永久化。
- `src/stores/chat.ts` 是否仍以 `localStorage` 为事实来源。
- 消息图片字段是否仍可能包含 Base64 或仅使用远程 URL。

## 最终成功标准

这轮优化完成后，应同时满足：

1. 重复请求不会重复生成、扣费或退款。
2. 进程崩溃后，未完成任务能够恢复、重试或对账。
3. 任意请求都能通过一个 `request_id` 跨 Node 和 Go 追踪。
4. Node 与 Go 的接口不兼容变化会在 CI 中被契约测试拦截。
5. 图片 Handler 保持轻量，业务编排和补偿可独立测试。
6. 旧会话可以无损迁移，大会话不再依赖同步整库写入。
