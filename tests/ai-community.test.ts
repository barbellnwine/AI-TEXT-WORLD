import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'

// Set env before any dynamic import of server modules touches process.env at module-eval time.
process.env.AI_COMMUNITY_ADMIN_TOKEN = 'test-admin-token'
process.env.AI_COMMUNITY_ENABLED = 'true'
process.env.OPENAI_API_KEY = 'test-key-openai'
process.env.ANTHROPIC_API_KEY = 'test-key-anthropic'
process.env.AI_COMMUNITY_BUDGET_SAFETY_MARGIN = '0.2'
process.env.USD_TO_KRW_RATE = '1400'

const { migrate } = await import('../server/db/connection.ts')
const { seedAgents } = await import('../server/domain/agentsSeed.ts')
const { ensurePricingSeeded, setSetting } = await import('../server/domain/budget.ts')
const { appendMemory, getPrivateMemories } = await import('../server/domain/memory.ts')
const { acquireLock, releaseLock } = await import('../server/domain/lock.ts')
const { getRuntimeState, setDemoMode, setStatus } = await import('../server/domain/runtimeState.ts')
const { runTick, pickCandidate } = await import('../server/domain/scheduler.ts')
const { getCurrentWeekKey } = await import('../server/domain/budget.ts')
const { demoOpenAiAdapter, demoAnthropicAdapter } = await import('../server/providers/demo.ts')

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  seedAgents(db)
  ensurePricingSeeded(db)
  return db
}

test('monthly budget blocks paid ticks but keeps demo ticks available', async () => {
  const db = freshDb()
  try {
    setSetting(db, 'monthly_budget_krw', '0')
    setStatus(db, 'RUNNING')
    setDemoMode(db, false)
    let calls = 0
    const blocked = { ...demoOpenAiAdapter, generateAction: async () => { calls++; throw new Error('must not call') } }
    const demo = { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter }
    const adapters = { real: { openai: blocked, anthropic: blocked }, demo }
    assert.equal((await runTick(db, { adapters })).skipReason, 'BUDGET_LIMIT')
    assert.equal(calls, 0)
    assert.equal(getRuntimeState(db).status, 'PAUSED_BUDGET')
    setStatus(db, 'RUNNING')
    setDemoMode(db, true)
    assert.equal((await runTick(db, { adapters })).ticked, true)
    assert.equal(calls, 0)
  } finally { db.close() }
})

test('failed paid calls retain estimated charges in both budget ledgers', async () => {
  const db = freshDb()
  try {
    setStatus(db, 'RUNNING')
    setDemoMode(db, false)
    const failing = { ...demoOpenAiAdapter, generateAction: async () => { throw new Error('timeout') } }
    const adapters = { real: { openai: failing, anthropic: failing }, demo: { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter } }
    assert.equal((await runTick(db, { adapters })).status, 'FAILED')
    const { getMonthlyLedger, getWeeklyLedger } = await import('../server/domain/budget.ts')
    const monthly = getMonthlyLedger(db)
    assert.ok(monthly.settled_krw > 0)
    assert.equal(monthly.reserved_krw, 0)
    assert.equal(getWeeklyLedger(db).settled_krw, monthly.settled_krw)
    const log = db.prepare('SELECT est_krw FROM ai_action_logs WHERE called = 1').get() as { est_krw: number }
    assert.equal(log.est_krw, monthly.settled_krw)
  } finally { db.close() }
})

test('scheduler skips cooling accounts when another account can act', () => {
  const db = freshDb()
  const first = pickCandidate(db)!
  db.prepare('UPDATE ai_agents SET cooldown_until = ? WHERE id = ?').run(new Date(Date.now() + 60_000).toISOString(), first.id)
  assert.notEqual(pickCandidate(db)!.id, first.id)
  db.close()
})

test('a missing provider does not starve configured accounts', async () => {
  const db = freshDb()
  setStatus(db, 'RUNNING')
  setDemoMode(db, false)
  const missing = pickCandidate(db)!.provider
  const adapter = {
    ...demoOpenAiAdapter,
    isConfigured: () => false,
    generateAction: async () => { throw new Error('missing provider called') },
  }
  const real = { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter, [missing]: adapter }
  const result = await runTick(db, { adapters: { real, demo: real } })
  assert.equal(result.ticked, true)
  assert.notEqual((db.prepare('SELECT provider FROM ai_agents WHERE id = ?').get(result.agentId!) as { provider: string }).provider, missing)
  db.close()
})

