# Supabase GitHub 认证接入方案

本文记录 recho-ai 引入 GitHub 登录的推荐方案。目标是在保留现有邮箱/密码登录的基础上，增加 GitHub OAuth 登录，不强制登录，同时让生成历史继续使用 Supabase `user.id` 作为可选用户标识。

## 当前项目状态

- 前端是 Vue 3 + Vite SPA，已经引入 Vue Router。
- 现有账号逻辑集中在 `src/composables/useAuthSession.ts`。
- 现有账号弹窗在 `src/views/AppShell.vue`，支持邮箱/密码登录、创建账号和退出登录。
- Supabase 客户端在 `src/lib/supabase.ts` 创建，已经开启：
  - `detectSessionInUrl: false`
  - `flowType: 'pkce'`
  - `persistSession: true`
  - `autoRefreshToken: true`
- 邮箱确认页已经使用 `/auth/confirm`。
- 本分支已经把 GitHub OAuth 的前端回调页、登录按钮和路由接好了，剩下只需要手工填写 GitHub OAuth App 和 Supabase Dashboard 配置。

## 推荐结论

建议通过 Supabase Auth 的 GitHub provider 接入，而不是自己在后端实现 GitHub OAuth。

原因：

- Supabase 已经负责 GitHub token 交换、用户创建、session 存储和刷新。
- 前端只需要调用 `supabase.auth.signInWithOAuth({ provider: 'github' })`。
- 继续复用当前 `getSession()`、`onAuthStateChange()`、`signOut()` 逻辑。
- 不需要把 GitHub Client Secret 放进前端或 Render 环境变量。

## URL 关系

GitHub OAuth 会经过两段跳转：

```text
用户点击 GitHub 登录
-> Supabase Auth 授权地址
-> GitHub 授权页
-> Supabase 项目回调 /auth/v1/callback
-> Recho 前端 /auth/callback
```

这里最容易配错的是：

- GitHub OAuth App 的 Authorization callback URL 填 Supabase 回调地址。
- Supabase Redirect URLs 填 Recho 前端回调地址。

不要把 `https://recho.sansenjian.asia/auth/callback` 填到 GitHub OAuth App 的 callback URL 里。

## GitHub OAuth App 配置

在 GitHub -> Settings -> Developer settings -> OAuth Apps 新建 OAuth App。

推荐填写：

```text
Application name:
Recho

Homepage URL:
https://recho.sansenjian.asia

Authorization callback URL:
https://<supabase-project-ref>.supabase.co/auth/v1/callback
```

如果当前 Supabase 项目 ref 仍是 `musbqvjgtgetlouwsoxk`，callback URL 形如：

```text
https://musbqvjgtgetlouwsoxk.supabase.co/auth/v1/callback
```

更稳妥的做法是在 Supabase Dashboard 的 GitHub provider 页面复制官方显示的 callback URL。

保存后拿到：

- Client ID
- Client Secret

Client Secret 只填到 Supabase Dashboard，不进入前端 `.env`，也不进入 Render 前端环境变量。

## Supabase Dashboard 配置

在 Supabase Dashboard -> Authentication -> Sign In / Providers -> GitHub：

1. 启用 GitHub provider。
2. 填入 GitHub OAuth App 的 Client ID。
3. 填入 GitHub OAuth App 的 Client Secret。
4. 保存。

在 Authentication -> URL Configuration 里继续保留已有 `/auth/confirm`，并新增 `/auth/callback`：

```text
https://recho.sansenjian.asia/auth/callback
https://recho-ai.onrender.com/auth/callback
http://localhost:5173/auth/callback
http://localhost:5174/auth/callback
http://127.0.0.1:5173/auth/callback
http://127.0.0.1:5174/auth/callback
```

Site URL 继续建议为：

```text
https://recho.sansenjian.asia
```

## 前端实现计划

### 1. 新增 OAuth callback 路由

在 `src/router/index.ts` 新增：

```ts
{
  path: '/auth/callback',
  component: () => import('../components/AuthCallbackView.vue'),
}
```

### 2. 新增 AuthCallbackView.vue

新增 `src/components/AuthCallbackView.vue`。

职责：

- 读取 `code`、`error`、`error_description`、`next`。
- 如果 URL 有 `error`，显示失败状态。
- 如果 URL 有 `code`，调用：

```ts
await client.auth.exchangeCodeForSession(code)
```

