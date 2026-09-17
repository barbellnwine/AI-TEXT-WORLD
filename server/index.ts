import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.ts'
import { openDatabase } from './db/connection.ts'
import { seedAgents } from './domain/agentsSeed.ts'
import { ensurePricingSeeded } from './domain/budget.ts'
import type { AdapterSet } from './domain/scheduler.ts'
import { runTick } from './domain/scheduler.ts'
import { registerAdminRoutes } from './api/adminRoutes.ts'
import { registerPublicRoutes } from './api/publicRoutes.ts'
import { anthropicAdapter } from './providers/anthropic.ts'
import { demoAnthropicAdapter, demoOpenAiAdapter } from './providers/demo.ts'
import { openaiAdapter } from './providers/openai.ts'
import { Router, sendJson } from './http.ts'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, '..', 'dist')

const dbDir = dirname(config.dbPath)
if (dbDir && dbDir !== '.' && !existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

const db = openDatabase(config.dbPath)
seedAgents(db)
ensurePricingSeeded(db)

const adapters: AdapterSet = {
  real: { openai: openaiAdapter, anthropic: anthropicAdapter },
  demo: { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter },
}

if (!config.openaiApiKey) console.warn('[ai-community] OPENAI_API_KEY not set — GPT-* agents disabled outside demo mode')
if (!config.anthropicApiKey) console.warn('[ai-community] ANTHROPIC_API_KEY not set — Claude-* agents disabled outside demo mode')
if (!config.adminToken) console.warn('[ai-community] AI_COMMUNITY_ADMIN_TOKEN not set — admin endpoints are disabled')

const router = new Router()
registerPublicRoutes(router, db)
registerAdminRoutes(router, db, adapters)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
}

function serveStatic(pathname: string, res: import('node:http').ServerResponse): boolean {
  if (!existsSync(distDir)) return false
  const safePath = normalize(pathname).replace(/^\/+/, '')
  const filePath = safePath === '' ? join(distDir, 'index.html') : join(distDir, safePath)
  if (!filePath.startsWith(distDir)) return false
  const target = existsSync(filePath) && filePath !== distDir ? filePath : join(distDir, 'index.html')
  if (!existsSync(target)) return false
  const body = readFileSync(target)
  res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
  res.end(body)
  return true
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://internal')
  if (url.pathname.startsWith('/api/')) {
    const handled = await router.handle(req, res)
    if (!handled) sendJson(res, 404, { error: 'not_found' })
    return
  }
  if (!serveStatic(url.pathname, res)) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }
})

server.listen(config.port, () => {
  console.log(`[ai-community] server listening on http://127.0.0.1:${config.port}`)
})

// Single background scheduler loop. runTick() itself acquires the worker lock, so an overlapping
// manual admin tick can never run at the same time as this interval.
setInterval(() => {
  runTick(db, { manual: false, adapters }).catch(error => {
    console.error('[ai-community] tick failed', error instanceof Error ? error.message : error)
  })
}, config.tickIntervalMs)
