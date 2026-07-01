# recho-ai 后端架构演进讨论整理

> 文档状态：历史讨论记录。当前主线以 [docs/recho-ai-architecture-current-and-target.md](./docs/recho-ai-architecture-current-and-target.md) 为准。
> 本文用于保留当时的方案比较，不代表最终职责边界。

## 当前架构：双网关并行

recho-ai 后端目前包含两个并行网关：

```text
backend/
├── gateway/          # Node.js + Express，当前默认入口（端口 3000）
└── go-gateway/       # Go，性能优化补充（端口 3001）
```

Node 网关负责聊天流、MCP 工具调用、技能加载、管理后台等复杂逻辑；Go 网关正在逐步承接图片生成、图片历史、额度查询等对冷启动和内存敏感的路由。这不是微服务架构，而是**模块化单体 + 双网关分流**的过渡形态。

## 这是否是微服务

不是。微服务的核心特征是多个独立部署的服务围绕清晰的业务域拆分，每个服务拥有独立的数据库和发布节奏。recho-ai 的 Node 与 Go 网关共享同一套数据库和用户体系，本质上是同一应用的两个运行时入口，彼此是替代关系而非业务互补关系。

## 微服务适用时机

微服务用复杂度换可扩展性，引入前需要同时满足多数条件：

| 条件 | recho-ai 当前状态 |
|------|------------------|
| 多团队并行开发不同业务域 | 不满足 |
| 业务边界清晰、跨域调用少 | 部分满足，聊天/图片/管理职责分明但数据耦合强 |
| 各子域负载差异巨大 | 部分满足，图片生成与聊天流式特征不同 |
| 部署节奏差异显著 | 不明显 |
| 具备服务发现、可观测性、灰度发布等基础设施 | 未体现 |
| 单体优化已无法解决性能瓶颈 | 不满足，Go 网关迁移本身就是优化 |

当前项目**不满足引入微服务的典型条件**。核心矛盾是 Node 网关性能差，这个矛盾通过 Go 网关迁移已经可以得到有效解决。

## 三种候选架构对比

### 方案 A：维持 Node.js 单网关

适合团队小、聊天/MCP 迭代频繁、对成本不敏感的场景。优点是技术栈统一，缺点是 Render 冷启动慢、内存占用高。

### 方案 B：Go 网关为主，Node 网关为侧车（当前方向）

适合性能痛点明确但复杂逻辑尚未稳定的阶段。图片、额度等路由获得 Go 的性能优势，聊天/MCP 等保留在 Node，迁移风险可控。缺点是两套网关并存会带来鉴权、错误格式、部署复杂度上升。

### 方案 C：按业务域拆微服务

适合团队扩张、各子域数据边界清晰、独立扩缩容需求强烈的阶段。recho-ai 当前业务域数据强耦合，拆分成本高于收益。

## 推荐演进路径

### 短期（1-2 个月）

把图片相关 API 全部切到 Go 网关：

- `/api/image/history/*`
- `/api/image/generate`
- `/api/image/references`

同时验证 Go 与 Node 的响应等价性（错误码、鉴权失败行为、COS 公开作品访问权限），Node 继续负责聊天流、MCP、技能、管理后台。

### 中期（2-6 个月）

- 若 MCP 工具调用逻辑稳定，评估在 Go 侧重写 MCP 能力。
- 管理后台的只读/轻量接口优先迁到 Go，写操作保留 Node。
- 引入统一网关层（如 Nginx / Traefik），由它按路径路由到 Node 或 Go，前端不再感知多个 base URL。

### 长期（6 个月后）

推荐路径：Go 网关完全替代 Node 网关，下线 Node 服务，形成单一 Go 网关的模块化单体。若聊天/MCP 持续快速迭代且 Go 重写不划算，可保留双服务，但需把边界固化、文档化、监控补齐。

暂不建议直接拆聊天/图片/管理后台为三个微服务，也不建议为微服务引入 Kubernetes、服务网格等重型基础设施。

## 图片存储是否应该放在 Go

如果图片生成已经放在 Go，那么**图片上传/存储最好也在 Go 完成**。否则 Go 生成完图片后还要把二进制回传给 Node 再上传，会多一次内部转发、增加延迟和失败点，也失去 Go 低内存的优势。

但当前 Go 侧存储能力弱于 Node：

| 能力 | Node.js | Go |
|------|---------|-----|
| Supabase Storage | 完整 SDK + bucket 管理 | REST API 上传 |
| Tencent COS | 完整支持 | 未实现 |
| sharp 图片处理 | 完整 | 未实现 |
| Preview / Thumbnail | 支持 | 未实现 |
| Public URL 缓存 | 支持 | 未实现 |
| 删除对象 | 支持 | 未实现 |

当前图片存储能力已补齐到 Go 网关（含 libvips 图片处理、S3 上传、缩略图生成、Public URL 缓存、对象删除等），图片生成与存储已整体迁移到 Go 网关完成。以下为历史过渡方案记录，仅供参考。

