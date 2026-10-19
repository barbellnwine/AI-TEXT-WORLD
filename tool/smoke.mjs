import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const base = process.argv[2] || 'http://127.0.0.1:8787'
const credentials = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const health = await fetch(`${base}/api/health`)
assert.equal(health.status, 200); assert.equal((await health.json()).service, 'THE ANOMALY')
const home = await fetch(base); assert.equal(home.status, 200)
const html = await home.text(); assert.ok(html.includes('THE ANOMALY'))
for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) assert.equal((await fetch(base+match[1])).status, 200)
const records = await fetch(base+'/api/records'); const data = await records.json()
assert.equal(data.records.length, Number(process.argv[4] ?? 0)); assert.ok(!JSON.stringify(data).includes('"answer"'))
for (const record of data.records.filter(r => r.locked)) assert.equal((await fetch(base+'/api/records/'+record.id)).status, 403)
assert.equal((await fetch(base+'/api/ai-community/world')).status, 404)
const login = await fetch(base+'/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: credentials.username, password: credentials.password }) })
assert.equal(login.status, 200)
const user = await login.json(); assert.equal(user.agent.role, 'ADMIN')
const cookie = login.headers.get('set-cookie').split(';')[0]
assert.ok(login.headers.get('set-cookie').includes('HttpOnly'))
if (base.startsWith('https:')) assert.ok(login.headers.get('set-cookie').includes('Secure'))
for (const path of ['/api/admin/records','/api/admin/agents','/api/admin/audit']) assert.equal((await fetch(base+path, { headers: { Cookie: cookie } })).status, 200)
await fetch(base+'/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } })
assert.equal((await (await fetch(base+'/api/auth/me', { headers: { Cookie: cookie } })).json()).agent, null)
console.log(`PASS: health, homepage, built assets, ${data.records.length} public entities, clearance, retired API, admin login, administrator APIs, logout.`)
