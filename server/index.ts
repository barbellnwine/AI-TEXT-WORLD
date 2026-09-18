import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve, relative, isAbsolute } from 'node:path'
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
import { createRequestLimiter, securityHeaders } from './security.ts'

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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

function serveStatic(pathname: string, res: import('node:http').ServerResponse): boolean {
  if (!existsSync(distDir)) return false
  if (pathname.split('/').some(segment => segment.startsWith('.')) ||
      /^\/(server|data|node_modules|src)(\/|$)/.test(pathname) || /\.(map|sqlite|ts|tsx)$/.test(pathname)) return false
  const filePath = resolve(distDir, '.' + pathname)
  const relativePath = relative(distDir, filePath)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return false
  const target = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(distDir, 'index.html')
  if (!existsSync(target)) return false
  const body = readFileSync(target)
  res.writeHead(200, {
    'content-type': MIME[extname(target)] ?? 'application/octet-stream',
    'cache-control': relative(distDir, target).startsWith('assets') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.end(body)
  return true
}

const allowRequest = createRequestLimiter()
const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 }, async (req, res) => {
  try {
    securityHeaders(res)
    if (config.production && !allowRequest()) {
      req.resume()
      res.setHeader('retry-after', '1')
      sendJson(res, 429, { error: 'request_rate_limit' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://internal')
    if (url.pathname === '/api/health' && req.method === 'GET') {
      db.prepare('SELECT 1').get()
      sendJson(res, 200, { ok: true })
      return
    }
    if (url.pathname.startsWith('/api/')) {
      const handled = await router.handle(req, res)
      if (!handled) sendJson(res, 404, { error: 'not_found' })
      return
    }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) {
      req.resume()
      sendJson(res, 405, { error: 'method_not_allowed' })
      return
    }
    if (!serveStatic(url.pathname, res)) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    }
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' })
    else res.end()
    console.error('[ai-community] request failed', error instanceof Error ? error.message : error)
  }
})

server.listen(config.port, config.host, () => {
  const address = server.address()
  console.log(`[ai-community] server listening on http://${config.host}:${typeof address === 'object' && address ? address.port : config.port}`)
})

// Single background scheduler loop. runTick() itself acquires the worker lock, so an overlapping
// manual admin tick can never run at the same time as this interval.
let backgroundTick: Promise<unknown> = Promise.resolve()
let backgroundRunning = false
const schedulerTimer = setInterval(() => {
  if (backgroundRunning) return
  backgroundRunning = true
  backgroundTick = runTick(db, { manual: false, adapters }).catch(error => {
    console.error('[ai-community] tick failed', error instanceof Error ? error.message : error)
  }).finally(() => { backgroundRunning = false })
}, config.tickIntervalMs)

let closing = false
function shutdown() {
  if (closing) return
  closing = true
  clearInterval(schedulerTimer)
  const deadline = setTimeout(() => process.exit(1), 60_000)
  deadline.unref()
  server.close(async () => {
    await backgroundTick
    db.close()
    clearTimeout(deadline)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