test('HTTP routes reject malformed requests without mutating state and keep serving', async () => {
  const { Router } = await import('../server/http.ts')
  const { registerPublicRoutes } = await import('../server/api/publicRoutes.ts')
  const { registerAdminRoutes } = await import('../server/api/adminRoutes.ts')
  const db = freshDb()
  const router = new Router()
  const demo = { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter }
  registerPublicRoutes(router, db)
  registerAdminRoutes(router, db, { real: demo, demo })
  const server = createServer((req, res) => {
    router.handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } })
      .catch(() => { res.writeHead(599); res.end() })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  const base = `http://127.0.0.1:${address.port}/api/ai-community`
  const post = (path: string, body: string) => fetch(`${base}/admin/${path}`, {
    method: 'POST', headers: { 'x-admin-token': 'test-admin-token', 'content-type': 'application/json' }, body,
  })
  try {
    assert.equal((await fetch(`${base}/agents/%ZZ`)).status, 400)
    for (const query of ['limit=1.5', 'limit=-1', 'offset=Infinity', 'offset=0.5']) {
      assert.equal((await fetch(`${base}/feed?${query}`)).status, 200)
    }
    assert.equal((await post('mode', '{')).status, 400)
    assert.equal((await post('mode', 'null')).status, 400)
    assert.equal((await post('mode', '{}')).status, 400)
    assert.equal((await post('mode', '{"demoMode":"false"}')).status, 400)
    assert.equal(getRuntimeState(db).demo_mode, 1)
    const before = db.prepare('SELECT * FROM ai_settings ORDER BY key').all()
    for (const body of [
      { weeklyBudgetKrw: -1 }, { monthlyBudgetKrw: -1 }, { monthlyBudgetKrw: 40001 },
      { monthlyBudgetKrw: '40000' }, { safetyMargin: 2 }, { usdToKrwRate: 0 },
      { weeklyBudgetKrw: 500, pricing: [{ provider: 'unknown' }] },
      { weeklyBudgetKrw: '500' }, { pricing: {} },
    ]) assert.equal((await post('settings', JSON.stringify(body))).status, 400)
    assert.deepEqual(db.prepare('SELECT * FROM ai_settings ORDER BY key').all(), before)
    assert.equal((await post('agents/absent/toggle', '{"active":true}')).status, 404)
    assert.equal((await post('settings', '{"weeklyBudgetKrw":1000,"safetyMargin":0.2,"usdToKrwRate":1400}')).status, 200)
    const response = await fetch(`${base}/agents`)
    assert.equal(response.status, 200)
    const { agents } = await response.json() as { agents: Array<Record<string, unknown>> }
    assert.equal(agents.length, 10)
    assert.ok(agents.every(agent => !('provider' in agent) && !('model' in agent)))
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    db.close()
  }
})

function fakeAdapter(provider: 'openai' | 'anthropic', impl: { configured?: boolean; call?: (...args: unknown[]) => unknown }) {
  let calls = 0
  return {
    provider,
    isConfigured: () => impl.configured ?? true,
    generateAction: async (input: unknown) => {
      calls++
      if (impl.call) return impl.call(input)
      throw new Error('unexpected call')
    },
    get callCount() {
      return calls
    },
  }
}

test('10 agents are seeded as independent objects with isolated memories', () => {
  const db = freshDb()
  const agents = db.prepare('SELECT id, persona_key, system_prompt FROM ai_agents').all() as Array<{ id: string; persona_key: string; system_prompt: string }>
  assert.equal(agents.length, 10)
  assert.equal(new Set(agents.map(a => a.id)).size, 10)
  assert.equal(new Set(agents.map(a => a.persona_key)).size, 10)
  assert.equal(new Set(agents.map(a => a.system_prompt)).size, 10)

  appendMemory(db, 'yebin-seoul', 'yebin-seoul only secret')
  const yebinMemory = getPrivateMemories(db, 'yebin-seoul')
  const jieunMemory = getPrivateMemories(db, 'jieun-busan')
  assert.ok(yebinMemory.includes('yebin-seoul only secret'))
  assert.ok(!jieunMemory.includes('yebin-seoul only secret'))
})

