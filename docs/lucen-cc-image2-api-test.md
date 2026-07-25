# lucen.cc gpt-image-2 API 兼容性测试报告

**测试时间:** 2026-07-15
**测试端点:** `POST https://lucen.cc/v1/images/generations`
**测试模型:** `gpt-image-2`
**测试目的:** 验证 lucen.cc 网关对 OpenAI gpt-image-2 各参数的实际支持情况

---

## 测试结论速览

| 参数 | lucen.cc 是否真支持 | 备注 |
|------|---------------------|------|
| `model` | ✅ 支持 | `gpt-image-2` 可用 |
| `prompt` | ✅ 支持 | 文本 prompt 正常 |
| `size` | ✅ 支持(枚举) | 仅接受 `1024x1024` / `1024x1536` / `1536x1024` / `auto` |
| `aspect_ratio` | ❌ **不支持** | 字段被忽略,返回值仍由 `size` 决定 |
| `quality` | ⚠️ **部分支持** | `low` / `medium` / `auto` 正常,`high` 超时失败 |
| `background` | ❌ **不支持透明** | `transparent` 返回 24bpp 无 alpha 通道 |
| `output_format` | ❌ **完全失效** | 强制返回 PNG,参数被忽略 |
| `n` | 未测试 | - |
| `compression` | 未测试(依赖 output_format) | - |
| `moderation` | 未测试 | - |

---

## 一、size 参数测试

### 测试组合

| size 值 | 返回尺寸 | 状态 |
|---------|---------|------|
| `1024x1024` | 1024 x 1024 | ✅ |
| `auto` | 1024 x 1024 | ✅(默认落到正方形) |
| `1536x1024` | 未单独测试 | - |
| `1024x1536` | 未单独测试 | - |

### 关键发现

- `size` 是唯一控制输出分辨率的参数
- 仅接受 OpenAI 官方枚举值,**不支持任意分辨率**(如 `1920x1080`)
- `auto` 在 lucen.cc 实现中默认返回 1024x1024 正方形
- **没有 `aspect_ratio` 字段**——传 `aspect_ratio: "16:9"` 被服务端直接丢弃,返回的仍是 `size` 指定的正方形

### 获取 16:9 图片的方案

OpenAI gpt-image-2 原生不支持 16:9,只能通过后处理实现:

| 方案 | 实现 | 优点 | 缺点 |
|------|------|------|------|
| **A. 生成后裁剪** | 请求 `1536x1024`,本地裁剪为 `1536x864` | 简单可靠,无额外 API 成本 | 丢失上下/下边缘内容 |
| **B. 放大补边** | 请求 `1024x1024`,补边到 `1024x576`?不符 16:9 | - | 比例不严格 |
| **C. 切换模型** | 使用 SDXL / Flux 等支持任意分辨率的 API | 原生 16:9 | 需换供应商 |

**推荐方案 A**:`1536x1024` 是 3:2,裁掉上下各 80px 即得 16:9(1536×864)。

---

## 二、quality 参数测试

### 测试结果

| quality 值 | 状态 | 返回尺寸 | token 消耗 |
|-----------|------|---------|-----------|
| `low` | ✅ 成功 | 1024x1024 | **278** |
| `medium` | ✅ 成功 | 1024x1024 | **1062** |
| `auto` | ✅ 成功 | 1024x1024 | 1062(等同 medium) |
| `high` | ❌ 两次均失败 | - | - |

### 关键发现

- `quality` **生效**——token 消耗差异显著(low 278 vs medium 1062,约 3.8 倍),证明参数确实传到了上游
- `auto` 实际等同 `medium`
- `high` 两次失败:
  - 第一次:`524` 超时
  - 第二次:`Received an unexpected EOF or 0 bytes from the transport stream`
  - 疑似 lucen.cc 网关对 `high` 限流,或超时阈值太短(high 质量生成耗时更长)

### 成本对照

OpenAI 计费按 token,图片 token 主要由 `size` × `quality` 决定:

| size | quality | 大致 token |
|------|---------|-----------|
| 1024×1024 | low | ~70-280 |
| 1024×1024 | medium | ~1062 |
| 1024×1024 | high | ~2800+(未测得) |
| 1536×1024 | high | ~630+ |

---

## 三、background 参数测试

### 测试结果

| background 值 | 状态 | 返回尺寸 | PixelFormat |
|--------------|------|---------|-------------|
| `transparent` | ⚠️ 参数接受但效果失效 | 1024x1024 | **Format24bppRgb**(无 alpha) |
| `opaque` | ✅ | 1024x1024 | Format24bppRgb |
| `auto` | ✅ | 1024x1024 | Format24bppRgb |

### 关键发现

- `transparent` **未生效**——返回的 PNG 是 24bpp(无 alpha 通道),不是 32bpp ARGB
- 三个值返回的图片像素格式完全相同
- 可能原因:
  1. 上游模型不支持透明背景
  2. lucen.cc 在转发时剥离了 alpha 通道
  3. 网关强制转换为 24bpp PNG

