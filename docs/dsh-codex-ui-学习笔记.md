# dsh-codex-ui 学习笔记

> 研究对象：[MichengAI/dsh-codex-ui](https://github.com/MichengAI/dsh-codex-ui)（Apache-2.0，v1.1.21）
> 研究快照：`git clone --depth 1`，HEAD `8d9223a`
> 状态：**外部参考，非本仓库技术栈**

---

## 0. 一句话结论

dsh-codex-ui 是 **DeepSeek Harness Web 的客户端插件**（Codex 风格侧栏 + 工作区会话树 + 全局搜索 + 轮次导航），React 18 + 自有 CSS-in-TS，**没有 Tailwind、没有 shadcn、与本仓库技术栈不同**。

所以能带走的**不是代码，是工程方法论**：宿主兼容层的写法、错误脱敏漏斗、i18n 词典当契约、CSS 抽成字符串以便真浏览器量像素、拖放落点的 ref 镜像。

---

## 1. 仓库画像

| 项 | 值 |
|---|---|
| 规模 | 216 个跟踪文件 / 39,402 行（src 80 文件 10,715 行；tests 80 文件 8,746 行；scripts 21 文件 1,721 行） |
| 技术栈 | TypeScript + React 18 + Cordis 插件系统；唯一运行时依赖 `lucide-react` |
| 构建 | `tsc --noEmit && tsdown` → `lib/index.mjs`（Host）、`lib/client.js`（客户端） |
| 包管理 | pnpm@11.22.0；`engines.node = ^22.19.0 或 >=24.0.0` |
| 宿主兼容 | peerDeps 显式列出 7 个 DSH 版本：0.1.0-rc.8 / 0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.1 / 0.1.5-rc.2 / 0.1.7-rc.1 / 0.1.7-rc.2 |

### 文件分层

| 层 | 代表文件 | 行数 | 职责 |
|---|---|---|---|
| Host 入口 | `src/index.ts` | 367 | 在 `ctx.webServer` 注册 REST 端点 |
| 客户端入口 | `src/client/index.ts` | 313 | 唯一注册根：locale、observer、插槽注入 |
| 外壳 | `CodexSidebar.tsx` | 451 | 侧栏骨架 + 折展动画状态机 + 全局搜索 |
| 主视图 | `CodexWorkspaceBrowser.tsx` | 971 | 最大的文件：三区树 + 拖放状态机 |
| 设置 | `CodexSettingsPage.tsx` + `PluginConfigSection.tsx` | 225 + 141 | 全屏设置页，`createPortal` 挂 `document.body` |
| 纯逻辑 | `workspace-browser.ts` / `workspace-groups.ts` | 334 / 152 | 零 React 依赖的重排与分组领域模型 |
| **兼容层** | `session-host.ts` | 242 | **本次研究最有价值的文件** |
| 错误层 | `user-error.ts` | 113 | 消息安全漏斗 |

`cordis.patch.yml` 只做一件事：禁用官方 `ui-sidebar` / `ui-settings-general` / `session-title-llm`，再插入自己的实现。
**替换插槽，而不是改造官方组件** —— 这是它能在宿主升级中活下来的根本原因。

---

## 2. 五个最值得抄的工程思路

### 2.1 结构化的宿主兼容层（`session-host.ts`）

宿主 API 在 rc 版本间改了 5 次。作者的解法不是 if-else 堆叠，而是三层设计：

1. **结构化类型而非标称类型**：`SessionListLike`、`SessionStatusLike`、`SessionBindingLike`、`SessionReferenceLike`、`HostSessions`、`HostSessionAccess` —— 只描述"我需要什么形状"，不 import 宿主的类。
2. **`probeService(ctx, name)` 探测协议**：
   有 reflect 时只 probe，不能硬读未注入服务，否则 Cordis 会挡住插件激活；否则退到 `ctx.get(name)`；完全没有 reflect 面时才读原始属性，全部 try/catch。
3. **三级降级链**（打开会话）：
   `uiWorkspace.openSession(id)` → 若存在 `sessions.retain` 则直接返回 false → 否则 `sessions.open(id)`。
   第二条的理由写在注释里：alpha.2 有 retain，旧的 `sessions.open` 即使还在也不会写入 mainView，点了等于没打开。

每一处版本差异都写清**为什么**，例如：
> 旧宿主读 `list.current`；alpha.2 主视图改由 `retainedBy.mainView` 标记。

**可迁移点**：本仓库有 Node/Go 双网关，`tests/go-sidecar-*.test.ts` 已做类似的事，但**没有 probe + 降级链这一层**。

---

### 2.2 错误绝不裸奔（`user-error.ts`，113 行）

三级漏斗：

- `UserFacingError` —— 仅显式构造的本地化错误允许原样进入界面
- `HostActionError(action, reason)` —— 所有宿主调用统一包一层
- `runHostAction(action, execute)` —— 统一入口，前两者原样重抛，其余全部包成 `HostActionError`

解析顺序 `userErrorText(error, t)`：

```
businessRequestErrorKey(HTTP 状态) → UserFacingError.message(原样)
  → WorkspaceGroupError code → HostActionError key → t('errors.generic')
```

**未知错误永远脱敏成通用本地化文案。**

跨 bundle 的远端错误识别用**结构标记**，不用 `instanceof`：

> DSH 明确要求跨 bundle 按结构标记识别 RemoteFailure，不能使用 instanceof。

即沿错误链下降（`seen` Set 防环），穿透 `record.rpcError`，找 `record.isDSHRemoteError === true && typeof record.code === 'string'`。

还有 `installErrorText()`：10 条 `[RegExp, i18nKey]` 规则，匹配 pnpm store 不匹配 / 端口占用 / 超时 / 缺少 pnpm 等具体安装失败。

**可迁移点**：本仓库有 `src/lib/safe-error.ts`，但 UI 中仍有 `src/views/AppShell.vue:184` 的 `window.alert('只有管理员可以进入 Chat。')` —— 硬编码中文 + 原生弹窗。**这是最该先补的一课。**

---

### 2.3 i18n 词典当测试契约（`locales.ts` + `tests/locales.assert.ts`）

584 行词典，**zh 是唯一真源**：

```ts
export const zh = { 'home.resizeInput': '拖动调整输入区宽度', /* … */ } as const
export const en: Record<keyof typeof zh, string> = { /* … */ }
export type CodexUiKey = keyof typeof zh
```

`as const` + `Record<keyof typeof zh, string>` 的组合让**漏翻一个键直接编译报错**。

再叠加 5 条静态断言：

| # | 规则 | 断言 |
|---|---|---|
| 1 | 英文不得残留 CJK | `assert.doesNotMatch(value, /[㐀-鿿]/)` |
| 2 | 占位符必须一致 | 收集 `/{([^}]+)}/g` 后 `deepEqual` |
| 3 | 固定串 | `en['time.justNowShort'] === 'now'`（英文用短词，避免挤占标题） |
| 4 | **组件不得硬编码 UI 文案** | 正则扫 `src/**/*.tsx`，去掉词典本身后断言不匹配中文 |
| 5 | **不得留死键** | 词典里每个键必须在源码中被引用，否则 `dead` 数组非空 |

**可迁移点**：本仓库有 `src/i18n/en.ts|zh.ts` + `tests/admin-i18n-parity.test.ts`，已有 parity 检查，但**缺第 4、5 条负向断言**。

---

### 2.4 CSS 即被测制品（第四层测试）

样式被写成 TS 字符串常量：

```ts
export const WORKSPACE_TREE_STYLE =
  stylesheet + runningStyles + typographyStyles + collectionLayoutStyles
```

**不是为了好看，是为了可测**。测试脚本用 TypeScript 编译器 API 从 `.tsx` 源码里把 CSS 字符串抽出来：

```js
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
// 提取四个 NoSubstitutionTemplateLiteral 变量，缺一个就 throw '未提取到完整工作区样式'
```

再用 `ts.transpileModule(...).outputText.replace(/^export /gm, '')` 把纯逻辑模块转成普通脚本注入 fixture，**真 Chromium 量像素**：

- 断言拖放蓝线中心与上下行边界误差 `<= 0.1px`
- 断言侧栏折叠后 MutationObserver 回调数为 **0**（收敛，不是死循环）
- 断言收起分组后，蓝线不再使用已隐藏会话的边界

**四层测试体系**：

| 层 | 形式 | 做什么 |
|---|---|---|
| 1 | `*.spec.ts`（vitest，约 40 个） | 纯模块单测 |
| 2 | `*.integration.spec.ts` | 真 React 组件渲染进 jsdom + 手写假宿主 store + DataTransfer polyfill |
| 3 | `*.assert.ts`（约 30 个） | **纯 node 脚本**，静态检查源码或**构建产物** |
| 4 | `scripts/verify-*.mjs`（playwright） | 真浏览器量布局 |

第 3 层的精妙处 —— `tests/run-assertions.mjs` 只有 18 行，却把 30+ 个契约脚本变成一等公民，且**在构建产物上验证**：

- `client-module-contract.assert.ts` 读 `lib/client.js`，断言运行时 `require()` 只能有 `['@deepseek-ai/dsh-client-ui-primitives','react','react-dom','react/jsx-runtime']`
- `no-usage-adaptation.assert.ts` 是**负向需求测试**：断言已移除的计费代码路径确实不存在
- `client-bundle.assert.ts` 只有 8 行，读 `lib/client.js` 文本断言 `require("react")` 存在 —— 证明**被测制品真就是插件本身**

**可迁移点**：本仓库 `playwright ^1.60.0` 已安装但**一行没用**。它最该用在哪，dsh-codex-ui 给了答案：不是 e2e 点击，是**量布局盒子**。

---

### 2.5 拖放落点：ref 镜像 + 可见行几何

`dragover` 与 `drop` 可能发生在框架提交 state 之前。解法是**同一份状态同时写 ref**：

```ts
// dragover 与 drop 可能发生在 React 提交 state 之前；ref 保证松手时读取到最后一个蓝线落点
const setWorkspaceDropTarget = (target) => {
  if (sameWorkspaceDropTarget(ref.current, target)) return  // 相等就完全不动
  ref.current = target   // 先写 ref
  setState(target)       // 再写 state
}
```

蓝线本身由独立模块测量（`workspace-drop-indicator.ts`，97 行）：

- 取**可见行**的几何边界（`height > 0 && width > 0`），不依赖外层留白
- 按 `(top,left,width)` 去重 —— 同一落点可能同时标记在包装节点和行上
- 拖拽期间跑**连续 rAF**，只在计算出的 rect 字符串变化时才写样式
- 发现多个有效落点时输出 `console.warn('Codex UI 拖拽存在多个有效落点，请检查跨区状态清理。')`

`reorderDropBeforeId(ids, dragged, hovered, after)` 返回 `undefined | null`：**`null` 表示"自悬停或顺序未变"→ 不画线、不提交**。

---

## 3. 设计细节速查

### 动效

- 全站统一缓动 `cubic-bezier(.16,1,.3,1)`；时长只有 140 / 180 / 220 / 500ms 四档
- 折叠用 `grid-template-rows: 1fr → 0fr`，**不用 `max-height` 猜高度**
- **`prefers-reduced-motion` 覆盖每一处动效**，另有 `forced-colors` 和 `@supports (corner-shape: superellipse(1.5))` 渐进增强
- 侧栏折叠：先 140ms 淡出宽态内容，再切 56px 窄轨；收尾时**不再重复淡入窄轨**（否则半秒处会闪烁）

### 布局陷阱

- 玻璃态滤镜挂在 **`::before` 伪元素**上，绝不挂容器 —— 否则 `filter` 会创建包含块，把 portal 到 body 的全屏设置页**困在 56px 窄轨里**
- **宽度契约**：宿主列负责缩放，内容保持 `var(--dcu-sidebar-expanded-width)` 固定宽 —— 动画期间**被裁切而非逐帧重排**（避免中文竖排）
- 设置页与别人的布局抢 transition 时，**合并双方过渡**而不是二选一

### 观察者纪律

- **`setAttribute` 同值也会触发 MutationObserver** → 每次写前先比较当前值（幂等）
- 观察者用**相关性过滤**：只对匹配子树 / 新增 / 移除的变更响应，流式输出不触发全文档扫描
- 有 `applying` 重入守卫 + rAF 合帧 + 双重 `requestAnimationFrame` 恢复首帧过渡

### 状态管理

- **每个可选宿主能力都有稳定的空实现常量**（`EMPTY_PENDING_INTERACTIONS`、`noopDispatch`、`emptyPanels`）→ 保证 hook 依赖数组不因身份变化而重渲染
- **两个 Context 分离悬停状态**：`HoverDispatchContext`（稳定，树组件只订阅它）+ `HoverValueContext`（变化，只有卡片订阅）
- 悬停延迟：**看空行必须停满 1 秒**才出现（避免闪现）；已经有卡片时换行**立刻更新**；隐藏留 120ms 宽限让指针能移进卡片
- 全项目**几乎不用 `memo()`**，靠 setter 的相等性函数（`sameIds` / `sameWorkspaceGroups`）保持引用稳定

### 排序稳定性（值得单独记）

`groupScheduleSessions` 用 `localeCompare(..., locale, {numeric:true, sensitivity:'base'})` 排**组**，而不是首次出现顺序：

> 会话投影在归档后会重排 ids；若沿用首次出现顺序，移除某个会话会让整组文件夹换位…避免连续归档时界面跳动。

### 图标策略

两套图标**并存且各有理由**：宿主图标覆盖约 90%，宿主没有的（GitHub 品牌标识、Pin、Archive、时钟）用 `lucide-react` 或内联 SVG，并在代码里注明为什么：

> 宿主图标库不提供 GitHub 品牌标识，内联后可离线使用并继承当前文字颜色。

（注意：这条与本仓库 AGENTS.md「不内联 SVG」的约定不同 —— 本仓库不适用。）

---

## 4. 与本仓库（recho-ai）的差距对照

| 维度 | dsh-codex-ui | recho-ai 现状 |
|---|---|---|
| 轮次导航 | 只列**用户轮次**；悬停高斯波 `5 + 13*exp(-d²/2.1)` 膨胀刻度；悬浮摘要药丸；rAF 合帧；`ResizeObserver` 跟随侧栏 | `src/components/ChatMessageRail.vue` 64 行，列**每一条**消息；无波、无摘要、无 rAF |
| 滚动扫描 | 每帧**只扫一次** DOM 生成锚点索引（`conversationAnchors`） | `src/views/AppShell.vue:99` 的 `updateActiveRailMessage()` 每次 scroll **线性遍历全部消息**，外加 `watch(messages, …, {deep:true})` 兜底 |
| 无障碍 | 每处动效都有 reduced-motion 分支；`aria-label` 走 i18n | `aria-label="跳转到 AI 回复第 N 条"` **硬编码中文**；无 reduced-motion 分支 |
| 测试层次 | 4 层（vitest / node assert / playwright 布局 / **真宿主**） | 1 层（69 个 `tests/*.test.ts`）；playwright 装了没用 |
| 巨型文件 | `CodexWorkspaceBrowser.tsx` 971 行，但纯逻辑全抽到无依赖模块并单测 | `AppShell.vue` 701 行；`ImageCanvas.vue` 1716 行 |
| 字号 | 全部继承宿主 `--dsw-font-family`，不写死 | — |

**结论：本仓库的 `ChatMessageRail` 是最接近 TurnNavigator 的组件，也是收益最高的改造点。**

---

## 5. 建议的改造顺序

按投入产出比排序：

1. **把 rail 逻辑抽成 composable 并加 rAF 合帧**
   新建 `src/composables/useMessageRail.ts`，收集锚点索引 + `requestAnimationFrame` 合帧，把 `AppShell.vue` 的 `updateActiveRailMessage` / `jumpToMessage` / `messageElements` 全搬进去。
2. **rail 只展示用户轮次 + 摘要药丸**
   对齐 `TurnNavigator.tsx`：`TURN_SUMMARY_LIMIT = 72`（摘要要同时进 `title`、`aria-label` 和 DOM 文本，必须截断）；悬停波用 `Math.exp(-(d*d)/2.1)`。
3. **补负向 i18n 断言**
   在 `tests/admin-i18n-parity.test.ts` 旁边加：组件内不得硬编码中文；词典不得有死键。
4. **给 playwright 写第一个布局验证脚本**
   仿 `scripts/verify-workspace-drop-layout.mjs`：提取 CSS → 建 fixture → 量盒子，先验证折叠动画不用 `max-height` 猜高度这件事。
5. **错误统一走漏斗**
   干掉 `window.alert`，引入 `UserFacingError` + `userErrorText` 式的解析顺序，未知错误兜底通用文案。

---

## 6. 反模式 / 不要做的事

- **不要物理搬移框架管理的 DOM 节点**（React 重渲染时会因节点父级脱钩抛 `NotFoundError` 导致整个界面白屏）—— 用 `display:contents` + CSS `order` 做视觉重排。
- **不要把 `filter: blur()` 挂在容器上** —— 会创建包含块，困住 portal 出去的全屏层。
- **不要为了"看起来更好看"而无限加皮肤** —— 作者在 1.1.7 主动**移除**了对某个插件卡片的全部外观覆盖（know when to STOP skinning）。
- **不要用标题判断会话归属** —— 会话用**稳定前缀**识别：

  > Automation 从首个版本起就用稳定前缀创建运行会话。标题是用户可编辑数据，不能作为所有权依据，否则普通会话改成时间格式后会从任务树消失。

- **不要在排序键上依赖短暂存在的 id 顺序**（见 §3 排序稳定性）。
- **不要用 `instanceof` 判断跨 bundle 的错误类型** —— 用结构标记。
- **保留回滚路径**：`conversation-bubbles.ts` 每次 observe 都执行上一版 DOM 皮肤的**撤回**，并保留旧版 localStorage 键供回退。

---

## 7. 关键常量备查

```ts
// 侧栏
CODEX_SIDEBAR_MIN_PX = 240      // 与 OpenAI Codex 桌面端几何一致
SIDEBAR_MAX_PX       = 420
SLIM_SIDEBAR_PX      = 56       // 窄轨
SIDEBAR_COLLAPSE_SETTLE_MS = 500

// 轮次导航
TURN_SUMMARY_LIMIT   = 72
tickMarkSize: width = 5 + 13 * exp(-(d*d)/2.1), height = 1 + 1.2 * exp(-(d*d)/2.1)
默认：width 5 / height 1（未悬停）

// 会话列表
PROJECT_SESSION_PREVIEW_LIMIT = 5
PROJECT_SESSION_PAGE_SIZE     = 10

// 悬停卡片
HOVER_TIP_SHOW_DELAY_MS = 1000
HOVER_TIP_HIDE_DELAY_MS = 120
WORKSPACE_HOVER_CARD_WIDTH = 316

// 输入历史
limit = 200，单条 <= 8000 字符，<= 20 个 scope，单键 <= 1_000_000 字节
HISTORY_KEY = 'michengai.codex-ui.input-history.v1'
LEGACY_HISTORY_KEY = 'michengai.btw.history.v1'   // 迁移后只写新键，保留旧数据供回退

// 分组领域
MAX_WORKSPACE_GROUPS = 100, MAX_WORKSPACE_GROUP_TITLE_LENGTH = 80
MAX_GROUPED_WORKSPACE_IDS = 1_000

// 展开状态
MAX_EXPANSION_ENTRIES = 500, MAX_EXPANSION_KEY_LENGTH = 512

// 时间分档
HOUR = 3600, DAY = 24H, WEEK = 7D, MONTH = 30D, YEAR = 365D
PX_PER_SECOND = 42（长标题跑马灯）
```

### 拖放 MIME 契约

```
application/x-dcu-session          <- 同时镜像到 text/plain，前缀 'dcu-session:'
application/x-dcu-workspace        <- 前缀 'dcu-workspace:'
application/x-dcu-workspace-group  <- 前缀 'dcu-workspace-group:'
```

三者**互斥**（session 载荷会抑制父级 workspace 的置顶）；`getData` 全部包 try/catch，因为 **Chrome 在 dragover 阶段不允许 getData**。

---

## 8. 参考坐标

- 仓库：<https://github.com/MichengAI/dsh-codex-ui>
- 本地快照：`.dcu-study/`（**未跟踪，勿提交**）
- 作者配套插件生态（11 个）：Codex UI、Agency Agents、Skills Manager、Archive Manager、IM Connect、Automation、BTW、Simplify、PUA、Code Review、Codex Pet，外加 DSH Codex Desktop
- 变更历史本身就是设计史：`CHANGELOG.zh-CN.md`（1241 行）每条都写清 **UX 问题 + 选定解法**，值得当案例集读

---

## 附：本笔记的取样范围

已逐文件精读（clone 内完整阅读）：

`session-host.ts`、`user-error.ts`、`business-request-error.ts`、`workspace-browser.ts`、`workspace-groups.ts`、
`TurnNavigator.tsx`、`CodexSidebar.tsx`、`CodexWorkspaceBrowser.tsx`、`CodexSettingsPage.tsx`、`PluginConfigSection.tsx`、
`AboutSection.tsx`、`ConnectorsSection.tsx`、`NewConversationSuggestions.tsx`、`SettingsDocumentAction.tsx`、
`ChannelBrowser.tsx`、`ScheduleBrowser.tsx`、`session-tree.tsx`、`session-row-actions.tsx`、`hover-shell.tsx`、
`workspace-hover-card.tsx`、`global-panels.tsx`、`footer-actions.ts`、`companion-slots.ts`、`sidebar-width.ts`、
`sidebar-drag.ts`、`composer-width.ts`、`new-conversation-style.ts`、`conversation-header.ts`、`conversation-dom.ts`、
`conversation-bubbles.ts`、`official-turn-navigator.ts`、`composer-tool-menus.ts`、`settings-navigation.ts`、
`settings-nav-icons.ts`、`settings-page-model.ts`、`settings-page-styles.ts`、`settings-page-registration.ts`、
`settings-focus.ts`、`session-manager.ts`、`session-move.ts`、`session-pending.ts`、`session-title-scroll.ts`、
`session-navigation.ts`、`workspace-compat.ts`、`workspace-archive.ts`、`workspace-drop-indicator.ts`、
`input-history.ts`、`input-history-keyboard.ts`、`draft-attachments.ts`、`tree-expansion.ts`、`shared-now.ts`、
`hover-tip.ts`、`sidebar-search.ts`、`host-icons.ts`、`host-open-path.ts`、`channel-api.ts`、`schedule-sessions.ts`、
`schedule-group-actions.ts`、`locales.ts`、`src/client/index.ts`、`src/index.ts`、`cordis.patch.yml`、
`tests/locales.assert.ts`、`tests/client-module-contract.assert.ts`、`tests/no-usage-adaptation.assert.ts`、
`tests/client-bundle.assert.ts`、`tests/run-assertions.mjs`、`scripts/verify-workspace-drop-layout.mjs`、
`scripts/verify-sidebar-transition.mjs`、`scripts/verify-settings-backdrop.mjs`。