- 如果没有 `code`，再兜底调用 `client.auth.getSession()`，兼容 `detectSessionInUrl` 已经处理过 session 的情况。
- 成功后清理 URL，并跳回 `next` 或 `/image`。

推荐 `next` 只允许同源路径，避免开放重定向：

```ts
function safeSameOriginPath(value: string | null) {
  if (!value) return '/image'
  const url = new URL(value, window.location.origin)
  return url.origin === window.location.origin
    ? `${url.pathname}${url.search}${url.hash}`
    : '/image'
}
```

### 3. 扩展 useAuthSession

在 `src/composables/useAuthSession.ts` 增加：

```ts
async function signInWithGitHub(next = window.location.pathname) {
  authError.value = null
  authNotice.value = null

  const client = await authClientOrNull()
  if (!client) return false

  const redirectTo = new URL('/auth/callback', window.location.origin)
  redirectTo.searchParams.set('next', next || '/image')

  const { error } = await client.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: redirectTo.toString(),
    },
  })

  if (error) {
    authError.value = error.message
    return false
  }

  return true
}
```

然后把 `signInWithGitHub` 暴露给 `AppShell.vue`。

### 4. 更新账号弹窗 UI

在 `src/views/AppShell.vue` 的账号弹窗里增加 GitHub 登录按钮。

推荐位置：

- 放在邮箱表单提交按钮上方或下方。
- 文案：`使用 GitHub 登录`
- 不替代邮箱登录，只作为另一种登录方式。

交互：

- 点击后调用 `signInWithGitHub(route.fullPath || '/image')`。
- GitHub OAuth 会离开当前页面，所以按钮只需要进入 loading/disabled 状态，不需要本地弹窗内完成登录。

### 5. 用户展示逻辑

当前 header 用 `userEmail` 展示账号。如果 GitHub 用户没有可用邮箱，后续可以增加 fallback：

```ts
const userLabel = computed(() => {
  return user.value?.email ||
    user.value?.user_metadata?.user_name ||
    user.value?.user_metadata?.preferred_username ||
    ''
})
```

第一阶段可以先继续用 `userEmail`，但测试时要确认 GitHub 授权后 Supabase 是否拿到了 email。

## 与历史保存的关系

不需要改数据库结构。

当前生成历史只需要保存 Supabase `user.id`：

- 邮箱/密码登录用户有 `user.id`
- GitHub 登录用户也有同一个 Supabase `user.id`
- 未登录用户继续留空

需要重点测试：

- 同一个邮箱先用邮箱注册，再用 GitHub 登录时，Supabase 是否按预期关联身份。
- 如果 GitHub 邮箱未公开，是否会创建一个独立账号。

这属于账号合并策略，建议上线前用测试账号验证，不要只看代码推断。

## 安全注意

- GitHub Client Secret 只能放在 Supabase provider 配置里。
- 前端 `.env` 只保留 Supabase URL 和 publishable/anon key。
- 不要申请 `repo`、`workflow` 等 GitHub 高权限 scope。
- OAuth 回调里的 `next` 必须做同源校验。
- 登录不是强制的，所以不要加全局路由守卫。
- 继续使用 Supabase `user.id` 做数据归属，不要用 `user_metadata` 做权限判断。

## 验证清单

配置完成后验证：

- `npm run build`
- `npm test`
- 直接访问 `/auth/callback?error=test` 能显示失败状态。
- 点击“使用 GitHub 登录”能跳到 GitHub 授权页。
- 授权成功后能回到 `/auth/callback`，再跳回原页面或 `/image`。
- Header 能显示登录状态。
- 退出登录后本地 session 被清理。
- 未登录生成图片时 `user_id` 仍为空。
- GitHub 登录生成图片时 `user_id` 为 Supabase 用户 ID。

## 推荐落地顺序

1. 先完成 GitHub OAuth App 和 Supabase provider 配置。
2. 在 Supabase Redirect URLs 增加 `/auth/callback`。
3. 新增 `AuthCallbackView.vue` 和 `/auth/callback` 路由。
4. 给 `useAuthSession` 增加 `signInWithGitHub`。
5. 在账号弹窗增加 GitHub 登录按钮。
6. 本地验证 OAuth 跳转和失败页。
7. 部署 Render 后验证生产域名登录。

## 官方参考

- [Supabase GitHub social login](https://supabase.com/docs/guides/auth/social-login/auth-github)
- [Supabase JavaScript auth signInWithOAuth](https://supabase.com/docs/reference/javascript/auth-signinwithoauth)
- [GitHub creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
