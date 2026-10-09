import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { vi } from 'vitest'
import AdminSettingsPanel from './src/components/admin/AdminSettingsPanel.vue'
import en from './src/i18n/en'
import zh from './src/i18n/zh'

// 直接内联最小 provider，避免依赖测试文件的工厂函数
const provider = {
  id: 'p1', kind: 'image', name: 'P', baseUrl: 'https://x.test/v1', enabled: false,
  priority: 10, defaultModel: null, models: [], modelCatalog: [],
  imageModel: null, editModel: null, imageCompatibilityMode: 'auto',
  timeoutMs: 1, retryCount: 0, supportsWebpReferences: true, notes: null,
  apiKeyConfigured: true, apiKeyPreview: 'sk-***', source: 'database',
  createdAt: null, updatedAt: null,
}
;(globalThis as any).__mockFn = vi.fn(async (url: string) => {
  if (url === '/api/admin/settings') {
    return {
      settings: { imageCreditCostPerImage: 1, imageModelCreditCosts: [], imageAnalyticsEnabled: false,
        imageResponsesModel: 'gpt-image-2', imageResponsesImageModel: 'gpt-image-2',
        imageEventsEnabled: false, canvasContextEnabled: false, freeGenerationEnabled: true,
        guestGenerationEnabled: true, availableImageModels: [] },
      adminUsers: [],
      adminAccess: { configured: true, userIdCount: 0, emailCount: 0, databaseCount: 0, envUserIdCount: 0, envEmailCount: 0, tableAvailable: true },
      providerSettings: { providers: [provider], tableAvailable: true },
      currentAdminRole: 'senior',
    }
  }
  throw new Error('unexpected: ' + url)
})
console.log('（此探针仅用于确认按钮文本，需配合 mock 生效）')
