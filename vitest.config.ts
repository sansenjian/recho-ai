/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // 默认 node：多数测试（网关服务、契约、纯函数）不碰 DOM，而 jsdom 会为每个测试文件
    // 单独建一次环境——全量实测 environment 累计 99.4s，是 transform+import+tests 总和的 4 倍；
    // 切到 node 后整体从 71.95s 降到 23.46s。
    //
    // 需要 DOM 的测试在文件第一行声明 `// @vitest-environment jsdom`。
    // 这个机制依赖「漏标会响」：实测把 jsdom 标注改成 node，account-panel-credentials
    // 立刻以 `ReferenceError: document is not defined` 红掉 9 条，不会静默降级——
    // 所以逐文件标注是安全的，不需要中心化的清单来sync维护。
    //
    // 不再在此处写"现存 N 个 jsdom 文件"的具体数字：这类计数会随用例增长而过期，
    // 而它并不参与判据（真正的保障是上面那条"漏标必红"）。当前规模用
    // `grep -rl '@vitest-environment jsdom' tests | wc -l` 现查即可。
    //
    // 反过来说，也确认过两个看似能提速的开关都不可用：
    //   - isolate: false → 17 条失败（模块级状态跨文件泄漏），且耗时不降（100s vs 104s）
    //   - fsModuleCache: true → 首次运行反而涨到 259s，并引入超时型假失败
    // 两者都由 vitest 的提速提示推荐，但实测在本仓库是负收益，不要再试。
    environment: 'node',
    globals: true,
    // .dcu-study/ 是外部仓库的浅克隆（只读参考，已在 .gitignore 中），
    // 但它自带 tests/ 且用 React + jsdom，默认 include 会把它们一起收进来：
    // 实测 27 个文件 / 38 条用例失败，全是这套无关测试，污染本仓库的测试信号。
    exclude: ['**/node_modules/**', '**/dist/**', '.dcu-study/**'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    // 覆盖率基线此前完全缺失（只有 vitest，没有 coverage provider）。
    // 生成：`npx vitest run --coverage`；json-summary 便于按目录聚合出决策用的数字，
    // html 供人工下钻。coverage/ 已在 .gitignore 中。
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,vue}', 'backend/gateway/src/**/*.ts'],
      exclude: ['**/*.d.ts'],
    },
  },
})
