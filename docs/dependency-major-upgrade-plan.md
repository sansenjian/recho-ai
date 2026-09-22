# Major 版本依赖升级规划

> 状态：**已执行完毕（2026-09-22）**。339 个测试、前端构建、网关 typecheck/build 全部通过。
>
> 执行记录：
> - ✅ G2 dotenv 16→18（后补 18.0.3）、G3 sharp 0.34→0.35、F1 concurrently 9→10
> - ✅ F4 vitest+coverage 4→5、F2 markdown-it 14→15（移除 @types/markdown-it，自带类型）、F5 @vueuse/core 14→15
> - ✅ G1 undici 7→8（修复 Node 内置 fetch 与 undici8 dispatcher 不兼容：改用 undici 自带 fetch；测试改 mock undici 模块）
> - ✅ G4 express 4→5、G5 openai 4→7（放宽 filterToolsForSkill 泛型以兼容 tool union 类型）、G6 网关 typescript 6→7（编译产物验证通过）
> - ❌ F3 前端 typescript 6→7（**回滚**）：TypeScript 7 为原生 Go（tsgo）重写，vue-tsc 依赖 JS 版 tsc 内部结构（require `typescript/lib/tsc` + fs 劫持注入），无法兼容，vue-tsc 现无支持版本。前端 TS 保持 6.0.3。
> - 🔶 G3 额外修复：测试 fixture 1x1 PNG 数据损坏（IDAT zlib 无效），sharp 0.35 的 libpng 严格校验拒绝读取，已替换为合法 PNG。
>
> 剩余未升级项（建议暂缓）：~~`@types/node` 26.x~~ ✅ **已于 2026-09-23 升级**（根目录 24→26.6.2、网关 25→26.6.2，typecheck/build/339 测试全绿——@types/node 仅编译期类型，与 Node 24 运行时解耦）、前端 typescript（等 vue-tsc 支持 tsgo）。

## 背景

