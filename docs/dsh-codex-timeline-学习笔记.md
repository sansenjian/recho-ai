# dsh-codex-timeline 学习笔记

> 研究对象：[Wine-Red/dsh-codex-timeline](https://github.com/Wine-Red/dsh-codex-timeline)（MIT，`package.json` 版本 `0.6.3`）
> 研究快照：`git clone --depth 1`，HEAD `0d28fde4aa5aae73b5ae8add393f9c4a8ba07e95`（2026-09-25，*fix: use host core packages and support DSH rc.2*）
> 本机环境：`dsh 0.1.7-rc.2`（正好落在该插件声明支持的两个版本内；本机尚未安装该插件）
> 状态：**外部参考，非本仓库技术栈**

---

## 0. 一句话结论

dsh-codex-timeline 是 **DeepSeek Harness Web 的第三方插件**：Codex 风格的轮次时间线导航 + 本地会话全文搜索 + 收藏 + 从指定轮次分支。

它最值得学的**不是 UI，而是两件事**：

1. **如何以非侵入方式增强一个你不拥有的宿主** —— 不替换官方组件，只做装饰，并且能够完全还原；
2. **如何在发布前用几十行字符串断言，把「这个包必须做什么、绝不能做什么」变成可执行的契约**。

与本仓库直接相关的一点：它的 `scripts/verify-dist.mjs` 拦的正是「构建产物里混进了不该有的东西 / 丢了必须有的东西」这类**静默故障**。recho-ai 刚发生过的 Vercel 事故（构建期 `VITE_API_BASE_URL` 为空，产物里根本没有网关地址，浏览器只能退化到同源请求并吃 404）就属于这一类，而这种问题在 CI 里几十行就能拦住。

---

## 1. 仓库画像

| 项 | 值 |
|---|---|
| 规模 | 40 个跟踪文件；`lib/client.js` 1086 行、`lib/index.js` 726 行、`src/navigation-model.mjs` 875 行 |
| 技术栈 | 宿主与客户端均为已提交的构建产物（JavaScript），客户端是 React 18；插件系统为 Cordis |
| 构建 | `npm run build` 只做两件事：规范化行尾 + 校验产物。**仓库里没有 `lib/*.js` 对应的 TypeScript 源码**，`lib/index.js` 内保留 `//#region src/settings.ts` 这类溯源注释 |
| 包管理 | pnpm；`engines.node = ^22.19.0 || >=24.0.0` |
| 测试 | Node 原生 `node --test tests/*.test.mjs`，**没有 vitest / jest** |
| 宿主兼容 | DSH `0.1.7-rc.1` / `0.1.7-rc.2` |
| 版本矩阵 | DSH `0.1.7-rc.*` → 插件 `0.6.2 / 0.6.3`；DSH `0.1.2-alpha.3` → 插件 `0.6.0`；更老的 DSH → 插件 `0.5.5` |

### 文件分层

| 层 | 文件 | 行数 | 职责 |
|---|---|---|---|
| 宿主入口 | `lib/index.js` | 726 | Cordis 插件：设置命名空间、两条同源路由、会话搜索索引 |
| 客户端 bundle | `lib/client.js` | 1086（最长行 2486 字符） | `window.__ModuleLoader__.load(...)` 包装的 React 增强层 + 内联 CSS |
| 纯领域模型 | `src/navigation-model.mjs` | 875 | 零依赖纯函数：轨道几何、滚轮手势累积、跳转 settle、搜索取文本与建索引 |
| 归属伴生 | `lib/invariant.js` | 18 | 向 `ctx.invariants` 注册包名；**运行时不变式是空函数** |
| 发布守卫 | `scripts/verify-dist.mjs` | 170 | 发布前的字符串契约断言 |
| 契约元数据 | `compatibility.json` | 22 | 机器可读的适配契约 |

一个反常识的取舍：**可读、可测的源码只有 `src/navigation-model.mjs` 这一个文件**。真正的宿主逻辑与 UI 逻辑都以 bundle 形式提交，想学组件实现只能读压缩产物 —— 这与上次研究的 `dsh-codex-ui`（源码全开）正好相反。

---

## 2. 插件协议：DSH 怎么加载它

### 2.1 `package.json` 的 `dsh` 字段

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": [
      "@deepseek-ai/dsh-api-session-controller",
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-renderer",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-workspace"
    ],
    "platform": "web"
  }
}
```

### 2.2 三个对外入口

```json
"exports": {
  ".":           { "types": "./lib/types/index.d.ts",         "default": "./lib/index.js" },
  "./invariant": { "types": "./lib/types/invariant.d.ts",     "default": "./lib/invariant.js" },
  "./client":    { "types": "./lib/types/client/index.d.ts",  "default": "./lib/client.js" },
  "./package.json": "./package.json"
}
```

- `.` 宿主侧：注册设置命名空间与 HTTP 路由；
- `./client` 浏览器侧：由 DSH 的模块加载器注入；
- `./invariant` 归属声明：告诉宿主「这个包占用/不占用哪些官方能力」。

### 2.3 patch 只做 insert，绝不做 disable

```yaml
# Keep the official Conversation and TurnNavigator intact. This package adds
# search actions and applies only user-selected geometry to the official rail.
- insert:
    - id: codex-timeline
      name: dsh-codex-timeline
