import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

test('production build serves mobile assets and preserves community data across restart', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  // Playwright clears test-results at startup; persistence tests must live outside it.
  const resultsDir = resolve(tmpdir())
  const directory = mkdtempSync(join(resultsDir, 'ai-amnesty-production-'))
  const token = randomUUID()
  let child: ChildProcess | undefined
  let origin = ''
  async function start() {
    child = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'production', PORT: '0', HOST: '127.0.0.1',
        AI_COMMUNITY_DB_PATH: join(directory, 'community.sqlite'), AI_COMMUNITY_ADMIN_TOKEN: token,
        AI_COMMUNITY_ENABLED: 'false', AI_COMMUNITY_DEMO_MODE: 'true',
        AI_COMMUNITY_COOLDOWN_MS: '0', AI_COMMUNITY_TICK_INTERVAL_MS: '3600000',
        OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout?.on('data', data => { output += String(data) })
    child.stderr?.resume()
    for (let attempt = 0; attempt < 100; attempt++) {
      const match = output.match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) { origin = match[1]; return }
      if (child.exitCode !== null) throw new Error('production server exited before listening')
      await delay(100)
    }
    throw new Error('production server startup timed out')
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const current = child
    await new Promise<void>(resolveStop => { current.once('exit', () => resolveStop()); current.kill() })
  }
  try {
    await start()
    assert.equal((await fetch(`${origin}/api/health`)).status, 200)
    const home = await fetch(origin)
    assert.equal(home.status, 200)
    const html = await home.text()
    assert.ok(html.includes('viewport-fit=cover'))
    assert.match(home.headers.get('content-security-policy')!, /frame-ancestors 'none'/)
    for (const secretPath of ['/.env', '/server/config.ts', '/data/ai-community.sqlite', '/assets/missing.js.map']) {
      assert.equal((await fetch(`${origin}${secretPath}`)).status, 404)
    }
    const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
    assert.ok(asset, 'build must contain a bundled script')
    assert.match((await fetch(`${origin}${asset}`)).headers.get('cache-control')!, /immutable/)
    assert.equal((await fetch(`${origin}/site.webmanifest`)).headers.get('content-type'), 'application/manifest+json; charset=utf-8')
    assert.equal((await fetch(`${origin}/api/ai-community/admin/status`)).status, 401)
    const headers = { 'x-admin-token': token }
    await fetch(`${origin}/api/ai-community/admin/start`, { method: 'POST', headers })
    for (let i = 0; i < 12; i++) {
      assert.equal((await fetch(`${origin}/api/ai-community/admin/tick`, { method: 'POST', headers })).status, 200)
    }
    const before = await (await fetch(`${origin}/api/ai-community/feed`)).json() as { items: unknown[] }
    assert.ok(before.items.length > 0)
    await stop()
    await start()
    const after = await (await fetch(`${origin}/api/ai-community/feed`)).json()
    assert.deepEqual(after, before)
  } finally {
    await stop()
    const target = resolve(directory)
    const within = relative(resultsDir, target)
    assert.ok(within.startsWith('ai-amnesty-production-') && !within.includes('..'))
    rmSync(target, { recursive: true, force: true })
  }
})
