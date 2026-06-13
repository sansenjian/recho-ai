import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Readable } from 'node:stream'
import {
  TENCENT_COS_FULL_BUCKET,
  TENCENT_COS_PUBLIC_BASE_URL,
  TENCENT_COS_REGION,
  TENCENT_COS_SECRET_ID,
  TENCENT_COS_SECRET_KEY,
} from '../config.js'

let cosClient: S3Client | null = null

export function hasTencentCosConfig() {
  return Boolean(
    TENCENT_COS_SECRET_ID &&
    TENCENT_COS_SECRET_KEY &&
    TENCENT_COS_FULL_BUCKET &&
    TENCENT_COS_REGION,
  )
}

export function getTencentCosClient() {
  if (!hasTencentCosConfig()) return null
  cosClient ??= new S3Client({
    region: TENCENT_COS_REGION,
    endpoint: `https://cos.${TENCENT_COS_REGION}.myqcloud.com`,
    credentials: {
      accessKeyId: TENCENT_COS_SECRET_ID,
      secretAccessKey: TENCENT_COS_SECRET_KEY,
    },
    maxAttempts: 2,
  })
  return cosClient
}

async function bodyToBuffer(body: GetObjectCommandOutput['Body']) {
  if (!body) return Buffer.alloc(0)
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (typeof (body as any).transformToByteArray === 'function') {
    return Buffer.from(await (body as any).transformToByteArray())
  }

  const chunks: Buffer[] = []
  for await (const chunk of body as Readable | AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export function tencentCosObjectUrl(key: string) {
  let baseUrl = TENCENT_COS_PUBLIC_BASE_URL
  
  if (!baseUrl && TENCENT_COS_FULL_BUCKET && TENCENT_COS_REGION) {
    baseUrl = `https://${TENCENT_COS_FULL_BUCKET}.cos.${TENCENT_COS_REGION}.myqcloud.com`
  }
  
  if (!baseUrl) return undefined

  const encodedKey = key
    .split('/')
    .filter(Boolean)
    .map(part => encodeURIComponent(part))
    .join('/')

  return `${baseUrl.replace(/\/+$/, '')}/${encodedKey}`
}

/**
 * 生成腾讯云 COS 预签名 URL，默认有效期 1 小时
 * 适用于需要临时访问权限的场景（如私有存储桶）
 */
export async function tencentCosSignedUrl(key: string, expiresInSeconds = 3600) {
  const client = getTencentCosClient()
  if (!client) return undefined

  const command = new GetObjectCommand({
    Bucket: TENCENT_COS_FULL_BUCKET,
    Key: key,
  })

  const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds })
  return url
}

export async function putTencentCosObject(options: {
  key: string
  body: Buffer
  contentType: string
  cacheControl: string
}) {
  const client = getTencentCosClient()
  if (!client) return null

  await client.send(new PutObjectCommand({
    Bucket: TENCENT_COS_FULL_BUCKET,
    Key: options.key,
    Body: options.body,
    ContentLength: options.body.byteLength,
    ContentType: options.contentType,
    CacheControl: options.cacheControl,
    StorageClass: 'STANDARD',
  }))

  return {
    publicUrl: tencentCosObjectUrl(options.key) || '',
    storagePath: `cos://${options.key}`,
  }
}

export async function deleteTencentCosObject(key: string) {
  const client = getTencentCosClient()
  if (!client) return false

  await client.send(new DeleteObjectCommand({
    Bucket: TENCENT_COS_FULL_BUCKET,
    Key: key,
  }))
  return true
}

export async function getTencentCosObject(key: string) {
  const client = getTencentCosClient()
  if (!client) return null

  const data = await client.send(new GetObjectCommand({
    Bucket: TENCENT_COS_FULL_BUCKET,
    Key: key,
  }))

  return {
    buffer: await bodyToBuffer(data.Body),
    mime: data.ContentType || 'image/png',
  }
}
