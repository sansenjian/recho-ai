import express from 'express'
import cors from 'cors'
import { PORT, CORS_ORIGIN } from './config.js'
import { initClients } from './clients/factory.js'
import { skillLoader } from './skills/loader.js'
import { mcpManager } from './mcp/manager.js'
import chatRouter from './routes/chat.js'
import skillsRouter from './routes/skills.js'
import toolsRouter from './routes/tools.js'
import healthRouter from './routes/health.js'
import imageRouter from './routes/image.js'
import imageHistoryRouter from './routes/image-history.js'
import imageEventsRouter from './routes/image-events.js'
import configRouter from './routes/config.js'
import creditsRouter from './routes/credits.js'
import adminCreditsRouter from './routes/admin-credits.js'
import adminImagesRouter from './routes/admin-images.js'
import adminImageAttemptsRouter from './routes/admin-image-attempts.js'
import adminSystemRouter from './routes/admin-system.js'
import adminAnnouncementsRouter from './routes/admin-announcements.js'
import goSidecarRouter from './routes/go-sidecar.js'

const app = express()

// Allow long-running requests (image generation can take several minutes).
// req/res 层面设置为 10 分钟，再配合 server 级 socket timeout / keep-alive 设置。
const LONG_REQUEST_MS = 600_000
app.use((req, res, next) => {
  req.setTimeout(LONG_REQUEST_MS)
  res.setTimeout(LONG_REQUEST_MS)
  res.on('timeout', () => {
    console.warn('[server] response timeout exceeded for', req.method, req.url)
    if (!res.headersSent) {
      res.status(504).json({ error: '请求超时，请稍后重试。' })
    } else {
      res.destroy()
    }
  })
  next()
})

app.use(cors({
  origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN
}))

// When deployed as a single Render backend, proxy Go-owned image/works routes
// to the local Go sidecar before body parsers consume request streams.
app.use('/api', goSidecarRouter)

app.use(express.json({ limit: '50mb' }))

// Explicit JSON parser for the image generation endpoint so large bodies with
// many data-URI reference images are not rejected by a generic body size limit,
// and we surface parsing errors as clean JSON responses rather than closed
// connections from the default error handler.
app.use('/api/image/generate', express.json({ limit: '50mb' }))
app.use('/api/image/generate', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && err.type === 'entity.parse.failed') {
    console.warn('[image] request body parse failed', err?.message)
    res.status(400).json({ error: '请求体解析失败，请检查输入是否为合法 JSON。' })
    return
  }
  if (err && (err.status === 413 || err.type === 'entity.too.large')) {
    console.warn('[image] request body too large', err?.message)
    res.status(413).json({ error: '请求体过大，请减少参考图数量或压缩图片后重试。' })
    return
  }
  if (err) {
    console.warn('[image] request body error', err?.status, err?.message)
    res.status(err.status || 400).json({ error: '请求体读取失败，请稍后重试。' })
    return
  }
  res.status(500).json({ error: '未知错误' })
})

// Initialize clients
initClients()

// Mount routes
app.use('/api', chatRouter)
app.use('/api', skillsRouter)
app.use('/api', toolsRouter)
app.use('/api', imageRouter)
app.use('/api', imageHistoryRouter)
app.use('/api', imageEventsRouter)
app.use('/api', configRouter)
app.use('/api', creditsRouter)
app.use('/api', adminCreditsRouter)
app.use('/api', adminImagesRouter)
app.use('/api', adminImageAttemptsRouter)
app.use('/api', adminSystemRouter)
app.use('/api', adminAnnouncementsRouter)
app.use('/', healthRouter)

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'recho-ai gateway' })
})

// Global error handler — must be the last middleware before routes start
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[gateway] unhandled error:', err)
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' })
  }
})

const server = app.listen(PORT, async () => {
  console.log(`Gateway running on http://localhost:${PORT}`)
  await skillLoader.load()
  await mcpManager.initialize()
  skillLoader.validateTools(mcpManager.getToolNames())
})

// Ensure long-running image generation requests are not killed by the default
// Node.js server socket timeout (which historically defaults to 0 in modern
// versions, but we set headersTimeout/keepAliveTimeout/timeout explicitly to
// avoid surprises on platforms like Render that sit idle waiting for the
// upstream image provider).
server.keepAliveTimeout = 620_000
server.headersTimeout = 630_000
server.timeout = 0
try {
  // @ts-expect-error -- node might not expose requestsTimeout; set only if present.
  server.requestsTimeout = 0
} catch { /* ignore */ }

process.on('unhandledRejection', (reason) => {
  console.error('[gateway] unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[gateway] uncaught exception:', err)
})

const shutdown = async () => {
  console.log('[gateway] shutting down...')
  server.close()
  await mcpManager.disconnectAll()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
