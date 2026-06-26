# Recho AI — shadcn-vue 渐进式迁移计划

## 概述

本文档描述如何将 recho-ai 的 29 个手写 Vue 组件逐步迁移到 [shadcn-vue](https://www.shadcn-vue.com/)，同时引入 Tailwind CSS v4 和深色/浅色双主题系统。迁移分 5 个阶段进行，每个阶段独立可用，新旧组件可以共存。

---

## 一、基础设施搭建

### 1.1 安装依赖

```bash
# 安装 Tailwind CSS v4 + PostCSS
npm install -D tailwindcss @tailwindcss/vite

# 安装 shadcn-vue CLI
npx shadcn-vue@latest init
```

初始化时选择：
- **TypeScript**: Yes
- **Base color**: Slate（后续自定义覆盖）
- **CSS variables**: Yes（双主题依赖此特性）

### 1.2 配置 vite.config.ts

```ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
})
```

### 1.3 配置 tsconfig 路径别名

在 `tsconfig.app.json` 中添加：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 1.4 安装 shadcn-vue 核心组件

按阶段需要逐步安装，一次性列出：

```bash
# 阶段一
npx shadcn-vue@latest add button input textarea badge avatar scroll-area separator tooltip

# 阶段二
npx shadcn-vue@latest add sheet dropdown-menu dialog popover select command context-menu

# 阶段三
npx shadcn-vue@latest add card collapsible tabs progress skeleton

# 阶段四
npx shadcn-vue@latest add slider toggle toggle-group resizable

# 阶段五
npx shadcn-vue@latest add table alert toast
```

---

## 二、双主题系统

### 2.1 CSS 变量方案

在 `src/assets/css/globals.css` 中配置，保持品牌色 `#16a34a` 和字体不变：

```css
@import "tailwindcss";

@layer base {
  :root {
    /* === Recho 品牌色 === */
    --background: 0 0% 96.1%;        /* #f4f7fb */
    --foreground: 222.2 84% 4.9%;     /* #0f172a */

    --card: 0 0% 100%;                /* #ffffff */
    --card-foreground: 222.2 84% 4.9%;

    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;

    --primary: 142.1 76.2% 36.3%;     /* #16a34a 品牌绿 */
    --primary-foreground: 355.7 100% 97.3%;

    --secondary: 210 40% 96.1%;       /* #f8fafc */
    --secondary-foreground: 222.2 47.4% 11.2%;

    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%; /* #64748b */

    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;

    --destructive: 0 84.2% 60.2%;     /* #dc2626 */
    --destructive-foreground: 210 40% 98%;

    --border: 214.3 31.8% 91.4%;      /* #dbe3ee */
    --input: 214.3 31.8% 91.4%;
    --ring: 142.1 76.2% 36.3%;        /* 品牌绿 ring */

    --radius: 0.5rem;

    /* === 字体 === */
    --font-sans: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
  }

  .dark {
    --background: 222.2 84% 4.9%;     /* #0f172a */
    --foreground: 210 40% 98%;

    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;

    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;

    --primary: 142.1 70.6% 45.3%;     /* 深色模式下调亮的绿 */
    --primary-foreground: 144.9 80.4% 10%;

    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;

    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;

    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;

    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;

    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 142.1 70.6% 45.3%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
}
```

### 2.2 主题切换逻辑

创建一个 `useTheme` composable：

```ts
// src/composables/useTheme.ts
import { ref, watch } from 'vue'

type Theme = 'light' | 'dark' | 'system'

const theme = ref<Theme>('system')
let mediaQuery: MediaQueryList | null = null

function applyTheme(t: Theme) {
  const root = document.documentElement

  // 切换主题时移除旧监听，避免重复绑定
  if (mediaQuery) {
    mediaQuery.removeEventListener('change', onSystemThemeChange)
    mediaQuery = null
  }

  if (t === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', isDark)
    // 监听 OS 主题变化，实时同步 dark class
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', onSystemThemeChange)
  } else {
    root.classList.toggle('dark', t === 'dark')
  }
}

function onSystemThemeChange(e: MediaQueryListEvent) {
  document.documentElement.classList.toggle('dark', e.matches)
}

export function useTheme() {
  watch(theme, applyTheme, { immediate: true })
  return { theme, applyTheme }
}
```

在 `App.vue` 中调用 `useTheme()`，并在 header 中添加主题切换按钮。

### 2.3 渐进式共存策略

迁移期间，旧的 CSS 变量（`--bg`, `--surface` 等）和新的 shadcn-vue 变量并行存在。建议做法：

1. 在 `style.css` 顶部 import 新的 `globals.css`
2. 旧的 `:root` 变量暂时保留，供未迁移的组件使用
3. 每迁移一个组件，就移除其 `<style scoped>` 块，改用 Tailwind class + shadcn-vue 组件
4. 当所有组件迁移完成后，删除 `style.css` 中的旧 `:root` 变量

---

## 三、组件映射表

### 阶段一：核心聊天组件

| 现有组件 | UI 模式 | shadcn-vue 替换方案 | 保留的自定义逻辑 |
|---------|---------|-------------------|----------------|
| **ChatHeader.vue** | 顶部导航栏、图标按钮、状态 pill、品牌标识 | `<Button variant="ghost">` 替换 `.icon-btn`；`<Badge variant="secondary">` 替换 `.status-pill`；`<Separator>` 替换品牌分割线 | 品牌布局、ContextMeter 嵌入、响应式隐藏逻辑 |
| **ChatInput.vue** | 自增 textarea、模型选择下拉、技能斜杠命令、图片预览、发送/停止按钮 | `<Textarea>` 替换 `.chat-input`；`<Popover>` + `<Command>` 替换 `.model-dropdown` 和 `.skill-dropdown`；`<Button>` 替换发送/停止按钮 | 斜杠命令解析逻辑、auto-resize textarea、键盘导航 |
| **ChatMessage.vue** | 消息气泡、AI 头像、markdown 渲染、复制/重试按钮 | `<Avatar>` 替换 `.assistant-avatar`；`<Button variant="ghost" size="icon">` 替换操作按钮；`<Separator>` 分隔消息块 | markdown 渲染、消息块（thinking/tool/text）编排 |
| **StreamingStatus.vue** | 加载指示器、计时器 | `<Badge variant="outline">` 替换外壳；自定义 SVG 动画保留 | 计时器逻辑、状态标签计算 |

### 阶段二：布局与导航

| 现有组件 | UI 模式 | shadcn-vue 替换方案 | 保留的自定义逻辑 |
|---------|---------|-------------------|----------------|
| **ChatSidebar.vue** | 侧边栏面板、搜索、分组列表、拖拽、右键菜单 | `<Sheet>` 替换移动端侧边栏；`<ScrollArea>` 替换列表滚动；`<ContextMenu>` 替换右键菜单；`<Input>` 替换搜索框 | 分组拖拽排序逻辑、会话管理 |
| **AppShell.vue** | 应用外壳、面板切换、认证对话框、系统提示编辑器、拖放区 | `<Dialog>` 替换 `.auth-dialog`；`<Sheet>` 替换系统提示编辑器面板；`<Textarea>` 替换编辑器 | 认证逻辑、工作区切换、拖放图片处理、键盘快捷键 |
| **AnnouncementPopup.vue** | 公告弹窗 | `<Dialog>` 或 `<AlertDialog>` | 公告获取和标记已读逻辑 |

### 阶段三：Agent 与工具活动

| 现有组件 | UI 模式 | shadcn-vue 替换方案 | 保留的自定义逻辑 |
|---------|---------|-------------------|----------------|
| **AgentWorkspace.vue** | 模式切换面板、技能列表 | `<Tabs>` 替换模式切换；`<Card>` 替换技能卡片；`<ScrollArea>` | 模式/技能选择逻辑 |
| **ToolActivity.vue** | 工具调用状态展示（运行中/已完成） | `<Collapsible>` 替换折叠/展开；`<Badge>` 替换状态标签；`<Card>` 替换容器 | 工具调用状态管理、结果展示 |
| **ThinkingActivity.vue** | AI 思考过程展示 | `<Collapsible>` 替换折叠；`<Badge variant="outline">` 替换标签 | 内容截断/展开逻辑 |
| **ContextMeter.vue** | 上下文用量环形指示器 | `<Tooltip>` 替换 title 提示；保留自定义 `conic-gradient` 环形 | token 估算逻辑、颜色阈值 |

### 阶段四：图像画布

| 现有组件 | UI 模式 | shadcn-vue 替换方案 | 保留的自定义逻辑 |
|---------|---------|-------------------|----------------|
| **ImageCanvas.vue** | 画布主视图、模式切换 | `<Tabs>` 替换工作区模式切换；`<Resizable>` 替换面板分割 | 画布交互逻辑 |
| **ImageCanvasNode.vue** | 画布节点 | 保留自定义实现（画布节点不适合通用组件替换） | 节点拖拽、缩放、连线 |
| **ImageCanvasSidebar.vue** | 画布侧边栏 | `<Sheet>` / `<ScrollArea>` | 图片历史列表 |
| **ImageCanvasBottomToolbar.vue** | 底部工具栏 | `<Toggle>` / `<ToggleGroup>` 替换工具按钮；`<Tooltip>` | 工具栏逻辑 |
| **ImageCanvasContextMenu.vue** | 画布右键菜单 | `<ContextMenu>` | 自定义菜单项 |
| **ImageCanvasStageActions.vue** | 阶段操作按钮组 | `<Button>` / `<DropdownMenu>` | 阶段操作逻辑 |
| **ImageCanvasGalleryStage.vue** | 画廊阶段视图 | `<ScrollArea>` + 自定义网格 | 画廊布局 |
| **ImageGalleryCard.vue** | 画廊卡片 | `<Card>` | 卡片交互 |
| **ImageGalleryDetailModal.vue** | 画廊详情弹窗 | `<Dialog>` | 图片详情展示 |
| **ImageViewerModal.vue** | 图片查看器弹窗 | `<Dialog>` | 图片缩放/下载 |
| **ImagioView.vue** | Imagio 视图 | 保留自定义实现 | 图像生成流程 |
| **ImagioSidebar.vue** | Imagio 侧边栏 | `<Sheet>` / `<ScrollArea>` | 生成历史 |

### 阶段五：管理后台

| 现有组件 | UI 模式 | shadcn-vue 替换方案 | 保留的自定义逻辑 |
|---------|---------|-------------------|----------------|
| **AdminView.vue** | 管理仪表板 | `<Tabs>` 替换面板切换；`<Card>` 替换统计卡片 | 管理逻辑 |
| **AdminImagesPanel.vue** | 图片管理表格 | `<Table>` / `<DataTable>` | 筛选、分页、操作 |
| **AdminImageAttemptsPanel.vue** | 尝试记录表格 | `<Table>` / `<DataTable>` | 记录查询 |

---

## 四、分阶段实施步骤

### 阶段一：基础设施 + 核心聊天（建议 2-3 天）

**步骤 1**: 安装 Tailwind CSS + shadcn-vue（参见第一节）

**步骤 2**: 配置双主题 CSS 变量（参见第二节）

**步骤 3**: 迁移 ChatHeader
- 将 `.icon-btn` → `<Button variant="ghost" size="icon">`
- 将 `.status-pill` → `<Badge variant="secondary">`
- 将品牌分割线 → `<Separator orientation="vertical">`
- 保留 ContextMeter 嵌入和响应式逻辑
- 移除 `<style scoped>` 中的对应样式

**步骤 4**: 迁移 ChatInput
- 将 `.chat-input` textarea → shadcn-vue `<Textarea>` + auto-resize 逻辑
- 将 `.model-dropdown` → `<Popover>` + `<Command>` 组合（支持搜索过滤）
- 将 `.skill-dropdown` → `<Popover>` + `<Command>` 组合
- 将 `.send-btn` / `.stop-btn` → `<Button size="icon">`
- 保留斜杠命令解析、键盘导航逻辑
- 图片预览区域保留自定义实现

**步骤 5**: 迁移 ChatMessage
- 将 `.assistant-avatar` → `<Avatar>` + `<AvatarFallback>`
- 将操作按钮 → `<Button variant="ghost" size="icon">`
- 保留 markdown 渲染和消息块编排

**步骤 6**: 迁移 StreamingStatus
- 将外壳 → `<Badge variant="outline">`
- 保留 SVG 动画和计时器逻辑

### 阶段二：布局与导航（建议 1-2 天）

- AppShell 中的 auth dialog → `<Dialog>`
- 系统提示编辑器 → `<Sheet>` 或 `<Dialog>`
- ChatSidebar → `<Sheet>` (移动端) + `<ScrollArea>` + `<ContextMenu>`
- AnnouncementPopup → `<Dialog>` 或 `<AlertDialog>`

### 阶段三：Agent 与工具活动（建议 1-2 天）

- AgentWorkspace → `<Tabs>` + `<Card>` + `<ScrollArea>`
- ToolActivity → `<Collapsible>` + `<Badge>` + `<Card>`
- ThinkingActivity → `<Collapsible>` + `<Badge>`
- ContextMeter → `<Tooltip>` + 保留自定义环形

### 阶段四：图像画布（建议 3-4 天）

- 这是最复杂的阶段，画布核心（ImageCanvasNode）保留自定义实现
- 周边 UI（侧边栏、工具栏、弹窗、菜单）用 shadcn-vue 替换
- `<Resizable>` 用于面板分割
- `<ToggleGroup>` 用于工具栏按钮组

### 阶段五：管理后台（建议 1 天）

- 用 `<Tabs>` 组织管理面板
- 用 `<Table>` / `<DataTable>` 替换手写表格
- 用 `<Alert>` / `<Toast>` 替换通知

---

## 五、迁移前后代码对比示例

### ChatHeader 按钮迁移

**迁移前（手写）:**
```html
<button class="icon-btn" :class="{ active: showAgentPanel }" @click="$emit('toggleAgentPanel')">
  <svg ...><!-- 内联 SVG --></svg>
</button>
```
```css
.icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border: 1px solid transparent;
  border-radius: 6px; background: transparent; color: var(--text-secondary);
  cursor: pointer; transition: background 0.15s, color 0.15s;
}
.icon-btn:hover { background: var(--hover-bg); color: var(--text-primary); }
.icon-btn.active { background: var(--accent-soft); color: var(--accent); }
```

**迁移后（shadcn-vue）:**
```html
<Button
  variant="ghost"
  size="icon"
  :class="{ 'bg-primary/10 text-primary': showAgentPanel }"
  @click="$emit('toggleAgentPanel')"
>
  <PanelLeftIcon class="h-[18px] w-[18px]" />
</Button>
```
零 CSS，所有样式通过 Tailwind class + shadcn-vue variant 实现。

### 认证弹窗迁移

**迁移前（手写 ~180 行 CSS + HTML）:**
```html
<div v-if="showAuthDialog" class="auth-overlay" @click.self="closeAuthDialog">
  <section class="auth-dialog" role="dialog">
    <!-- 手写 header, form, buttons -->
  </section>
</div>
```

**迁移后（shadcn-vue）:**
```html
<Dialog :open="showAuthDialog" @update:open="closeAuthDialog">
  <DialogContent class="sm:max-w-[420px]">
    <DialogHeader>
      <DialogDescription>账号</DialogDescription>
      <DialogTitle>{{ user ? '账号信息' : (authMode === 'signIn' ? '登录 Recho' : '创建账号') }}</DialogTitle>
    </DialogHeader>
    <!-- form 内容使用 shadcn-vue Input, Button, Label -->
  </DialogContent>
</Dialog>
```

---

## 六、注意事项

### 不要迁移的组件
- **ImageCanvasNode.vue**：画布节点有复杂的拖拽/缩放/连线交互，保留自定义实现更合适
- **ImagioView.vue**：图像生成流程有独特的交互，保留自定义

### 图标方案
当前项目使用内联 SVG。迁移时有两个选择：
1. **推荐**：安装 `lucide-vue-next`（shadcn-vue 默认图标库），逐步替换内联 SVG
2. **可选**：保留现有内联 SVG，仅在新增组件中使用 lucide

```bash
npm install lucide-vue-next
```

### 移动端适配
shadcn-vue 组件天然支持响应式。迁移时注意：
- `<Sheet>` 天然适合移动端侧边栏
- `<Dialog>` 在移动端自动调整位置
- 使用 Tailwind 的 `sm:` / `md:` 断点前缀处理响应式

### 国际化
当前 UI 使用中文。shadcn-vue 组件的内置文本（如 Dialog 的 aria-label）使用英文，需要手动覆盖或在组件封装时翻译。

---

## 七、推荐执行顺序

```text
阶段一（基础设施）  ← 必须先完成，后续所有阶段依赖此
    ↓
阶段二（布局导航）  ← 第二优先，解决侧边栏/弹窗/认证
    ↓
阶段三（Agent工具） ← 第三优先，完善聊天体验
    ↓
阶段四（图像画布） ← 最复杂的阶段，需要最多测试
    ↓
阶段五（管理后台） ← 最后完成，影响面最小
```

每个阶段完成后应进行完整的功能回归测试，确保迁移没有破坏现有功能。
