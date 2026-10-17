import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { ws, devUser } from './lib/platform.js'
import { prisma } from './lib/prisma.js'
import { mountMcp } from './mcp.js'
import api from './routes/api.js'
import { touchEmployee } from './services/directory.js'
import { seedLeaveTypes } from './services/leave.js'
import { startScheduler } from './services/sync.js'

const app = express()
app.set('trust proxy', true)
app.disable('x-powered-by')

// 健康检查：平台据此判断应用是否正常（免登录）
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ok: true })
  } catch {
    res.status(503).json({ ok: false, error: '数据库连不上' })
  }
})

app.use(express.json({ limit: '1mb' }))
// MCP 自己校验平台带来的 access_token
mountMcp(app)

// 统一登录：/sso/callback；其余要登录（/api 未登录回 401，页面跳平台授权）
app.use(ws.middleware({ publicPaths: ['/health', '/mcp', '/assets/', '/favicon'] }))
app.use((req, res, next) => {
  const user = req.yhUser || devUser()
  if (!user) return res.status(401).json({ code: 401, message: '未登录' })
  req.ctx = { user, via: 'WEB', ip: req.ip }
  touchEmployee(user)
  next()
})
app.use('/api', api)

// 前端构建产物（生产环境）；单页应用用 hash 路由，所以只有 index.html 一个入口
const STATIC_DIR = process.env.STATIC_DIR && path.resolve(process.env.STATIC_DIR)
if (STATIC_DIR && fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR, { index: false, maxAge: '7d' }))
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(STATIC_DIR, 'index.html'))
  })
}

async function main() {
  await seedLeaveTypes()
  if (process.env.NODE_ENV !== 'test') startScheduler()
  const port = Number(process.env.PORT) || 3000
  const mode = ws.enabled ? '' : devUser() ? '（本地开发模式：未接入平台）' : '（未接入平台：缺 YH_CLIENT_ID 等，所有请求都会 401）'
  app.listen(port, () => console.log(`[hr] listening on :${port}${mode}`))
}

main().catch((e) => {
  console.error('[hr] 启动失败', e)
  process.exit(1)
})
