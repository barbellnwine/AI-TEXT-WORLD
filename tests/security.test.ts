import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

process.env.NODE_ENV = 'production'
process.env.AI_COMMUNITY_ENABLED = 'true'
process.env.AI_COMMUNITY_PROVIDER_LIMITS_CONFIRMED = 'false'
process.env.AI_COMMUNITY_ADMIN_TOKEN = 'test-admin-token-with-at-least-32-characters'
process.env.OPENAI_API_KEY = 'test-only-openai-key'
process.env.ANTHROPIC_API_KEY = 'test-only-anthropic-key'
process.env.AI_COMMUNITY_MAX_RETRIES = '0'
process.env.AI_COMMUNITY_BUDGET_SAFETY_MARGIN = '0.2'
process.env.USD_TO_KRW_RATE = '1400'

const { config } = await import('../server/config.ts')
const { openDatabase, migrate } = await import('../server/db/connection.ts')
const { seedAgents } = await import('../server/domain/agentsSeed.ts')
const { getPricing, setPricing, ensurePricingSeeded, setSetting, getWeeklyBudgetKrw, getMonthlyBudgetKrw, getSafetyMargin, getUsdToKrwRate } = await import('../server/domain/budget.ts')
const { setStatus, setDemoMode } = await import('../server/domain/runtimeState.ts')
const { runTick } = await import('../server/domain/scheduler.ts')
const { demoOpenAiAdapter, demoAnthropicAdapter } = await import('../server/providers/demo.ts')
const { Router } = await import('../server/http.ts')
const { registerAdminRoutes } = await import('../server/api/adminRoutes.ts')
const { createRequestLimiter } = await import('../server/security.ts')
const { boundCallInput, providerRequestBody, MAX_PROVIDER_REQUEST_BYTES } = await import('../server/providers/requestBody.ts')
const { fetchWithLimits } = await import('../server/providers/httpUtil.ts')

const demo = { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter }
const adapters = { real: demo, demo }
function freshDb() {
  const db = new DatabaseSync(':memory:')
  migrate(db); seedAgents(db); ensurePricingSeeded(db)
  return db
}

test('production rejects missing billing verification before any paid adapter call', async () => {
  const db = freshDb()
  try {
    setStatus(db, 'RUNNING'); setDemoMode(db, false)
    let calls = 0
    const fake = { ...demoOpenAiAdapter, generateAction: async () => { calls++; throw new Error('must not call') } }
    const result = await runTick(db, { manual: true, adapters: { real: { openai: fake, anthropic: fake }, demo } })
    assert.equal(result.skipReason, 'PROVIDER_LIMITS_UNCONFIRMED')
    assert.equal(calls, 0)
  } finally { db.close() }
})

