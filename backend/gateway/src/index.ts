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

const app = express()

app.use(cors({
  origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN
}))
app.use(express.json({ limit: '50mb' }))

// Initialize clients
initClients()

// Mount routes
app.use('/api', chatRouter)
app.use('/api', skillsRouter)
app.use('/api', toolsRouter)
app.use('/', healthRouter)

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'recho-ai gateway' })
})

app.listen(PORT, async () => {
  console.log(`Gateway running on http://localhost:${PORT}`)
  await skillLoader.load()
  await mcpManager.initialize()
  skillLoader.validateTools(mcpManager.getToolNames())
})
