import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { once } from 'node:events'

process.env.AI_COMMUNITY_ADMIN_TOKEN = 'test-admin-token'

const { migrate } = await import('../server/db/connection.ts')
const { Router } = await import('../server/http.ts')
const { registerAuthRoutes } = await import('../server/api/authRoutes.ts')
const { hashPassword } = await import('../server/auth/password.ts')
const { createUser } = await import('../server/auth/users.ts')
const { seedAdminUser } = await import('../server/auth/seedAdmin.ts')
const { config } = await import('../server/config.ts')

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return db
}

async function startServer(db: DatabaseSync) {
  const router = new Router()
  registerAuthRoutes(router, db)
  const server = createServer((req, res) => { void router.handle(req, res) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return {
    base,
    async close() {
      server.closeAllConnections()
      await new Promise<void>(resolveClose => server.close(() => resolveClose()))
    },
  }
}

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie')
  assert.ok(raw, 'expected a set-cookie header')
  return raw!.split(';')[0]
}

test('signup creates a USER account, sets a session cookie, and rejects duplicate email', async () => {
  const db = freshDb()
  const { base, close } = await startServer(db)
  try {
    const res = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new-user@example.com', password: 'correct horse battery', nickname: 'Newbie' }),
    })
    assert.equal(res.status, 201)
    const body = await res.json() as { user: { role: string; email: string; id: string } }
    assert.equal(body.user.role, 'USER')
    assert.equal(body.user.email, 'new-user@example.com')
    assert.ok(!('password_hash' in body.user))
    const cookie = cookieFrom(res)

    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } })
    const meBody = await me.json() as { user: { id: string } | null }
    assert.equal(meBody.user?.id, body.user.id)

    const dupe = await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new-user@example.com', password: 'another password here', nickname: 'Dup' }),
    })
    assert.equal(dupe.status, 409)
  } finally { await close(); db.close() }
})

test('login rejects wrong password and accepts correct password, logout clears the session', async () => {
  const db = freshDb()
  createUser(db, { username: 'alice', nickname: 'Alice', provider: 'local', passwordHash: hashPassword('super-secret-pw') })
  const { base, close } = await startServer(db)
  try {
    const wrong = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'alice', password: 'nope' }),
    })
    assert.equal(wrong.status, 401)

    const ok = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'alice', password: 'super-secret-pw' }),
    })
    assert.equal(ok.status, 200)
    const cookie = cookieFrom(ok)

    const me1 = await fetch(`${base}/api/auth/me`, { headers: { cookie } })
    assert.equal(((await me1.json()) as { user: { username: string } | null }).user?.username, 'alice')

    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } })
    const me2 = await fetch(`${base}/api/auth/me`, { headers: { cookie } })
    assert.equal(((await me2.json()) as { user: unknown }).user, null)
  } finally { await close(); db.close() }
})

test('locale can only be changed by an authenticated user, and persists', async () => {
  const db = freshDb()
  createUser(db, { username: 'bob', nickname: 'Bob', provider: 'local', passwordHash: hashPassword('another-good-pw') })
  const { base, close } = await startServer(db)
  try {
    const anon = await fetch(`${base}/api/auth/locale`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'en-US' }),
    })
    assert.equal(anon.status, 401)

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'bob', password: 'another-good-pw' }),
    })
    const cookie = cookieFrom(login)
    const set = await fetch(`${base}/api/auth/locale`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ locale: 'en-US' }),
    })
    assert.equal(set.status, 200)
    const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } })
    assert.equal(((await me.json()) as { user: { locale: string } | null }).user?.locale, 'en-US')
  } finally { await close(); db.close() }
})

test('seedAdminUser is idempotent and only runs when both env vars are set', () => {
  const db = freshDb()
  try {
    const previousUser = config.adminSeedUsername
    const previousPass = config.adminSeedPassword
    try {
      config.adminSeedUsername = ''
      config.adminSeedPassword = ''
      seedAdminUser(db)
      const countRow = db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }
      assert.equal(countRow.n, 0)

      config.adminSeedUsername = 'admin'
      config.adminSeedPassword = 'seed-password-1234'
      seedAdminUser(db)
      seedAdminUser(db) // second call must not throw on the unique username or create a duplicate
      const rows = db.prepare('SELECT role FROM users WHERE username = ?').all('admin') as { role: string }[]
      assert.equal(rows.length, 1)
      assert.equal(rows[0].role, 'ADMIN')

      config.adminSeedUsername = 'second-admin'
      config.adminSeedPassword = 'another-seed-password'
      seedAdminUser(db)
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN'").get() as { n: number }).n, 1)
    } finally {
      config.adminSeedUsername = previousUser
      config.adminSeedPassword = previousPass
    }
  } finally { db.close() }
})

test('seedAdminUser rejects partial or weak bootstrap credentials before creating an admin', () => {
  const db = freshDb()
  const previousUser = config.adminSeedUsername
  const previousPass = config.adminSeedPassword
  try {
    config.adminSeedUsername = 'admin'
    config.adminSeedPassword = ''
    assert.throws(() => seedAdminUser(db), /must be set together/)
    config.adminSeedPassword = 'too-short'
    assert.throws(() => seedAdminUser(db), /12-200 characters/)
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN'").get() as { n: number }).n, 0)
  } finally {
    config.adminSeedUsername = previousUser
    config.adminSeedPassword = previousPass
    db.close()
  }
})