```

对比上次研究的 `dsh-codex-ui`（patch 里 `disabled: true` 关掉官方 `ui-sidebar` / `ui-settings-general`，再插入自己的实现）—— 这是**两种完全相反的宿主策略**：

| 策略 | 做法 | 升级宿主时 |
|---|---|---|
| 替换（dsh-codex-ui） | 禁用官方插槽 + 自建实现 | 官方改版可能直接失效，需要跟着改 |
| 增强（dsh-codex-timeline 0.6.x） | 保留官方实现，只做装饰 | 最坏情况是「增强失效」，官方功能仍在 |

`verify-dist.mjs` 会把这条策略**固化成断言**：patch 里一旦出现 `id: ui-conversation` 或 `disabled: true`，构建直接失败，错误信息是 *bundle must enhance without replacing Conversation*。

### 2.4 宿主包一律 optional peerDependency

`@deepseek-ai/cordis`、`dsh-api-session-controller`、`dsh-client-locale`、`dsh-client-ui-renderer`、`dsh-client-ui-settings`、`dsh-invariants`、`react`、`dsh-settings`、`@deepseek-ai/schemastery`、`dsh-llm` **全部**列进 `peerDependencies`，并逐个在 `peerDependenciesMeta` 里标 `"optional": true`。

用意写在 README 里：*避免插件带入旧版核心*。版本升级只改 peer 范围，不会把旧版 DSH 核心装进用户 profile。这条同样被守卫固化：`dependencies` 里出现任何 `@deepseek-ai/*` 即构建失败。

---

## 3. 宿主侧：可选能力注入 + 优雅降级

`lib/index.js` 只有一句 `inject = ["webServer"]`，其余宿主服务全部走**可失败注入**：

```js
safeHostInject(ctx, ["settings"], "timeline settings", (settingsCtx) => { ... })
safeHostInject(ctx, ["sessionQuery"], "timeline search", (c) => { sessionQueryFace = c.sessionQuery })
safeHostInject(ctx, ["sessions"], "timeline search live events", (c) => { sessionsFace = c.sessions })
safeHostInject(ctx, ["sessionPersistence"], "timeline search raw artifacts", (c) => { persistenceFace = c.sessionPersistence })
```

四个服务（`settings` / `sessionQuery` / `sessions` / `sessionPersistence`）各自独立注入，**缺谁就少一个能力**：没有 `sessionQuery` 时搜索路由直接降级成 `503`，而**不是整个插件启动失败**。配套的还有 `safeHostEffect`（把 effect 注册也包成可失败）与 `logStartupFailure`（启动失败只记日志、不抛出）。

客户端同理有 `safeSlot(ctx, name, register)`：公共插槽不存在就跳过注册。整个包的设计目标是 README 里那句 **fail-open startup** —— 宿主版本漂移时最多是「这个插件没生效」，不能把宿主带崩。

### 搜索是怎么做的

搜索**不经过模型、也不上传**，而是走同源路由 `/codex-timeline/search` 读本地会话记录：

- 上限都写死：查询 500 字符（`SEARCH_QUERY_MAX`）、默认返回 100 条（`SEARCH_LIMIT_DEFAULT`）、最多 200 条（`SEARCH_LIMIT_MAX`）；
- 从会话事件里 `projectTurns` 出轮次，生成两行摘要（`twoLineSummary`）、命中窗口上下文（`searchWindowedSource`，默认半径 300 字符）、以及**本地已有的**时间与 Token 消耗指标（`searchUsageTokens`，并显式跳过 token 增量块 `searchIsTokenDelta`）；
- lite 索引有 LRU 缓存（`LITE_CACHE_MAX = 32`），避免长会话每次重算。

这套「只读本地、只返回摘要」的取舍，和我们 `docs/` 里对隐私的要求是同一种取向。

---

## 4. 设置：Host settings seam + revision CAS + schema 迁移

设置**不落 localStorage**，而是写进 profile 的 `cordis.patch.yml`，命名空间 `codex-timeline`：

```js
const Config = z.object({
  enabled:       z.boolean().default(true).volatile(),
  favorites:     z.array(z.string()).default([]).volatile(),
  side:          z.union([z.const("left"), z.const("right")]).default("left").volatile(),
  leftOffset:    z.number().step(1).min(0).max(120).default(0).volatile(),
  centerOffset:  z.number().step(1).min(-200).max(200).default(0).volatile(),
  markerSpacing: z.number().step(1).min(6).max(40).default(10).volatile(),
  recentTurns:   z.number().step(1).min(5).max(50).default(25).volatile(),
})
```

三个值得抄的点：

1. **两端各写一份白名单**。宿主侧 `TIMELINE_SETTING_KEYS`（7 个键）过滤出对外可见字段（`publicTimelineSettings`），`describe({ redactSecrets: true })` 再脱敏 —— 设置面不暴露内部结构。
2. **写入带 revision 的乐观并发**：`settings.update(ns, patch, expectedRevision)` 配 `SettingsConflictError`。多标签页同时拖滑块时不会互相覆盖，冲突会显式报错。
3. **删字段要写迁移**。历史遗留键 `landingFlash` 被显式清掉：

```js
if (Object.prototype.hasOwnProperty.call(descriptor.user, "landingFlash")) {
  void settingsCtx.settings
    .mutate(ns, [{ op: "unset", path: ["landingFlash"] }])
    .catch((error) => logStartupFailure(ctx, "timeline settings migration", error))
}
```

CHANGELOG 里能看到这条路是怎么走出来的：0.6.0 移除了「跳转后的落点闪光」动画，同时**删掉了它的持久化设置项和设置控件** —— 删功能时把设置一起迁掉，而不是留一个永远为 false 的死开关。

---

## 5. 客户端：装饰官方 DOM，且可完全还原

`lib/client.js` 的第一行就是模块包装：

```js
window.__ModuleLoader__.load({
  id: "dsh-codex-timeline",
  factory: (require) => {
    const React = require("react")
    const { jsx, jsxs } = require("react/jsx-runtime")
```

`verify-dist.mjs` 会解析出全部 `require(...)`，并要求**恰好等于** `["react", "react/jsx-runtime"]` —— 多一个依赖都不行。

### 5.1 三步：找到 → 增强 → 还原

```js
function officialNavigator()            // 定位官方导航节点
function enhanceOfficialNavigator(...)  // 在它身上加东西
function restoreOfficialNavigator(nav)  // 拆干净，恢复官方原样
```

它不重新实现导航栏，而是给官方 `<nav>` 打标记，再用 CSS 接管视觉：

- 数据属性：`data-dsh-navigation-enhanced="true"`、`data-dsh-navigation-side="left|right"`；
- 类名前缀统一 `dsh-navx-`；样式是一整段 CSS 字符串，运行时 `document.createElement("style")` 注入；
- **自己的变量** `--dsh-navx-center-offset`、`--dsh-navx-edge-offset`、`--dsh-navx-preview-enter`；
- **读官方的变量** `--dsh-composer-height`、`--dsh-conversation-viewport-height` 来算可用高度；
- 交互契约落在 DOM 上：`data-chat-flow`、`data-chat-turn`，会话能力走 `loadThrough(seq)` 与 `fork({ sessionId, atSeq: seq, increaseTitle: true })`。

CHANGELOG 里有一条**特别值得记下的踩坑**：

> Make official-layout restoration idempotent. Turning enhancements off now restores the rail once and leaves its `--turn-natural-height` intact instead of a second cleanup collapsing the official navigator to zero height.

即：关闭增强时若清理跑了两遍，会把官方导航的高度压成 0。这类「还原不幂等」是增强型插件最容易漏的 bug —— 因为平时没人会去关它。

### 5.2 可访问性与动效

客户端契约里明确包含：`role: "dialog"` / `role: "status"`、`aria-live: "polite"`、`aria-expanded`、`aria-pressed`、`type: "search"`，以及 `@media (prefers-reduced-motion: reduce)` 下关闭动画。这些都被 `verify-dist.mjs` 当作**必须存在的子串**校验 —— 无障碍不是「有空再补」，是发布阻塞项。

---

## 6. 发布守卫 `verify-dist.mjs`（本次研究最有价值的文件）

170 行，挂在 `build` → `prepack` → `prepublishOnly` 链上，**坏包发布不出去**。手段非常朴素：全是字符串断言。

| 类别 | 做法 |
|---|---|
| 语法有效性 | `new vm.Script(client)` 证明 bundle 是合法 JS（只编译、不执行） |
| 清单一致性 | 校验 `name` / `version` / `private` / `dsh.bundle.patch` |
| 策略断言 | patch 必须 insert 且不得出现 `id: ui-conversation` 或 `disabled: true` |
| 契约时效 | `compatibility.json` 与 `package.json` 的 `compatibilityMode` 必须一致 |
| 模块标识 | 客户端 bundle 必须以 `window.__ModuleLoader__.load({ id: "dsh-codex-timeline" ...` 开头 |
| **必须存在** | 约 28 条子串：插槽 id、DOM 选择器、`loadThrough` / `fork` 调用、settings 键名、aria 属性、`prefers-reduced-motion`、`"disabled after startup failure"` 等 |
| **绝不允许** | 约 17 条子串：旧实现残留（`AdditiveTurnNavigation`、`createPortal`、`LegacyImageGallery`）、私有内部名（`RhpIHW_rail`、`data-chat-anchor-key`、`landingFlash`）、宿主包（`@deepseek-ai/dsh-client-ui-chat` 等）、**本机路径 `E:\Program`、`C:\Users`** |
| 依赖白名单 | 运行时 `require` 精确等于 `["react","react/jsx-runtime"]`；`dependencies` 不得含 `@deepseek-ai/*` |
| 宿主反向断言 | 宿主不得注册 `CONVERSATION_SETTINGS_NAMESPACE` 或 `TURN_NAVIGATION_SETTINGS_NAMESPACE`（即不得抢占官方设置命名空间） |
| 可追溯 | 最后打印客户端 bundle 的 `sha256` 前 12 位 |

`forbidden` 列表里那两条本机路径最耐人寻味 —— 作者显然**被本地绝对路径泄漏坑过**，于是把它变成永久断言。

这套做法的价值在于：它用**极低成本**，把「人评审时容易漏、机器一看就知道」的东西全自动化了。缺点是版本号等常量硬编码在脚本里（当前脚本写死 `0.6.3`，而 README 正文仍写着 `0.6.2`），升级时要记得跟着改。

---

## 7. 兼容性策略：不假装兼容

### 7.1 机器可读的适配契约（`compatibility.json`）

```json
"adapter": {
  "mode": "official-navigation-enhancer",
  "insertedRow": "codex-timeline",
  "clientModuleId": "dsh-codex-timeline",
  "publicSlot": "conversation.session.header.actions",
  "officialNavigationOwner": "@deepseek-ai/dsh-client-ui-chat",
  "officialNavigation": "TurnNavigator",
  "domAnchors": ["data-chat-flow", "data-chat-turn"],
  "sessionApis": ["loadThrough", "fork"]
}
```

`ownership: "preserved"` 明确写着「官方 Conversation 的所有权保留给官方」。这份文件同时是**给人看的文档**和**给脚本校验的输入**。

### 7.2 安装前先验版本，不匹配就什么都不做

```powershell
$supportedVersions = @("0.1.7-rc.1", "0.1.7-rc.2")
$actualVersion = (& $dshCommand.Source --version).Trim()
if ($actualVersion -notin $supportedVersions) {
  throw "dsh-codex-timeline only supports DSH $($supportedVersions -join ' or '); found $actualVersion. Nothing was changed."
}
```

关键在最后那句 **Nothing was changed**：宁可装不上，也不要在不兼容的宿主上留下半装状态。README 还专门提醒「当前主分支的 `install.ps1` 仅用于 DSH 0.1.7-rc.1，不要用它安装旧版插件」。

---

## 8. CI / 发布 / 隐私

**CI**（`ci.yml`）：node 24 + pnpm 11.1.2，`pnpm install --frozen-lockfile` → `format` → `test` → `build` → `pnpm pack` → `npm pack --dry-run --json`，产物以 `if-no-files-found: error` 上传 artifact。`permissions: contents: read`。

**发布**（`publish.yml`）：

- 触发：`workflow_dispatch` 或 GitHub Release published；`permissions` 额外要 `id-token: write`（OIDC provenance）；
- **tag 必须等于 `v<package.json version>`**，否则失败；
- 发布前先查 registry 判断该版本是否已存在（`published=true/false` 输出），**天然幂等**，重复运行不会炸；
- `npm publish --access public --provenance`。

**隐私**：搜索只走同源路由读本地会话记录，只返回轮次摘要、有限上下文和本地日志里已有的时间/Token 指标；明确声明不发给模型、遥测或第三方。

---

## 9. 可迁移到 recho-ai 的清单（按价值排序）

### 9.1 新增产物契约检查 `scripts/verify-dist.mjs`（最高优先）

recho-ai 现在只有 `scripts/prepare-spa-fallbacks.mjs`（生成 6 条路由兜底副本），**没有任何产物断言**，所以构建期环境变量缺失这类问题只能等到线上才暴露。按同样的思路，`npm run build` 之后可以至少断言：

| 断言 | 为什么 |
|---|---|
| `dist/assets/*.js` 在 production 构建下必须出现 `VITE_API_BASE_URL` 的值 | **正是本次 Vercel 事故**：产物里没有网关地址 => 前端退化到同源 `/api` => 404 |
| 产物中不得出现 `C:\Users` / `D:\Desktop` 等本机绝对路径 | 本地路径泄漏到发布包 |
| `dist/` 必须包含 6 条 SPA 兜底副本 | `prepare-spa-fallbacks.mjs` 静默失败时无人察觉 |
| 产物中不得出现 `VITE_SUPABASE_SERVICE_ROLE_KEY` 等仅服务端变量名 | 防止把服务端密钥变量打进前端 |

### 9.2 管理端设置改用 revision CAS

现在管理端设置是整体覆盖写；参考 `settings.update(ns, patch, expectedRevision)` + `SettingsConflictError`，多标签页/多人同时改就不会互相覆盖。

### 9.3 可选能力注入 + 降级

对照 `safeHostInject`：网关某个 provider 未配置时，最好是「该能力返回 503、其余接口照常」，而不是启动失败。本仓库 Node/Go 双网关已经有 `tests/go-sidecar-*.test.ts` 做契约测试，但**没有 probe + 降级链这一层**。

### 9.4 可还原的增强要写成成对函数

`enhance*` / `restore*` 成对出现，等价于把「关掉要能干净回退」写进代码结构。注意它踩过的坑：**还原必须幂等**，否则第二次清理会把官方布局压塌。

### 9.5 删除字段/功能时同时迁移设置

对照 0.6.0 删掉「跳转闪光」时连带清掉持久化设置项与控件，以及 `unset landingFlash` 的迁移。recho-ai 之前删 `ModelOption.level` 是对的，但当时是直接删；有迁移意识会更稳。

### 9.6 把无障碍与动效纳入发布阻塞项

`role="dialog"`、`aria-live="polite"`、`aria-expanded`、`aria-pressed`、`prefers-reduced-motion` 都在必查清单里。recho-ai 已有 `tests/` 覆盖交互，可以把这几项也固化成断言。

### 9.7 版本闸门式的安装/启动检查

对照本仓库已有的 `tests/node-version-consistency.test.ts`，思路一致；可以再往前一步，把「支持的 env 变量组合」也纳入测试。

---

## 10. 局限与风险

- **源码不可读**：`lib/index.js` 与 `lib/client.js` 是构建产物，仓库内没有对应 TypeScript 源码。想学 React 组件实现只能读压缩 bundle；真正干净可读的是 `src/navigation-model.mjs`（875 行纯函数 + 394 行单测）。
- **依赖宿主私有 DOM 契约**：`data-chat-flow` / `data-chat-turn` / `--dsh-composer-height` 等都不是稳定的公开 API，作者用 required/forbidden 清单把风险固化下来，但这本质是「用测试弥补缺少类型保障的边界」。
- **文档与代码轻微不同步**：README 正文写 `0.6.2`，`package.json` 是 `0.6.3`，而守卫脚本硬编码校验 `0.6.3`。属于硬编码版本断言的维护成本。
- **版本支持面窄**：只声明 `0.1.7-rc.1` / `0.1.7-rc.2`。本机 `dsh 0.1.7-rc.2` 正好命中，但 DSH 一旦升到正式版就需要先确认。

---

## 附录 A：40 个跟踪文件

```text
lib/index.js                        (726 行)  宿主插件：设置 + 两条路由 + 搜索索引
lib/client.js                      (1086 行) 客户端 bundle：React 增强层 + 内联 CSS
lib/invariant.js                   (18 行)   归属伴生：注册包名，运行时不变式为空
lib/types/{index,invariant}.d.ts             类型声明
lib/types/client/index.d.ts                  客户端类型声明
src/navigation-model.mjs           (875 行)  纯领域模型（唯一可读源码）
tests/navigation-model.test.mjs    (394 行)  纯模型单测
tests/runtime-contract.test.mjs              运行时契约
tests/package-contract.test.mjs              包契约
tests/rc7-contract.test.mjs                  版本适配契约
tests/rc7-browser.mjs                        浏览器行为覆盖
scripts/prepare-dist.mjs                     行尾规范化
scripts/verify-dist.mjs           (170 行)  发布守卫
compatibility.json                           机器可读适配契约
cordis.patch.yml                             插件插入声明（5 行）
package.json / pnpm-lock.yaml / .npmrc
README.md / README.en.md / CHANGELOG.md
LICENSE / NOTICE / install.ps1 / uninstall.ps1 / screenshots.json
.github/workflows/{ci,publish}.yml
docs/images/*.{png,svg}                      README 截图与特性图
```

## 附录 B：关键常量与契约字符串

| 名称 | 值 |
|---|---|
| 设置命名空间 | `codex-timeline` |
| 设置路由 | `/codex-timeline/settings` |
| 搜索路由 | `/codex-timeline/search` |
| 客户端模块 id | `dsh-codex-timeline` |
| 公共插槽 | `conversation.session.header.actions`、`settings.plugins.tab` |
| DOM 锚点 | `data-chat-flow`、`data-chat-turn` |
| 会话 API | `sessions.binding(id).session.loadThrough(seq)`、`ctx.sessions.fork({ sessionId, atSeq, increaseTitle: true })` |
| 搜索上限 | 查询 500 / 默认 100 / 上限 200 条 |
| 搜索窗口半径 | 300 字符 |
| lite 索引缓存 | 32 |
| 轨道窗口默认 | `RAIL_WINDOW_DEFAULT = 25`，边缘预览 `RAIL_EDGE_PREVIEW_COUNT = 2` |
| 滚轮阈值 | 像素 36 / 离散 80 / 空闲重置 160ms / 步进冷却 48ms / 连发 120ms |
| 跳转 settle | 视口上限 1.5、最大距离 88px、比例 0.12、时长 180ms |
| 轨道层级 | 轨道 z-index 110，预览卡 121 |
| 响应式断点 | `max-width: 720px` |

---

## 参考

- 仓库：<https://github.com/Wine-Red/dsh-codex-timeline>
- npm：<https://www.npmjs.com/package/dsh-codex-timeline>
- 相关笔记：[dsh-codex-ui 学习笔记](./dsh-codex-ui-学习笔记.md)（同宿主、相反策略）
