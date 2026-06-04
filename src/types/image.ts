export type ImageAspectRatio = 'auto' | '1:1' | '3:2' | '2:3' | '16:9' | '9:16'
export type ImageResolution = 'auto' | '1k' | '2k' | '4k'
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high'
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
  dataUrl: string
  storagePath?: string
  thumbnailUrl?: string
  thumbnailPath?: string
  content?: string
  fileName?: string
}

export interface ImageGenRequest {
  prompt: string
  size?: ImageSize
  aspectRatio?: ImageAspectRatio
  resolution?: ImageResolution
  quality?: ImageQuality
  references?: ImageGenReference[]
}

export interface ImageGenResponse {
  images: GeneratedImage[]
}

export interface GeneratedImage {
  id: string
  userId?: string | null
  dataUrl?: string
  storagePath?: string
  thumbnailUrl?: string
  thumbnailPath?: string
  prompt: string
  references?: ImageGenReference[]
  revisedPrompt?: string
  size: string
  aspectRatio?: ImageAspectRatio
  resolution?: ImageResolution
  quality?: ImageQuality
  timestamp: string
}
