import http from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import imageRouter from '../backend/gateway/src/routes/image'
import { downloadImageBuffer } from '../backend/gateway/src/services/image-storage'

vi.mock('../backend/gateway/src/services/image-storage', () => ({
  downloadImageBuffer: vi.fn(),
  storeImageBuffer: vi.fn(),
}))

describe('image storage proxy route', () => {
  const servers: http.Server[] = []

  afterEach(async () => {
    vi.clearAllMocks()
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })))
  })

  it('accepts a named wildcard and preserves nested storage paths', async () => {
    vi.mocked(downloadImageBuffer).mockResolvedValue({
      buffer: Buffer.from('image'),
      mime: 'image/webp',
    })

    const app = express()
    app.use('/api', imageRouter)
    const server = http.createServer(app)
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind to a port')

    const response = await fetch(`http://127.0.0.1:${address.port}/api/image/storage/users/u1/photo.webp`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/webp')
    expect(downloadImageBuffer).toHaveBeenCalledWith('users/u1/photo.webp')
  })
})
