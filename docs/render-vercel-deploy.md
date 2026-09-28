# Render 全栈部署方案

> 文档状态：历史部署参考，内容早于当前 Render Docker backend + Go sidecar 方案。
> 当前架构事实请先看 [Recho-AI 当前架构与目标架构](./recho-ai-architecture-current-and-target.md)。

> 当前推荐后端形态：一个 Render Docker Web Service 同时运行 Node Gateway 和 Go sidecar；不是单独创建 Node Web Service + Go Web Service。

---

## 历史架构总览

```
用户浏览器
    │
    ├── 静态资源 (HTML/JS/CSS)  ←  Render Static Site (免费)
    │                                        │
    └── POST /api/chat  ────────→  Render Web Service (免费, 不休眠)
                                            │
                                            ├── NVIDIA key pool (40次/分钟/key)
                                            ├── OpenAI
                                            └── Kimi
```

以下内容是早期 Node-only 部署思路，不代表当前推荐方案。当前推荐方案请以 [当前架构与目标架构](./recho-ai-architecture-current-and-target.md) 为准。

**当时为什么全部放 Render？**
- 当前网关用**内存滑动窗口**做速率限制，Render Web Service 是长驻进程，状态不会丢
- 前后端同一个平台，管理简单、日志集中看
- 免费额度够用：Static Site 100GB 带宽 + Web Service 750 小时/月
- 当时计划支持 `render.yaml` 一键部署前端静态站点和后端 Web Service

---

## 一、历史 render.yaml 蓝图（一键部署）

下面蓝图只适合追溯旧方案。当前后端应使用 Docker Web Service，同时运行 Node Gateway 和 Go sidecar。

