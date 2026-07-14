export interface AdminUser {
  userId: string
  email: string | null
  balance: number
  totalRedeemed: number
  totalSpent: number
  createdAt: string | null
  updatedAt: string | null
  lastSignInAt: string | null
  generationStats?: {
    totalGenerations: number
    succeededGenerations: number
    failedGenerations: number
    successRate: number
  }
}

export interface AdminCode {
  id: string
  code?: string
  credits: number
  maxRedemptions: number
  redeemedCount: number
  expiresAt: string | null
  disabledAt: string | null
  note: string | null
  createdAt: string | null
}

export interface AdminCodeRedemption {
  id: string
  userId: string
  email: string | null
  credits: number
  redeemedAt: string | null
  transactionId: string | null
  balanceAfter: number | null
}

export interface AdminTransaction {
  id: string
  amount: number
  balance_after: number
  reason: string
  metadata?: Record<string, unknown> | null
  created_at: string | null
}

export interface AdminLedgerEntry {
  id: string
  userId: string
  email: string | null
  amount: number
  balanceAfter: number
  reason: string
  note: string | null
  generationId: string | null
  redemptionId: string | null
  relatedTransactionId: string | null
  details: {
    count: number | null
    creditCostPerImage: number | null
    creditCost: number | null
    size: string | null
    aspectRatio: string | null
    resolution: string | null
    quality: string | null
    referenceCount: number | null
    refundReason: string | null
  }
  createdAt: string | null
}

export interface AdminImageItem {
  id: string
  userId: string | null
  email: string | null
  prompt: string
  previewUrl: string | null
  thumbnailUrl: string | null
  visibility: 'public' | 'private'
  fundingSource: string | null
  creditCost: number
  size: string | null
  aspectRatio: string | null
  resolution: string | null
  quality: string | null
  generatedAt: string | null
  storagePath: string | null
  storageLocation: 'cos' | 'supabase' | 'data' | null
  provider: string | null
  imageModel: string | null
}

export interface AdminImageAttemptItem {
  id: string
  generationId: string | null
  userId: string | null
  email: string | null
  status: 'succeeded' | 'failed'
  latencyMs: number | null
  errorType: string | null
  errorCode: string | null
  errorMessage: string | null
  httpStatus: number | null
  createdAt: string | null
}

export interface AdminImageAttemptOverview {
  total: number
  succeeded: number
  failed: number
  failureRate: number
  averageLatencyMs: number | null
  byErrorType: Array<{
    errorType: string
    count: number
  }>
}

export interface AdminImageStorageStat {
  location: 'cos' | 'supabase' | 'data' | 'unknown'
  imageCount: number
  totalBytes: number
  averageBytes: number
  totalCreditCost: number
}

export interface AdminImageStorageOverview {
  generatedAt: string
  totalImages: number
  totalBytes: number
  totalCreditCost: number
  byLocation: AdminImageStorageStat[]
}

export interface AdminSystemTableStatus {
  key: string
  label: string
  status: 'ok' | 'missing' | 'restricted' | 'error' | 'unavailable'
  count: number | null
  message: string
}

export interface AdminSystemStatus {
  generatedAt: string
  status: 'ok' | 'warning' | 'error'
  config: {
    supabase: {
      publicConfigured: boolean
      adminConfigured: boolean
      imageBucketConfigured: boolean
    }
    imageGeneration: {
      apiKeyConfigured: boolean
      creditCostPerImage: number
      analyticsEnabled: boolean
    }
    adminUsers: {
      configured: boolean
      userIdCount: number
      emailCount: number
      databaseCount: number
      envUserIdCount: number
      envEmailCount: number
      tableAvailable: boolean
    }
  }
  data: {
    tables: AdminSystemTableStatus[]
  }
  warnings: string[]
}

export interface AdminOverview {
  users: {
    withCreditRows: number
    totalBalance: number
    totalRedeemed: number
    totalSpent: number
  }
  codes: {
    total: number
    active: number
    disabled: number
    expired: number
    exhausted: number
    totalIssuedCredits: number
    totalRedeemedCredits: number
  }
  transactions: {
    last7Days: {
      totalCount: number
      redeemedCredits: number
      spentCredits: number
      refundedCredits: number
      adminAdjustedCredits: number
    }
    byReason: Array<{
      reason: string
      count: number
      amount: number
    }>
  }
  settings: {
    imageCreditCostPerImage: number
  }
  imageCost: {
    sampleDays: number
    imageSampleSize: number
    attemptSampleSize: number
    averageTrafficMb: number
    averageStoredMb: number
    averageLatencyMs: number | null
    gatewayMemoryMb: number
    estimatedMemoryMbSeconds: number | null
    estimatedCostScore: number | null
    confidence: 'none' | 'low' | 'medium' | 'high'
    cosStorageCostPerImage: number
    cosTrafficCostPerImage: number
    supabaseStorageCostPerImage: number
    supabaseTrafficCostPerImage: number
    renderTrafficCostPerImage: number
    totalCostPerImage: number
    estimatedMonthlyCost: number
    cosImageCount: number
    supabaseImageCount: number
  }
  generatedAt: string
}

export interface AdminAppSettings {
  imageCreditCostPerImage: number
  imageAnalyticsEnabled: boolean
  imageResponsesModel: string
  imageResponsesImageModel: string
  imageEventsEnabled: boolean
  canvasContextEnabled: boolean
  freeGenerationEnabled: boolean
  guestGenerationEnabled: boolean
  availableImageModels: Array<{ id: string; name: string }>
}

export type ProviderKind = 'chat' | 'image'
export type ImageProviderCompatibilityMode = 'auto' | 'openai' | 'lucen'

export interface AdminProviderSetting {
  id: string
  kind: ProviderKind
  name: string
  baseUrl: string
  enabled: boolean
  priority: number
  defaultModel: string | null
  imageModel: string | null
  editModel: string | null
  imageCompatibilityMode: ImageProviderCompatibilityMode
  timeoutMs: number
  retryCount: number
  supportsWebpReferences: boolean
  notes: string | null
  apiKeyConfigured: boolean
  apiKeyPreview: string | null
  source: 'database' | 'env'
  createdAt: string | null
  updatedAt: string | null
}

export interface AdminProviderSettingsState {
  providers: AdminProviderSetting[]
  tableAvailable: boolean
}

export interface AdminUserRule {
  id: string
  userId: string | null
  email: string | null
  enabled: boolean
  note: string | null
  source: 'database' | 'env'
  role: AdminRole
  createdAt: string | null
  updatedAt: string | null
}

export type AdminRole = 'senior' | 'operator'

export interface AdminAccessSummary {
  configured: boolean
  userIdCount: number
  emailCount: number
  databaseCount: number
  envUserIdCount: number
  envEmailCount: number
  tableAvailable: boolean
}

export type AnnouncementStatus = 'draft' | 'published' | 'archived'

export interface AdminAnnouncement {
  id: string
  title: string
  body: string
  status: AnnouncementStatus
  createdBy: string | null
  updatedBy: string | null
  publishedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}