test('fairness picks the least-recently-acted agent regardless of provider grouping', () => {
  const db = freshDb()
  // Deliberately interleave providers in the intended pick order so a provider-based
  // (team/turn-taking) scheduler would diverge from this exact sequence.
  const order = ['minho-seoul', 'yebin-seoul', 'weiwei-shanghai', 'jake-nyc', 'yuki-tokyo', 'liam-sydney', 'emma-london', 'haruto-osaka', 'jieun-busan', 'chenyu-taipei']
  const base = Date.now() - 1000 * order.length
  order.forEach((id, i) => {
    db.prepare('UPDATE ai_agents SET last_acted_at = ? WHERE id = ?').run(new Date(base + i * 1000).toISOString(), id)
  })

  const picked: string[] = []
  for (let i = 0; i < order.length; i++) {
    const candidate = pickCandidate(db)
    assert.ok(candidate)
    picked.push(candidate!.id)
    db.prepare('UPDATE ai_agents SET last_acted_at = ? WHERE id = ?').run(new Date().toISOString(), candidate!.id)
  }
  assert.deepEqual(picked, order)
})

test('a single runTick call invokes the model at most once', async () => {
  const db = freshDb()
  setStatus(db, 'RUNNING')
  let calls = 0
  const countingDemo = (base: typeof demoOpenAiAdapter) => ({
    ...base,
    generateAction: (...args: Parameters<typeof base.generateAction>) => {
      calls++
      return base.generateAction(...args)
    },
  })
  const adapters = {
    real: { openai: fakeAdapter('openai', {}), anthropic: fakeAdapter('anthropic', {}) },
    demo: { openai: countingDemo(demoOpenAiAdapter), anthropic: countingDemo(demoAnthropicAdapter) },
  }
  await runTick(db, { manual: false, adapters })
  assert.equal(calls, 1)
})

test('worker lock rejects a second concurrent holder until released', () => {
  const db = freshDb()
  assert.equal(acquireLock(db, 'holder-a'), true)
  assert.equal(acquireLock(db, 'holder-b'), false)
  releaseLock(db, 'holder-a')
  assert.equal(acquireLock(db, 'holder-b'), true)
})

test('the same agent is never scheduled a 4th consecutive time', () => {
  const db = freshDb()
  db.prepare('UPDATE ai_runtime_state SET consecutive_agent_id = ?, consecutive_count = 3 WHERE id = 1').run('yebin-seoul')
  const candidate = pickCandidate(db)
  assert.ok(candidate)
  assert.notEqual(candidate!.id, 'yebin-seoul')
})

test('insufficient weekly budget blocks the provider call before it happens (fails closed, no spend)', async () => {
  const db = freshDb()
  setStatus(db, 'RUNNING')
  setDemoMode(db, false)
  setSetting(db, 'weekly_budget_krw', '0')
  const realAdapter = fakeAdapter('openai', { call: () => { throw new Error('must not be called') } })
  const adapters = {
    real: { openai: realAdapter, anthropic: fakeAdapter('anthropic', { call: () => { throw new Error('must not be called') } }) },
    demo: { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter },
  }
  const outcome = await runTick(db, { manual: true, adapters })
  assert.equal(outcome.skipReason, 'BUDGET_LIMIT')
  assert.equal(realAdapter.callCount, 0)
  const log = db.prepare('SELECT * FROM ai_action_logs ORDER BY created_at DESC LIMIT 1').get() as { called: number; est_krw: number; status: string }
  assert.equal(log.called, 0)
  assert.equal(log.est_krw, 0)
  assert.equal(log.status, 'SKIPPED')
  assert.equal(getRuntimeState(db).status, 'PAUSED_BUDGET')
})

test('a missing provider key is SKIPPED with zero calls and zero cost, not a real call', async () => {
  const db = freshDb()
  setStatus(db, 'RUNNING')
  setDemoMode(db, false)
  const unconfigured = fakeAdapter('openai', { configured: false, call: () => { throw new Error('must not be called') } })
  const adapters = {
    real: { openai: unconfigured, anthropic: fakeAdapter('anthropic', { configured: false, call: () => { throw new Error('must not be called') } }) },
    demo: { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter },
  }
  const outcome = await runTick(db, { manual: true, adapters })
  assert.equal(outcome.skipReason, 'PROVIDER_KEY_MISSING')
  assert.equal(unconfigured.callCount, 0)
  const log = db.prepare('SELECT * FROM ai_action_logs ORDER BY created_at DESC LIMIT 1').get() as { called: number; est_krw: number; status: string; skip_reason: string }
  assert.equal(log.called, 0)
  assert.equal(log.est_krw, 0)
  assert.equal(log.status, 'SKIPPED')
  assert.equal(log.skip_reason, 'PROVIDER_KEY_MISSING')
})

