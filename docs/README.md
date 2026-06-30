# Recho-AI 文档索引

> 这个目录里有当前主线文档，也有历史方案和阶段性讨论。优先阅读“当前主线”，再按需要查看迁移、部署或历史材料。

## 当前主线

| 文档 | 用途 | 状态 |
|---|---|---|
| [当前架构与目标架构](./recho-ai-architecture-current-and-target.md) | 单 Render Docker 后端、Node + Go sidecar 分工、生图快速返回、参考图压缩、管理员 API 配置 | 当前主线 |
| [Node.js 与 Go 网关未来分工分析](./gateway-division-analysis.md) | Node 和 Go 的职责取舍、迁移收益、为什么不全量 Go 重写 | 参考当前决策 |
| [Go Gateway Migration](./go-gateway-migration.md) | Go gateway 迁移步骤和本地运行说明 | 迁移参考 |

## 部署与运行

| 文档 | 用途 | 状态 |
|---|---|---|
| [Render 全栈部署方案](./render-vercel-deploy.md) | Render / Vercel 部署相关说明 | 需要按当前架构复核 |
| [后端架构规划](./backend-architecture.md) | 早期后端架构说明 | 历史参考 |

## 认证与账号

| 文档 | 用途 | 状态 |
|---|---|---|
| [Supabase GitHub 认证接入方案](./supabase-github-auth-plan.md) | GitHub OAuth 登录方案 | 参考 |
| [Supabase Auth email setup](./supabase-auth-email.md) | 邮箱认证配置 | 参考 |

## 前端与体验规划

| 文档 | 用途 | 状态 |
|---|---|---|
| [Vue Router 引入计划](./vue-router-adoption-plan.md) | Vue Router 页面结构规划 | 参考 |
| [Agent 平台体验规划](./agent-platform-roadmap.md) | Agent 工作台体验规划 | 历史/产品规划 |
| [Image Analytics Optimization Roadmap](./image-analytics-optimization-roadmap.md) | 图片分析与指标优化路线 | 参考 |
| [Dependency And Markdown Performance Plan](./dependency-and-markdown-performance-plan.md) | 依赖和 Markdown 性能优化计划 | 参考 |

## 历史方案

| 文档 | 用途 | 状态 |
|---|---|---|
| [Node 与 Go 网关职责规划](./node-go-architecture-plan.md) | 早期 Node/Go 拆分蓝图 | 已被当前架构文档修正，保留作历史对照 |

## 根目录文档

| 文档 | 用途 | 状态 |
|---|---|---|
| [README](../README.md) | 项目入口、命令、目录结构 | 当前入口 |
| [AGENTS](../AGENTS.md) | Codex / Claude 工作约定 | Agent 指令 |
| [CLAUDE](../CLAUDE.md) | Claude 工作约定 | Agent 指令 |
| [后端架构分析](../architecture-analysis.md) | 阶段性后端分析 | 历史参考 |
| [Go 网关演进讨论](../go-gateway-migration-discussion.md) | Go 迁移讨论记录 | 历史参考 |
| [shadcn-vue 迁移计划](../SHADCN_MIGRATION_PLAN.md) | UI 组件迁移计划 | 历史/阶段计划 |
| [报名帖](../recho-ai-报名帖.md) | 项目介绍与宣传文本 | 宣传材料 |

## 维护规则

- 当前架构事实以 [当前架构与目标架构](./recho-ai-architecture-current-and-target.md) 为准。
- 历史方案不要直接删除；如果已经被新文档替代，在索引里标注状态。
- 涉及真实路由、环境变量、RPC 名称、部署拓扑时，先核对代码和 `render.yaml`，不要只沿用旧文档。
- 新增文档优先放在 `docs/`，根目录只保留项目入口、agent 指令、宣传或临时讨论材料。