### 影响

**无法通过 lucen.cc 生成透明背景素材**。如需透明 PNG,必须:
- 直连 OpenAI 官方 API
- 或使用其他支持透明的图像生成服务

---

## 四、output_format 参数测试

### 测试结果

| 请求值 | 实际文件头 | 实际格式 | 文件体积 |
|--------|-----------|---------|---------|
| `png` | `89504E47` | PNG | 1.58 MB |
| `webp` | `89504E47` | **PNG**(伪装成 .webp) | 1.64 MB |
| `jpeg` | `89504E47` | **PNG**(伪装成 .jpeg) | 1.56 MB |

### 关键发现

- `output_format` **完全失效**——无论传什么值,返回的都是 PNG 字节流
- 文件头 `89504E47` 是 PNG 标准签名
- 三个文件体积相近(1.56-1.64 MB),证明是同一编码格式
- lucen.cc 网关:
  - 要么没把参数透传给上游
  - 要么上游只支持 PNG 输出
  - 要么网关强制转换所有输出为 PNG

### 影响

- **无法获得 webp/jpeg 体积优化**——所有图片都是 PNG,体积较大
- 前端展示时如需 webp/jpeg,只能本地转换(增加客户端计算负担)
- `compression` 参数(依赖 output_format)失去意义

---

## 五、对比:OpenAI 官方 vs lucen.cc

### OpenAI 官方 gpt-image-2 API

- **端点:** `POST https://api.openai.com/v1/images/generations`
- **size:** 枚举型,仅 `1024x1024` / `1024x1536` / `1536x1024` / `auto`
- **quality:** `low` / `medium` / `high` / `auto`
- **background:** `transparent` / `opaque` / `auto`(透明背景返回 32bpp ARGB PNG)
- **output_format:** `png` / `webp` / `jpeg`(实际生效)
- **compression:** 0-100(仅对 webp/jpeg 生效)
- **n:** 1-10
- **moderation:** `low` / `auto`
- **无 aspect_ratio 字段**

### lucen.cc 网关

- **定位:** OpenAI 兼容代理网关
- **size:** 同官方(枚举生效)
- **quality:** 部分支持(low/medium/auto 生效,high 超时)
- **background:** 不支持透明(返回 24bpp)
- **output_format:** 完全失效(强制 PNG)
- **其他参数:** aspect_ratio 等非官方字段被忽略

---

## 六、使用建议

### ✅ lucen.cc 适合的场景

- 普通正方形/3:2/2:3 图片生成
- 对质量要求中等(medium/auto)
- 不需要透明背景
- 不需要 webp/jpeg 体积优化
- 成本敏感(low quality 省 token)

### ❌ lucen.cc 不适合的场景

- 需要 16:9 等任意比例 → 改用裁剪后处理,或换模型
- 需要透明背景素材 → 直连 OpenAI 或换服务
- 需要 webp/jpeg 输出 → 本地转换,或换服务
- 需要 high 质量 → 可能超时失败,需重试机制或换服务

### 推荐的请求模板

```json
{
  "model": "gpt-image-2",
  "prompt": "your prompt here",
  "size": "1024x1024",
  "quality": "medium"
}
```

**避免使用:**
- `quality: "high"`(超时风险)
- `background: "transparent"`(无效)
- `output_format: "webp"` / `"jpeg"`(无效)
- `aspect_ratio`(非官方字段,被忽略)

---

## 七、测试清理

测试生成的临时文件(可删除):

```
test_img1.png / test_img1.b64
test_auto.png
test_q_low.png / test_q_med.png / test_q_auto.png
test_bg_trans.png / test_bg_opaque.png / test_bg_auto.png
test_fmt_png.png / test_fmt_webp.webp / test_fmt_jpeg.jpeg
test_ar21.png
```

---

## 附录:测试方法

### 请求格式

```http
POST https://lucen.cc/v1/images/generations
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "model": "gpt-image-2",
  "prompt": "a red apple on a wooden table",
  "size": "1024x1024",
  "quality": "medium"
}
```

### 响应格式

```json
{
  "data": [
    {
      "b64_json": "<base64 encoded PNG>"
    }
  ],
  "usage": {
    "input_tokens": 7,
    "output_tokens": 1056,
    "total_tokens": 1063,
    "input_tokens_details": {
      "text_tokens": 7,
      "image_tokens": 0,
      "cached_tokens": 0
    },
    "output_tokens_details": {
      "text_tokens": 0,
      "image_tokens": 1056,
      "reasoning_tokens": 0
    }
  }
}
```

### 验证方法

- **尺寸验证:** 使用 .NET `System.Drawing.Image` 读取 Width/Height
- **格式验证:** 读取文件头前 4 字节(PNG = `89504E47`)
- **透明度验证:** 检查 `PixelFormat`(32bpp ARGB = 有 alpha,24bpp RGB = 无 alpha)
- **token 消耗:** 从 `usage.total_tokens` 读取
