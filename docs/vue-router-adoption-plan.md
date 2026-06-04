# Vue Router 引入计划

本文整理 recho-ai 引入 Vue Router 的原因、目标路由、迁移步骤和验证方式。当前项目是 Vue 3 + Vite 单页应用，入口由 `src/App.vue` 直接控制聊天、生图画布、作品广场和账号弹窗。新增的 `/auth/confirm` 邮箱验证页已经开始使用真实 URL，因此项目到了适合引入路由层的节点。

## 目标

- 用 Vue Router 管理真实页面 URL，避免继续在 `App.vue` 里手写 `window.location.pathname` 判断。
- 保持当前首屏默认进入生图页面，不改变用户主要工作流。
- 让邮箱验证链接 `/auth/confirm` 成为正式路由，支持从邮件直接打开。
- 为后续 `/image`、`/chat`、`/works`、`/settings`、`/profile` 留出清晰扩展点。
- 只路由化页面级状态，不把画布节点、选中图片、缩放、弹窗等细粒度 UI 状态塞进 URL。

## 实施基线

迁移前项目状态如下，这也是本次引入 Vue Router 的直接背景：

- `src/main.ts` 直接挂载 `App.vue`，还没有 `vue-router`。
- `src/App.vue` 是主应用壳，内部用 `showImagePanel` 和 `showAgentPanel` 切换主要界面。
- `src/components/ImageCanvas.vue` 继续是生图画布和作品广场的核心控制点。
- `src/components/AuthConfirmView.vue` 已作为邮箱验证页面存在，但通过 `App.vue` 的路径判断渲染。
- `render.yaml` 已加入静态站点 rewrite：`/* -> /index.html`，满足 HTML5 history mode 直接访问路径的要求。

迁移落地后，当前项目应保持以下状态：

- `src/main.ts` 注册 `router` 后再挂载 Vue 应用。
- `src/App.vue` 只渲染 `<RouterView />`。
- 原主应用壳移动到 `src/views/AppShell.vue`。
- `src/router/index.ts` 集中声明 `/image`、`/chat`、`/works`、`/auth/confirm`。
- `/image`、`/chat`、`/works` 复用 `AppShell.vue`，通过 `route.meta.workspace` 同步当前页面级工作区。
- `/auth/confirm` 独立渲染 `AuthConfirmView.vue`，不再依赖 `window.location.pathname` 手写分支。

## 推荐路由

第一阶段只做这些路由：

| Path | Component | 说明 |
| --- | --- | --- |
| `/` | redirect `/image` | 保持默认打开生图 |
| `/image` | `AppShell.vue` | 主应用壳，默认显示生图画布 |
| `/chat` | `AppShell.vue` | 主应用壳，显示聊天 |
| `/works` | `AppShell.vue` | 主应用壳，显示作品广场 |
| `/auth/confirm` | `AuthConfirmView.vue` | 邮箱验证回调页 |
| `/:pathMatch(.*)*` | redirect `/image` 或 `NotFoundView.vue` | 第一阶段可先重定向 |

说明：

- `/image`、`/chat`、`/works` 可以先共用同一个 `AppShell.vue`，通过 route meta 或 path 初始化当前 workspace。
- 作品广场目前仍在 `ImageCanvas.vue` 里，因此第一阶段不强制拆出独立 `WorksView.vue`。
- 等作品广场逻辑稳定后，再考虑把画布和广场拆成更清晰的 view/component 边界。

## 迁移步骤

### 1. 安装依赖

```bash
npm install vue-router
```

### 2. 新增路由文件

新增 `src/router/index.ts`：

```ts
import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/image' },
    { path: '/image', component: () => import('../views/AppShell.vue'), meta: { workspace: 'image' } },
    { path: '/chat', component: () => import('../views/AppShell.vue'), meta: { workspace: 'chat' } },
    { path: '/works', component: () => import('../views/AppShell.vue'), meta: { workspace: 'works' } },
    { path: '/auth/confirm', component: () => import('../components/AuthConfirmView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/image' },
  ],
})
```

使用动态 import，让路由级组件可以自动分包。`AuthConfirmView.vue` 也可以保持独立 chunk，用户只在点邮件验证链接时加载。

### 3. 修改入口

修改 `src/main.ts`：

```ts
import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import { router } from './router'

createApp(App).use(router).mount('#app')
```

### 4. 简化 App.vue

`src/App.vue` 改成只负责渲染路由出口：

```vue
<template>
  <RouterView />
</template>
```

当前 `App.vue` 里的主应用逻辑迁移到 `src/views/AppShell.vue`。

### 5. AppShell 接收路由意图

`AppShell.vue` 里读取当前 route，根据路径或 `route.meta.workspace` 控制界面：

- `/image`：`showImagePanel = true`
- `/chat`：`showImagePanel = false`，`showAgentPanel = false`
- `/works`：进入 `ImageCanvas.vue` 的作品广场模式

注意：`/image`、`/chat`、`/works` 第一阶段会共用同一个 `AppShell.vue`。Vue Router 在相同组件之间跳转时会复用组件实例，因此不要只在 `onMounted` 初始化一次。需要 watch 当前 route 的 workspace：

```ts
const route = useRoute()

watch(
  () => route.meta.workspace,
  (workspace) => {
    showImagePanel.value = workspace !== 'chat'
    showAgentPanel.value = false
    imageWorkspace.value = workspace === 'works' ? 'gallery' : 'canvas'
  },
  { immediate: true },
)
```