- 本机 Node：v24.13.0（package.json `engines: >=24`）
- 升级原则：只升级 `Latest` 列（major 跨版本）中确有收益且可控的项；工具链类（typescript / @types/node）默认**暂缓**，避免与当前 Node 24 运行时及项目约束脱节。
- `@types/node` 26.x 对应 Node 26 的类型声明，但 @types/* 只影响编译期，与 Node 24 运行时解耦，已实测兼容（2026-09-23 升级根目录与网关到 26.6.2）。

---

## 一、前端（根目录 package.json）

| # | 包 | 当前 | 目标 | 风险 | 影响面 |
|---|---|---|---|---|---|
| F1 | concurrently | 9.2.4 | 10.0.5 | 低 | 仅本地 dev 脚本编排 |
| F2 | markdown-it | 14.3.2 | 15.0.2 | 中 | ChatMessage 渲染、`@types/markdown-it` 需配套 |
| F3 | typescript | 6.0.3 | 7.0.2 | 高 | 全项目类型检查、vue-tsc 兼容性 |
| F4 | vitest + @vitest/coverage-v8 | 4.1.11 | 5.0.1 | 中 | 全部 339 个测试 |
| F5 | @vueuse/core | 14.4.0 | 15.0.0 | 中 | 全局 composable 使用 |
| F6 | @types/node | 24.13.6 | 26.6.2 | 高 | ✅ 已于 2026-09-23 升级（见 6.1） |

### F1. concurrently 9 → 10

```bash
npm install -D concurrently@^10.0.5
npm test && npm run build
```

- 验证：dev 脚本（`dev:node` / `dev:go`）并发启动正常。

### F2. markdown-it 14 → 15

```bash
npm install markdown-it@^15.0.2
npm test && npm run build
```

- 关注：`markdown-it` 15 为 ESM 化版本，检查默认渲染插件（highlight.js 集成、链接/表格等）行为是否变化。
- 验证：`tests/markdown.test.ts` + 人工检查 chat 消息渲染。

### F3. typescript 6 → 7

```bash
npm install -D typescript@^7.0.2
npm run build
```

- 关注：TS 7 的 breaking change（可能的废弃选项、默认行为变更）；`vue-tsc` 是否已支持 TS 7（先查 `vue-tsc@latest` 兼容性，必要时先升 vue-tsc）。
- 验证：`vue-tsc -b` 全量类型检查通过。
- ⚠️ 网关的 TS 也需同步评估（见 G6），两侧一起升或分开升均可，建议分开升便于定位问题。

### F4. vitest 4 → 5（含 coverage）

```bash
npm install -D vitest@^5.0.1 @vitest/coverage-v8@^5.0.1
npm test
```

- 关注：runner API / 配置项变更；jsdom / @vue/test-utils 兼容。
- 验证：57 个测试文件全部通过。

### F5. @vueuse/core 14 → 15

```bash
npm install @vueuse/core@^15.0.0
npm test && npm run build
```

- 关注：`useLocalStorage`、`useDebounceFn` 等被使用 API 的签名变化（先用 `npm run build` 的 vue-tsc 暴露引用点）。
- 验证：构建 + 相关 composable 测试（`use-stream`、`use-image-download` 等）。

### F6. @types/node 24 → 26（原计划，已执行见 6.1）

- 依赖升级 Node 运行时到 26 后执行；升级时网关侧 G7 需同步。

---

## 二、后端网关（backend/gateway/package.json）

| # | 包 | 当前 | 目标 | 风险 | 影响面 |
|---|---|---|---|---|---|
| G1 | undici | 7.29.1 | 8.11.0 | 中 | fetch/请求分派（go-sidecar 代理、chat）、Node 内置 fetch 冲突需注意 |
| G2 | dotenv | 16.6.1 | 18.0.2 | 低 | 环境变量加载 |
| G3 | sharp | 0.34.5 | 0.35.4 | 中 | Go 网关图片处理（Node 侧仅历史兼容代码） |
| G4 | express | 4.22.3 | 5.2.1 | 高 | 全部 /api 路由、中间件、错误处理 |
| G5 | openai | 4.104.0 | 7.21.0 | 高 | chat-loop 流式调用、工具调用、兼容层 |
| G6 | typescript | 6.0.3 | 7.0.2 | 高 | 网关类型检查 |
| G7 | @types/node | 25.9.8 | 26.6.2 | 高 | ✅ 已于 2026-09-23 升级（见 6.1） |

### G1. undici 7 → 8

```bash
npm install undici@^8.11.0
npm run typecheck && cd ../.. && npm test
```

- 关注：`Agent`/`fetch` API 变更；`backend/gateway/src/routes/go-sidecar.ts` 的专用 fetch dispatcher（`tests/go-sidecar-proxy.test.ts` 覆盖超时/中止场景）。
- 验证：网关 proxy 相关测试全通过。

### G2. dotenv 16 → 18

```bash
npm install dotenv@^18.0.2
npm run typecheck && npm test
```

- 关注：`config()` 返回值语义变化；启动日志验证 env 正常加载。
- 验证：`dev:backend` 能正常读 .env 启动。

### G3. sharp 0.34 → 0.35

```bash
npm install sharp@^0.35.4
npm run typecheck && npm test
```

- 关注：libvips 版本升级是否影响缩略图输出（Node 侧兼容代码）；Go 网关实际图片处理路径不受影响。
- 验证：`tests/image-storage-cos.test.ts`、`tests/tencent-cos-config.test.ts` 通过。

### G4. express 4 → 5

```bash
npm install express@^5.2.1 @types/express@^5
npm run typecheck && npm test
```

- 关注（Express 5 已知 breaking）：
  - 删除的 API：`res.send(status)`、`app.del`、通配符路由 `*` → `/*splat` 等
  - `body-parser` 内建；路由参数必需性变化
  - 中间件错误处理/异步错误自动捕获行为变化
- 验证：`tests/gateway-request-observability.test.ts`（body 解析/错误分类）、`tests/gateway-chat-*.test.ts`、全部 `/api` 路由冒烟测试（可用 `npm run dev:backend` + curl）。
- ⚠️ `@types/express` 已依赖 v5 类型，需同步。

### G5. openai 4 → 7

```bash
npm install openai@^7.21.0
npm run typecheck && npm test
```

- 关注（v5→v7 变化大）：
  - `client.chat.completions.create` 流式/工具调用参数与返回结构
  - `ChatCompletionMessageParam` 等类型命名/shape 变化（`backend/gateway/src/services/chat-loop.ts`、`mcp/manager.ts` 适配层受影响最大）
  - 流式事件类型（`stream.toReadableStream()`、SSE 解析）变化
- 验证：`tests/gateway-chat-loop.test.ts`、`tests/gateway-chat-utils.test.ts`、MCP 工具调用路径；另需一次真实模型联调（可选）。
- ⚠️ 属最大改造项，建议单独一个 PR 承载。

### G6. typescript 6 → 7（网关）

```bash
npm install -D typescript@^7.0.2
npm run typecheck
```

- 验证：`tsc --noEmit` 通过。可与 F3 分开进行。

### G7. @types/node 25 → 26（原计划，已执行见 6.1）

- 同 F6，随 Node 运行时升级一起做。

---

## 三、执行顺序与验收

建议顺序（低风险 → 高风险）：

```text
G2 → G3 → F1 → F4 → F2 → F5 → G1 → G4 → G6 → G3(TS) → G5(openai)
```

每项验收标准（全绿才进下一项）：

1. 网关：`cd backend/gateway && npm run typecheck` 通过
2. 前端：`npm run build`（含 vue-tsc）通过
3. 测试：`npm test` 全部通过（57 文件 / 339 测试）
4. 涉及路由/请求的包额外执行一次 `npm run dev` 冒烟（可选）

## 四、回滚预案

- 单个包升级失败：`npm install <pkg>@<原版本>` 还原 package.json + lockfile（`git checkout -- package.json package-lock.json` 亦可），记录失败原因后跳过或另立任务。
- 所有升级操作**独立提交、独立 PR**，便于 review 与回滚。

## 五、已知需保留到后续（不随本规划执行）

- `npm audit` 报出的 moderate/high：多为 major 升级后自动消除（如 express 5、openai 7、undici 8），随上表升级复查即可；不单独执行 `npm audit fix --force`（会触发未规划的大范围破坏性变更）。

## 六、补充研究（2026-09-23，分支 feat/research-remaining-deps）

### 6.4 ✅ 运行时 Node 升级到 26（2026-09-23，分支 chore/node26）

- 本机运行时：24.13.0 → **26.9.0**（与 @types/node 26 对齐，消除 nopt@10 等生态的 EBADENGINE）
- 同步更新：`.nvmrc` 24→26、根目录 `engines.node` >=24→>=26、CI（ci.yml/contracts.yml）node-version 24→26、Dockerfile 三处 node:24-alpine→node:26-alpine
- 验证：node-version-consistency 测试（钉住 .nvmrc/CI/engines/Dockerfile 四处一致）通过；339 测试 + 前端 build + 网关 typecheck/build 全绿

### 6.1 ✅ @types/node 26 已升级

- 根目录 24.13.6 → 26.6.2，网关 25.9.8 → 26.6.2
- 验证：前端 build（vue-tsc + vite）、网关 typecheck/build、339 测试全绿
- 结论：`@types/*` 仅编译期类型，与 Node 24 运行时解耦，跨版本升级安全。升级后两端 `npm outdated` 无输出。**（运行时随后已升到 Node 26，见 6.4）**

### 6.2 ⏳ 前端 typescript 7 仍待 vue-tsc 支持

- 网关 TS 已 7.0.2 ✅；前端受 vue-tsc 3.3.11（最新）无法解析 TS7（tsgo 重写破坏其 `typescript/lib/tsc` 注入机制）阻塞，保持 6.0.3。
- 后续动作：关注 vue-tsc 发布支持 tsgo 的版本后单独升级。

### 6.3 🔶 npm audit 漏洞剩余项

**网关（已清零 ✅）**：`npm audit fix` 修复 hono 4.12.24→4.13.8、ip-address 10.2.0→10.7.2（@modelcontextprotocol/sdk 传递依赖），0 vulnerabilities。

**根目录（✅ 已清零，2026-09-23）**：
- 漏洞链原来源：shadcn-vue CLI 工具链（devDependency）的 `stylus 0.55-0.58 → css → source-map-resolve → decode-uri-component`（ReDoS）
- 修复方式：package.json 增加 `overrides`（`decode-uri-component: 0.5.0`、`stylus: 0.64.0`），stylus 0.64 已移除 css/source-map-resolve 依赖链，漏洞包直接从依赖树消失
- 验证：两端 `npm audit` 均 **0 vulnerabilities**，339 测试 + 前端 build 全绿