```yaml
services:
  # ── 后端 API 网关 ──
  - type: web
    name: recho-gateway
    env: node
    rootDir: backend/gateway
    buildCommand: npm install && npm run build
    startCommand: npm start
    plan: free
    envVars:
      - key: NVIDIA_API_KEY
        sync: false
      - key: NVIDIA_BASE_URL
        value: https://integrate.api.nvidia.com/v1
      - key: CORS_ORIGIN
        value: https://recho-ai.onrender.com
      - key: PORT
        value: "3000"

  # ── 前端静态站点 ──
  - type: static
    name: recho-ai
    env: node
    rootDir: .
    buildCommand: npm install && npm run build
    staticPublishPath: dist
    envVars:
      - key: VITE_API_BASE_URL
        value: https://recho-gateway.onrender.com
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

> `sync: false` 表示该变量值敏感，不会在 Render 控制台回显，需手动填入真实 Key。

### 部署步骤

1. 把项目推送到 GitHub
2. 登录 [render.com](https://render.com)，点 **New + → Blueprint**
3. 连接仓库，Render 自动读取 `render.yaml`
4. 手动填入 `NVIDIA_API_KEY`（逗号分隔多 Key）
5. 点 **Apply**，两个服务同时部署

---

## 二、分开手动创建（不用 Blueprint）

### 2.1 后端 — Web Service

| 字段 | 值 |
|---|---|
| **Type** | Web Service |
| **Root Directory** | `backend/gateway` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Plan** | Free |

环境变量：

```
NVIDIA_API_KEY   = key1,key2,key3
NVIDIA_BASE_URL  = https://integrate.api.nvidia.com/v1
CORS_ORIGIN      = https://recho-ai.onrender.com  （前端部署后填）
PORT             = 3000
```

### 2.2 前端 — Static Site

| 字段 | 值 |
|---|---|
| **Type** | Static Site |
| **Root Directory** | `.`（项目根目录） |
| **Build Command** | `npm install && npm run build` |
| **Publish Directory** | `dist` |

环境变量：

```
VITE_API_BASE_URL = https://recho-gateway.onrender.com  （后端部署后填）
```

手动创建 Static Site 时，`render.yaml` 里的 `routes` 不会自动套到这个服务上。必须在 Render 控制台进入前端 Static Site 的 **Redirects/Rewrites**，新增：

| 字段 | 值 |
|---|---|
| **Source Path** | `/*` |
| **Destination Path** | `/index.html` |
| **Action** | `Rewrite` |

没有这条规则时，`/image`、`/works`、`/auth/confirm?...` 这类 Vue Router history mode 深链接会直接返回 Render 的 `404 Not Found`。

项目的 `npm run build` 还会在 `dist` 里额外生成几个关键路由的 `index.html` 兜底副本，但正式生产仍建议保留 Render rewrite，因为它能覆盖未来新增的所有前端路由。

---

## 三、CORS 说明

`CORS_ORIGIN` 是逗号分隔的白名单，每一段可以是三种写法之一（实现见 `backend/gateway/src/cors-origin.ts`）：

| 写法 | 例子 | 说明 |
| :--- | :--- | :--- |
| 精确域名 | `https://recho.sansenjian.asia` | 完全相等才放行 |
| 通配 | `https://*.example.com` | `*` 只跨一个主机名标签，不会跨 `.`，因此无法被 `https://x.example.com.evil.test` 绕过 |
| 正则 | `re:^https://recho-[a-z0-9-]+-team\.vercel\.app$` | `re:` 前缀，其余部分作为正则源码 |

> `re:` 条目里的逗号默认仍是**配置分隔符**。只有三类逗号会被当成正则的一部分保留：转义写法 `\,`、字符类 `[a,b]`、量词 `{1,32}`（见 `splitCorsOriginEntries`）。所以正则里要匹配字面逗号时请写成 `\,`。

线上当前的值（`render.yaml`）：

```yaml
- key: CORS_ORIGIN
  value: 'https://recho-ai.onrender.com,https://recho.sansenjian.asia,https://recho-ai.vercel.app,http://localhost:5173,http://localhost:5174,re:^https://recho-[a-z0-9-]+-sansenjians-projects\.vercel\.app$'
```

最后一条正则用来覆盖 **Vercel 预览/部署域名**：Vercel 每次部署都会生成一个全新主机名（例如 `recho-ai-git-feat-workspace-chat-pa-4b55ff-sansenjians-projects.vercel.app`，其中分支名被截断到 63 字符 DNS 标签上限、还带一段随机 hash），**无法用固定域名逐一枚举**，只能按模式放行。该正则只匹配本 team（`sansenjians-projects`）下 `recho-` 前缀的项目，不会放开整个 `*.vercel.app`。

> ⚠️ 不要把 Vercel 的 `/api` 反代到网关（即不要在 `vercel.json` 里写 `/api/:path*` → 网关）。`/api/chat` 是 `text/event-stream` 流式响应，Vercel 的 rewrite 代理会缓冲 SSE 并约 30 秒切断连接，对话打字机会卡死。正确做法是让浏览器用 `VITE_API_BASE_URL` **直连**网关，因此 CORS 白名单必须包含前端域名。

绑定自定义域名后记得把新域名也加进这个值并重新部署后端。

---

## 四、免费计划额度

| 服务 | 类型 | 限制 |
|---|---|---|
| **recho-gateway** | Web Service | 750 小时/月，512 MB 内存，不休眠 |
| **recho-ai** | Static Site | 100 GB 带宽/月，无限请求 |

> 750 小时/月 = 24h × 31 天，刚好跑满。**两个服务不共享额度**，各自独立计算。

---

## 五、成本

| 项目 | 费用 |
|---|---|
| Render Web Service | $0 |
| Render Static Site | $0 |
| **总计** | **$0/月** |

---

## 六、发布流程

```
git push origin main
```

Render 自动检测变更并分别部署：
- `backend/gateway/` 有变更 → 重新部署 Web Service
- 前端文件有变更 → 重新 build 并部署 Static Site

---

## 七、自定义域名

1. 在 Render 控制台，给 Static Site 绑定你的域名（如 `chat.example.com`）
2. DNS 添加 CNAME 记录指向 `recho-ai.onrender.com`
3. 更新后端 `CORS_ORIGIN` 加上新域名，重新部署

---

## 八、后续优化

| 优化项 | 说明 |
|---|---|
| **UptimeRobot 监控** | 加到 Web Service 上，保活 + 告警 |
| **Redis 替代内存计数** | 如果以后多实例扩容，用 Upstash Redis 替换内存 RateLimiter |
| **自定义域名 + CDN** | Static Site 本身就走 Render CDN，绑域名后自动生效 |
| **Render 日志** | 控制台自带日志查看，$0 套餐保留 7 天 |