## Go 的图片处理能力

Go 的图片处理能力足够用，但要达到 sharp 级别需要引入 libvips 绑定：

| 方案 | 代表库 | 性能 | 部署 |
|------|--------|------|------|
| 标准库 | `image` | 一般 | 零依赖 |
| 纯 Go 增强库 | `github.com/disintegration/imaging` | 中等 | 零依赖 |
| libvips 绑定 | `github.com/davidbyttow/govips/v2` | 高 | 需 C 库 |

sharp 本身就是 libvips 的 Node 封装。Go 要达到同等性能，推荐 `govips` 或 `bimg`。纯 Go 方案部署更简单，但处理大图片时 CPU 和内存效率不如 libvips。

项目当前 Node 侧的核心需求（PNG 转无损 WebP、生成 preview、生成 480px thumbnail、读取宽高元数据）用 Go + libvips 都能实现。

## 内存影响

把图片处理迁到 Go 后：

- **Go 网关单进程内存**：会上升，因为它原来只做 API 转发，现在要处理图片。
- **整个后端总内存**：基本不会变大，甚至冷启动时更小，因为 Node 网关不再处理图片二进制。
- **峰值内存风险**：如果 Go 用纯 Go 标准库处理大图片，会把整图解码到内存，可能临时冲高；使用 libvips 绑定并限制并发可避免这个问题。

```go
semaphore := make(chan struct{}, 5) // 最多同时处理 5 张
```

推荐监控 Go 进程的内存峰值，观察实际负载后再调整并发度。

## 图片上传技术选型

图片经 libvips 处理后，推荐用 **AWS SDK for Go v2** 上传到对象存储：

```bash
cd backend/go-gateway
go get github.com/aws/aws-sdk-go-v2/config
go get github.com/aws/aws-sdk-go-v2/service/s3
```

原因是 Supabase Storage 和 Tencent COS 都兼容 S3 协议，Node 端也已经在用 AWS S3 SDK 访问 COS。统一用 S3 SDK 可以一套代码支持两个存储后端。

### 核心实现思路

```go
import (
    "github.com/aws/aws-sdk-go-v2/aws"
    "github.com/aws/aws-sdk-go-v2/credentials"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

func NewS3Client(endpoint, region, accessKey, secretKey string) *s3.Client {
    return s3.New(s3.Options{
        BaseEndpoint: aws.String(endpoint),
        Region:       region,
        Credentials:  aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
    })
}
```

Supabase Storage endpoint 格式为 `${SUPABASE_URL}/storage/v1/s3`，COS endpoint 格式为 `https://cos.${region}.myqcloud.com`。

### 上传方式

图片通常不大，直接 `PutObject` 即可：

```go
_, err := client.PutObject(ctx, &s3.PutObjectInput{
    Bucket:       aws.String(bucket),
    Key:          aws.String(key),
    Body:         bytes.NewReader(data),
    ContentType:  aws.String("image/webp"),
    CacheControl: aws.String("max-age=31536000"),
})
```

只有未来上传视频或超大文件时才需要考虑 multipart 分片上传。

## 完整图片处理与上传流程

目标形态下，一次图片生成的后端流程应为：

```text
Go 网关
  ├─ 调用图片生成 API，获取图片 bytes
  ├─ libvips 处理：转 WebP、生成 preview、生成 thumbnail
  ├─ 并发上传原图 / preview / thumbnail 到 S3 兼容存储
  ├─ 写入 image_generations 数据库记录
  └─ 返回 public URL
```

Node 网关不再参与图片链路，只负责聊天、MCP、技能、管理后台。

## 风险点

1. **响应等价性**：Go 与 Node 的错误格式、鉴权失败行为、公开作品访问权限必须一致。
2. **数据一致性**：图片生成涉及额度扣减、记录写入、事件上报，两侧原子语义要对齐。
3. **鉴权同步**：Supabase JWT 校验逻辑在 Node（`request-auth.ts`）和 Go（`middleware/auth.go`）中各有一份，规则变更需同步。
4. **测试覆盖**：Go 侧测试少于 Node，迁移过程中需补充单元测试和接口契约测试。
5. **Public URL 缓存**：Go 侧应补上 LRU 缓存，避免重复拼接字符串带来的微小开销。

## 结论

recho-ai 当前最合理的方向是**继续用 Go 网关逐步替代 Node 网关，最终形成单一 Go 网关的模块化单体**。微服务不是当前阶段需要考虑的方案。

图片链路应整体收敛到 Go：图片生成、libvips 处理、S3 上传、历史记录写入都在 Go 完成。短期内若 Go 侧存储能力未补齐，可采用"Go 生成 + Node 存储"过渡，但中长期要尽快补齐 COS、缩略图、缓存、删除等能力，避免一张图片的生命周期跨两个服务。
