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
    // 需要 DOM 的测试在文件第一行声明 `// @vitest-environment jsdom`（现存 14 个文件 = 1 个原有 + 13 个本次补标）。
    // 实测（把 14 个标注全翻成 node 再跑）：13 失败 / 1 通过 ⇒ 13 个是硬需求；
    // use-image-gallery-history 属防御性多标——它只跑失败路径，未触到 localStorage。
    // 漏标会因缺 localStorage / window 立刻变红，不会静默降级；
    // 判据取 exit code 而非断言结果（漏标可能断言全过、却因 unhandled rejection 退出码非 0）。
    environment: 'node',
    globals: true,
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