`ImageCanvas.vue` 内部已经有 `WorkspaceMode = 'canvas' | 'gallery'` 和 `activeWorkspace`。这里不是新增类型，而是增加一个路由可控入口，例如：

```ts
const props = defineProps<{
  workspaceMode?: WorkspaceMode
}>()

watch(
  () => props.workspaceMode,
  (mode) => {
    if (mode) selectWorkspace(mode, { emitChange: false })
  },
  { immediate: true },
)
```

这里要避免路由 prop 同步时再次 emit `workspaceChange`，否则 `/image` 和 `/works` 的切换会变成路由更新和组件事件互相触发。

对应关系：

- `/image` 对应 `canvas`
- `/works` 对应 `gallery`

### 6. 替换顶部导航行为

当前 header 的“聊天/生图/作品广场”切换如果只是修改本地 ref，迁移后应改成：

- 打开生图：`router.push('/image')`
- 打开聊天：`router.push('/chat')`
- 打开作品广场：`router.push('/works')`

用户刷新页面后应该留在同一个主页面。

### 7. 保留组件内部状态

不要第一阶段路由化这些内容：

- 画布节点坐标和缩放
- 当前选中的节点
- 图片节点局部缩放
- 富文本框里的 `@图片` 索引状态
- 生成中的请求状态
- 账号登录弹窗开关

这些还是组件状态或持久化状态，不适合变成 URL query。

## Supabase 邮件验证影响

引入 Vue Router 后，Supabase Confirm signup 模板仍然使用：

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">确认邮箱</a>
```

注册时继续传：

```ts
emailRedirectTo: `${window.location.origin}/auth/confirm`
```

只要 Supabase Redirect URLs 包含以下地址即可：

```text
https://recho.sansenjian.asia/auth/confirm
https://recho-ai.onrender.com/auth/confirm
http://localhost:5173/auth/confirm
http://localhost:5174/auth/confirm
http://127.0.0.1:5173/auth/confirm
http://127.0.0.1:5174/auth/confirm
```

## 部署要求

使用 `createWebHistory()` 后，生产环境必须有静态站点 fallback。如果前端服务是通过 Blueprint 创建的，当前 `render.yaml` 已包含：

```yaml
routes:
  - type: rewrite
    source: /*
    destination: /index.html
```

如果前端 Static Site 是手动创建的，需要在 Render 控制台的 **Redirects/Rewrites** 页面手动添加同一条规则；否则直接打开 `/image`、`/works`、`/auth/confirm?...` 会返回 `404 Not Found`。

`npm run build` 会通过 `scripts/prepare-spa-fallbacks.mjs` 生成关键路由的静态 `index.html` 兜底副本，但这只能覆盖已列出的路径，不能替代 Render 的全局 rewrite。

如果以后迁移到其他平台，也要配置等价规则：

- Vercel：rewrite 到 `/index.html`
- Nginx：`try_files $uri $uri/ /index.html`
- Cloudflare Pages：添加 SPA fallback 或 `_redirects`

## 验证清单

迁移完成后至少验证：

- `npm run build`
- `npm test`
- 直接访问 `http://127.0.0.1:5173/image` 可以打开生图页
- 直接访问 `http://127.0.0.1:5173/chat` 可以打开聊天页
- 直接访问 `http://127.0.0.1:5173/works` 可以打开作品广场
- 直接访问 `http://127.0.0.1:5173/auth/confirm?token_hash=test&type=email` 可以打开验证页并显示失败状态
- 登录/注册弹窗仍能打开
- 邮箱验证成功后能回到主应用
- Render 线上直接打开 `/auth/confirm?...` 不返回 404

## 风险和处理

| 风险 | 处理 |
| --- | --- |
| `App.vue` 迁移时事件监听泄漏 | 把原本的 `onMounted`/`onUnmounted` 原样移入 `AppShell.vue` |
| `/image`、`/chat`、`/works` 复用同一个 `AppShell.vue` | watch route meta/path，同步更新当前 workspace |
| `/works` 和 `ImageCanvas.vue` 内部状态耦合 | 第一阶段只加可控 prop，不急着拆组件 |
| history mode 线上 404 | 保留并验证 Render rewrite |
| 旧链接 `/` 行为变化 | `/` 直接 redirect 到 `/image`，符合当前默认生图页 |
| bundle 继续偏大 | 路由组件使用动态 import，后续再拆 `ImageCanvas.vue` |

## 推荐落地顺序

1. 安装 `vue-router` 并提交 lockfile。
2. 创建 `src/router/index.ts`。
3. 把当前 `App.vue` 主体移动到 `src/views/AppShell.vue`。
4. 把 `App.vue` 简化成 `<RouterView />`。
5. 接入 `/auth/confirm` 路由，删除手写 pathname 判断。
6. 接入 `/image` 和 `/chat`。
7. 接入 `/works`，让作品广场拥有独立 URL。
8. 跑构建、测试和本地直连路径验证。

## 暂不做

- 暂不引入路由级权限守卫，因为当前账号登录不是强制的。
- 暂不把图片详情、节点详情做成深链接。
- 暂不引入 Pinia 或其它状态库，只解决路由边界。
- 暂不重构 `ImageCanvas.vue` 的核心业务逻辑。