test('paid throttle survives restart, Start/Stop, DEMO switches and concurrent manual ticks', async () => {
  const base = resolve(tmpdir())
  const dir = mkdtempSync(join(base, 'ai-security-'))
  const path = join(dir, 'test.sqlite')
  let db = openDatabase(path)
  const previous = config.providerLimitsConfirmed
  config.providerLimitsConfirmed = true
  try {
    seedAgents(db); ensurePricingSeeded(db); setStatus(db, 'RUNNING'); setDemoMode(db, false)
    let calls = 0
    const fake = { ...demoOpenAiAdapter, generateAction: async (input: Parameters<typeof demoOpenAiAdapter.generateAction>[0]) => {
      calls++; return demoOpenAiAdapter.generateAction(input)
    } }
    const counting = { real: { openai: fake, anthropic: fake }, demo }
    await Promise.all(Array.from({ length: 10 }, () => runTick(db, { manual: true, adapters: counting })))
    assert.equal(calls, 1)
    setStatus(db, 'STOPPED'); setDemoMode(db, true)
    db.close(); db = openDatabase(path)
    setStatus(db, 'RUNNING'); setDemoMode(db, false)
    assert.equal((await runTick(db, { manual: true, adapters: counting })).skipReason, 'CALL_RATE_LIMIT')
    assert.equal(calls, 1)
  } finally {
    config.providerLimitsConfirmed = previous
    db.close()
    assert.ok(relative(base, resolve(dir)).startsWith('ai-security-'))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stored settings and model prices cannot weaken server ceilings and floors', () => {
  const db = freshDb()
  try {
    setSetting(db, 'weekly_budget_krw', '999999')
    setSetting(db, 'monthly_budget_krw', '999999')
    setSetting(db, 'budget_safety_margin', '0')
    setSetting(db, 'usd_to_krw_rate', '0.01')
    setPricing(db, { provider: 'openai', model: config.openaiModel, inputUsdPerMTok: 0, outputUsdPerMTok: 0 })
    assert.equal(getWeeklyBudgetKrw(db), config.weeklyBudgetKrw)
    assert.equal(getMonthlyBudgetKrw(db), config.monthlyBudgetKrw)
    assert.equal(getSafetyMargin(db), config.budgetSafetyMargin)
    assert.equal(getUsdToKrwRate(db), config.usdToKrwRate)
    assert.equal(getPricing(db, 'openai', config.openaiModel)?.inputUsdPerMTok, 0.4)
    assert.equal(getPricing(db, 'openai', 'unknown'), null)
  } finally { db.close() }
})

test('admin auth, cross-site protection, body limits and settings reject hostile requests', async () => {
  const db = freshDb()
  const router = new Router()
  registerAdminRoutes(router, db, adapters)
  const server = createServer((req, res) => { void router.handle(req, res) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/ai-community/admin`
  const headers = { 'x-admin-token': config.adminToken, 'content-type': 'application/json' }
  try {
    assert.equal((await fetch(`${base}/status`, { headers })).status, 200)
    assert.equal((await fetch(`${base}/start`, { method: 'POST', headers: { ...headers, 'sec-fetch-site': 'cross-site' } })).status, 403)
    assert.equal((await fetch(`${base}/settings`, { method: 'POST', headers, body: ' '.repeat(17_000) })).status, 413)
    const before = db.prepare('SELECT * FROM ai_settings').all()
    for (const body of [
      { weeklyBudgetKrw: 999999 }, { monthlyBudgetKrw: 999999 }, { safetyMargin: 0 }, { usdToKrwRate: 0.01 },
      { pricing: [{ provider: 'openai', model: config.openaiModel, inputUsdPerMTok: 0, outputUsdPerMTok: 0 }] },
    ]) {
      assert.equal((await fetch(`${base}/settings`, { method: 'POST', headers, body: JSON.stringify(body) })).status, 400)
    }
    assert.deepEqual(db.prepare('SELECT * FROM ai_settings').all(), before)
    const original = config.adminToken
    try {
      config.adminToken = 'short'
      assert.equal((await fetch(`${base}/status`, { headers: { 'x-admin-token': 'short' } })).status, 503)
    } finally { config.adminToken = original }
    for (let i = 0; i < 16; i++) {
      const res = await fetch(`${base}/status`)
      assert.equal(res.status, i < 15 ? 401 : 429)
    }
    assert.equal((await fetch(`${base}/status`, { headers })).status, 429)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolveClose => server.close(() => resolveClose()))
    db.close()
  }
})

test('request limiter bounds aggregate load without an unbounded client IP map', () => {
  const allow = createRequestLimiter(2, 1)
  const now = Date.now()
  assert.equal(allow(now), true); assert.equal(allow(now), true)
  assert.equal(allow(now), false); assert.equal(allow(now + 1000), true)
})

test('large prompt histories are bounded without mutating the original input', async () => {
  const db = freshDb()
  const previous = config.providerLimitsConfirmed
  config.providerLimitsConfirmed = true
  try {
    setStatus(db, 'RUNNING'); setDemoMode(db, false)
    const fake = { ...demoOpenAiAdapter, generateAction: async (input: Parameters<typeof demoOpenAiAdapter.generateAction>[0]) => {
      const huge = { ...input, privateMemories: Array(10).fill('가'.repeat(4000)), recentPublicPosts: [] }
      const bounded = boundCallInput('openai', huge)
      assert.ok(Buffer.byteLength(providerRequestBody('openai', bounded)) <= MAX_PROVIDER_REQUEST_BYTES)
      assert.equal(huge.privateMemories.length, 10)
      return demoOpenAiAdapter.generateAction(input)
    } }
    assert.equal((await runTick(db, { adapters: { real: { openai: fake, anthropic: fake }, demo } })).ticked, true)
  } finally { config.providerLimitsConfirmed = previous; db.close() }
})

test('provider transport rejects foreign endpoints, large payloads and oversized replies', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    calls++
    assert.equal(init.redirect, 'error')
    return new Response('x'.repeat(256_001))
  }) as typeof fetch
  try {
    await assert.rejects(fetchWithLimits('https://other.invalid', { body: '{}' }), /unapproved provider endpoint/)
    await assert.rejects(fetchWithLimits('https://api.openai.com/v1/chat/completions', { body: 'x'.repeat(12_001) }), /request exceeds limit/)
    assert.equal(calls, 0)
    await assert.rejects(fetchWithLimits('https://api.openai.com/v1/chat/completions', { body: '{}' }), /response exceeds limit/)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = original }
})

test('provider timeout covers response body, not only response headers', async () => {
  const original = globalThis.fetch
  const previousTimeout = config.requestTimeoutMs
  config.requestTimeoutMs = 20
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({
    start(controller) {
      init.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
    },
  }))) as typeof fetch
  try {
    await assert.rejects(fetchWithLimits('https://api.openai.com/v1/chat/completions', { body: '{}' }), /timed out/)
  } finally { globalThis.fetch = original; config.requestTimeoutMs = previousTimeout }
})

test('public build scanner blocks embedded secrets without printing them', () => {
  const base = resolve(tmpdir())
  const dir = mkdtempSync(join(base, 'ai-security-scan-'))
  const secret = 'test-only-sensitive-value-for-scanner'
  try {
    mkdirSync(join(dir, 'dist'))
    writeFileSync(join(dir, 'dist', 'app.js'), `const accidental = '${secret}'`)
    const result = spawnSync(process.execPath, [resolve('tool/check-public-secrets.mjs')], {
      cwd: dir, env: { ...process.env, OPENAI_API_KEY: secret }, encoding: 'utf8', windowsHide: true,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Publication blocked/)
    assert.equal((result.stdout + result.stderr).includes(secret), false)
    writeFileSync(join(dir, 'dist', 'app.js'), 'const safe = true')
    assert.equal(spawnSync(process.execPath, [resolve('tool/check-public-secrets.mjs')], {
      cwd: dir, env: { ...process.env, OPENAI_API_KEY: secret }, windowsHide: true,
    }).status, 0)
  } finally {
    assert.ok(relative(base, resolve(dir)).startsWith('ai-security-scan-'))
    rmSync(dir, { recursive: true, force: true })
  }
})
