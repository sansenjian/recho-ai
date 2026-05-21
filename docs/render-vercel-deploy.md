# Render 全栈部署方案

> recho-ai 全部部署在 Render：Static Site（前端）+ Web Service（后端），一个平台管完。

---

## 架构总览

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

**为什么全部放 Render？**
- 当前网关用**内存滑动窗口**做速率限制，Render Web Service 是长驻进程，状态不会丢
- 前后端同一个平台，管理简单、日志集中看
- 免费额度够用：Static Site 100GB 带宽 + Web Service 750 小时/月
- 支持 `render.yaml` 一键部署两个服务

---

## 一、render.yaml 蓝图（一键部署）

在项目根目录创建 `render.yaml`，Render 会自动识别并创建两个服务：

```yaml
services:
  # ── 后端 API 网关 ──
  - type: web
    name: recho-gateway
    env: node
    rootDir: backend/gateway
    buildCommand: npm install
    startCommand: node index.js
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
| **Build Command** | `npm install` |
| **Start Command** | `node index.js` |
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

---

## 三、CORS 说明

`CORS_ORIGIN` 设为前端 Static Site 的域名 `https://recho-ai.onrender.com`。如果绑了自定义域名，记得更新这个值支持两个域名：

```js
// 后端 index.js 可改多点
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://recho-ai.onrender.com',
    'https://你的自定义域名.com',
  ]
}))
```

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