test('IDLE_DECISION is an actual model call and is logged with non-zero token cost', async () => {
  const db = freshDb()
  setStatus(db, 'RUNNING')
  setDemoMode(db, false)
  const idleResponse = {
    action: 'IDLE_DECISION',
    targetType: null,
    targetId: null,
    title: null,
    body: null,
    reasonSummary: '지금은 지켜보기로 함',
    memoryPatch: '관망 결정',
  }
  const real = {
    openai: fakeAdapter('openai', { call: () => ({ raw: idleResponse, usage: { inputTokens: 100, outputTokens: 50 }, latencyMs: 5 }) }),
    anthropic: fakeAdapter('anthropic', { call: () => ({ raw: idleResponse, usage: { inputTokens: 100, outputTokens: 50 }, latencyMs: 5 }) }),
  }
  const adapters = { real, demo: { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter } }
  await runTick(db, { manual: true, adapters })
  const log = db.prepare('SELECT * FROM ai_action_logs ORDER BY created_at DESC LIMIT 1').get() as {
    called: number
    action: string
    status: string
    total_tokens: number
    est_krw: number
  }
  assert.equal(log.called, 1)
  assert.equal(log.action, 'IDLE_DECISION')
  assert.equal(log.status, 'SUCCESS')
  assert.equal(log.total_tokens, 150)
  assert.ok(log.est_krw > 0)
})

test('weekly budget resets on Asia/Seoul Monday 00:00 boundaries', () => {
  const mondayStart = getCurrentWeekKey(new Date('2026-09-13T15:00:00.000Z')) // Mon 00:00:00.000 KST
  const justBeforeMondayStart = getCurrentWeekKey(new Date('2026-09-13T14:59:59.999Z')) // Sun 23:59:59.999 KST
  const endOfSameWeek = getCurrentWeekKey(new Date('2026-09-20T14:59:59.999Z')) // following Sun 23:59:59.999 KST
  const nextMondayStart = getCurrentWeekKey(new Date('2026-09-20T15:00:00.000Z')) // following Mon 00:00:00.000 KST

  assert.equal(mondayStart, '2026-09-14')
  assert.equal(justBeforeMondayStart, '2026-09-07')
  assert.equal(endOfSameWeek, '2026-09-14')
  assert.equal(nextMondayStart, '2026-09-21')
})

test('DEMO mode never calls the real fetch API', async () => {
  const db = freshDb()
  setStatus(db, 'RUNNING')
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error('DEMO mode must never call fetch')
  }) as typeof fetch
  try {
    const adapters = {
      real: { openai: fakeAdapter('openai', { call: () => { throw new Error('must not be used in demo mode') } }), anthropic: fakeAdapter('anthropic', { call: () => { throw new Error('must not be used in demo mode') } }) },
      demo: { openai: demoOpenAiAdapter, anthropic: demoAnthropicAdapter },
    }
    for (let i = 0; i < 5; i++) await runTick(db, { manual: false, adapters })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('no server-only secret or provider key ever appears in client (src/) source', () => {
  const srcDir = join(import.meta.dirname, '..', 'src')
  // These check for actually reading/embedding a secret (env access, a real-looking key literal,
  // or importing server code into the client bundle) — not just mentioning a var *name* in UI copy.
  const forbidden = [
    /process\.env\.(OPENAI|ANTHROPIC)_API_KEY/,
    /import\.meta\.env\.VITE_(OPENAI|ANTHROPIC)/,
    /sk-[A-Za-z0-9_-]{16,}/,
    /from ['"]\.\.\/\.\.\/server/,
    /from ['"]\.\.\/server/,
  ]

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : [full]
    })
  }

  const files = walk(srcDir).filter(f => /\.(ts|tsx)$/.test(f))
  assert.ok(files.length > 0)
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(content), `${file} matched forbidden pattern ${pattern}`)
    }
  }
})
