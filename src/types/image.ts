export type ImageAspectRatio = 'auto' | '1:1' | '3:2' | '2:3' | '16:9' | '9:16'
export type ImageResolution = 'auto' | '1k' | '2k' | '4k'
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high'
export type ImageHistoryScope = 'mine' | 'public'
export type ImageGenerationCount = 1 | 2 | 4 | 8
export type ImageVisibility = 'public' | 'private'
export type ImageFundingSource = 'free' | 'credit'
export type ImageSize =
  | 'auto'
  | '1024x1024'
  | '1536x1024'
  | '1024x1536'
  | '1536x864'
  | '864x1536'
  | '2048x2048'
  | '2160x1440'
  | '1440x2160'
  | '2048x1152'
  | '1152x2048'
  | '3840x2160'
  | '2880x2880'
  | '3520x2336'
  | '2336x3520'
  | '2160x3840'

export interface ImageGenReference {
  id: string
  title: string
  dataUrl?: string
  storagePath?: string
  previewUrl?: string
  previewPath?: string
  thumbnailUrl?: string
  thumbnailPath?: string
  content?: string
  fileName?: string
}

export interface ImageGenRequest {
  prompt: string
  model?: string
  displayPrompt?: string
  userPrompt?: string
  systemPrompt?: string
  modelPrompt?: string
  size?: ImageSize
  aspectRatio?: ImageAspectRatio
  resolution?: ImageResolution
  quality?: ImageQuality
  count?: ImageGenerationCount
  references?: ImageGenReference[]
  canvasContext?: ImageCanvasContext
}

export type ImageGenOptions = Omit<ImageGenRequest, 'prompt'>
export type ImageGenerate = (prompt: string, options?: ImageGenOptions) => Promise<GeneratedImage[] | null>

export interface ImageCanvasContext {
  canvasId: string
  nodeCount: number
  connectionCount: number
  imageNodeCount: number
  textNodeCount: number
  generationNodeCount: number
  referenceCount: number
  mentionedReferenceCount: number
  connectedReferenceCount: number
  promptCharCount: number
  hasConnectedPrompt: boolean
  canvasVersion: number
}

export interface ImageGenResponse {
  images: GeneratedImage[]
  creditBalance?: {
    balance: number
  }
}

export interface GeneratedImage {
  id: string
  userId?: string | null
  generationBatchId?: string | null
  url?: string
  temporaryUrl?: string
  persistenceStatus?: 'processing' | 'persisted' | 'failed' | string
  dataUrl?: string
  storagePath?: string
  previewUrl?: string
  previewPath?: string
  thumbnailUrl?: string
  thumbnailPath?: string
  prompt: string
  userPrompt?: string
  systemPrompt?: string
  modelPrompt?: string
  references?: ImageGenReference[]
  referenceImageCount?: number
  visibility?: ImageVisibility
  fundingSource?: ImageFundingSource
  creditCost?: number
  revisedPrompt?: string
  size: string
  aspectRatio?: ImageAspectRatio
  resolution?: ImageResolution
  quality?: ImageQuality
  timestamp: string
}
