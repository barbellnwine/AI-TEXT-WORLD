import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore } from '../server/store.ts'
import { seedRecords } from './fixtures/starter-records.ts'

test('THE ANOMALY: authentication, clearance, publication, evidence, missions and persistence', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'anomaly-'))
  const path = join(directory, 'test.sqlite')
  const fixture = openStore(path)
  assert.equal(fixture.prepare('SELECT count(*) AS n FROM anomalies').get()!.n, 0)
  for (const record of seedRecords) fixture.prepare('INSERT INTO anomalies(id,document) VALUES(?,?)').run(record.id, JSON.stringify(record))
  fixture.close()
  const port = 19000 + Math.floor(Math.random() * 10000)
  const child = spawn(process.execPath, ['--experimental-strip-types','server/index.ts'], { env: { ...process.env, NODE_ENV: 'test', ANOMALY_DB_PATH: path, PORT: String(port), HOST: '127.0.0.1', ADMIN_SEED_USERNAME: 'test_admin', ADMIN_SEED_PASSWORD: 'only-for-test-password' }, stdio: ['ignore','pipe','pipe'] })
  t.after(() => { child.kill() })
  await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Server did not become ready')), 15000); child.stdout.on('data', chunk => { if (String(chunk).includes('listening')) { clearTimeout(timeout); resolve() } }); child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Server exit ${code}`)) }) })
  const base = `http://127.0.0.1:${port}`
  let adminCookie = ''; let agentCookie = ''; let agentId = 0
  async function request(path: string, method = 'GET', payload?: unknown, cookie = '') {
    return fetch(base + path, { method, headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: payload ? JSON.stringify(payload) : undefined })
  }
  await t.test('health and secret filtering', async () => {
    assert.equal((await request('/api/health')).status, 200)
    const response = await request('/api/records'); const value = await response.text()
    assert.equal(JSON.parse(value).records.length, 5)
    assert.ok(!value.includes('"answer"'))
    assert.ok(!value.includes('사용하지 않는 대역'))
    assert.ok(!value.includes('저는 아직 문을 열지 않았습니다'))
    assert.equal((await request('/api/records/AN-004')).status, 403)
    assert.equal((await request('/api/ai-community/world')).status, 404)
    assert.equal((await request('/data/ai-community.sqlite')).status, 404)
  })
  await t.test('register, login and role enforcement', async () => {
    const registration = await request('/api/auth/register', 'POST', { username: 'test_agent', password: 'agent-password', role: 'ADMIN', clearance: 5 })
    assert.equal(registration.status, 200); agentCookie = registration.headers.get('set-cookie')!.split(';')[0]
    const value = await registration.json(); agentId = value.agent.id; assert.equal(value.agent.clearance, 0); assert.equal(value.agent.role, 'AGENT')
    assert.ok(registration.headers.get('set-cookie')?.includes('HttpOnly'))
    assert.equal((await request('/api/admin/records', 'GET', undefined, agentCookie)).status, 403)
    assert.equal((await request('/api/auth/login', 'POST', { username: 'test_admin', password: 'wrong-password' })).status, 401)
    const login = await request('/api/auth/login', 'POST', { username: 'test_admin', password: 'only-for-test-password' }); assert.equal(login.status, 200); adminCookie = login.headers.get('set-cookie')!.split(';')[0]
    const external = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Origin: 'https://other.example', Cookie: adminCookie } }); assert.equal(external.status, 403)
  })
  await t.test('admin publication, scheduled chapters and permission updates', async () => {
    const { records } = await (await request('/api/admin/records', 'GET', undefined, adminCookie)).json()
    const draft = { ...records[0], id: 'AN-006', title: 'Test classified record', published: false, episodes: [{ title: 'Future episode', body: 'FUTURE_SECRET_123', clearance: 0, publishAt: '2099-01-01T00:00:00Z' }] }
    assert.equal((await request('/api/admin/records', 'PUT', draft, adminCookie)).status, 200)
    assert.equal((await request('/api/records/AN-006')).status, 404)
    draft.published = true; await request('/api/admin/records', 'PUT', draft, adminCookie)
    assert.ok(!(await (await request('/api/records/AN-006')).text()).includes('FUTURE_SECRET_123'))
    assert.equal((await request('/api/admin/records', 'PUT', { ...draft, clearance: 99 }, adminCookie)).status, 400)
    assert.equal((await request('/api/admin/agents', 'PATCH', { id: agentId, clearance: 1 }, adminCookie)).status, 200)
    assert.equal((await request('/api/records/AN-004','GET',undefined,agentCookie)).status, 200)
  })
  let fileUrl = ''
  await t.test('uploads enforce evidence clearance on direct download', async () => {
    const response = await fetch(base + '/api/admin/files?record=AN-001&title=test.wav&clearance=1', { method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'audio/wav' }, body: Buffer.from('RIFF-test-evidence') })
    assert.equal(response.status, 201); fileUrl = (await response.json()).url
    assert.equal((await request(fileUrl)).status, 403)
    assert.equal((await request(fileUrl, 'GET', undefined, agentCookie)).status, 200)
    const executable = await fetch(base + '/api/admin/files?record=AN-001&title=test.html&clearance=0', { method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'text/html' }, body: '<script>alert(1)</script>' }); assert.equal(executable.status, 415)
  })
  await t.test('discussion, moderation and mission results persist', async () => {
    assert.equal((await request('/api/records/AN-001/comments', 'POST', { body: 'not logged in' })).status, 401)
    assert.equal((await request('/api/records/AN-001/comments', 'POST', { body: '조사 단서입니다.' }, agentCookie)).status, 201)
    const { comments } = await (await request('/api/records/AN-001/comments')).json(); assert.equal(comments.length, 1)
    const wrong = await (await request('/api/records/AN-001/mission', 'POST', { answer: '4' }, agentCookie)).json(); assert.equal(wrong.correct, false)
    const right = await (await request('/api/records/AN-001/mission', 'POST', { answer: '3' }, agentCookie)).json(); assert.equal(right.correct, true)
    const state = await (await request('/api/records/AN-001/mission','GET',undefined,agentCookie)).json(); assert.equal(state.completed, true)
    const second = openStore(path); assert.equal(second.prepare('SELECT count(*) AS n FROM submissions').get()!.n, 1); assert.equal(second.prepare('SELECT count(*) AS n FROM files').get()!.n, 1); second.close()
    await request(`/api/admin/comments/${comments[0].id}`, 'DELETE', undefined, adminCookie)
    assert.equal((await (await request('/api/records/AN-001/comments')).json()).comments.length, 0)
    await request('/api/auth/logout','POST',undefined,agentCookie)
    assert.equal((await (await request('/api/auth/me','GET',undefined,agentCookie)).json()).agent, null)
    assert.equal((await request(fileUrl,'GET',undefined,agentCookie)).status, 403)
  })
  await t.test('archived starter content disappears while source records remain recoverable', async () => {
    const data = await (await request('/api/admin/records','GET',undefined,adminCookie)).json()
    const record = data.records.find((r: { id: string }) => r.id === 'AN-001')
    assert.equal((await request('/api/admin/records','PUT',{ ...record, published: false, archived: true },adminCookie)).status, 200)
    assert.equal((await request('/api/records/AN-001')).status, 404)
    assert.ok(!(await (await request('/api/admin/records','GET',undefined,adminCookie)).json()).records.some((r: { id: string }) => r.id === 'AN-001'))
    assert.equal((await request(fileUrl,'GET',undefined,adminCookie)).status, 403)
    const reopened = openStore(path)
    const archived = reopened.prepare('SELECT document FROM anomalies WHERE id=?').get('AN-001') as { document: string }
    assert.equal(JSON.parse(archived.document).archived, true)
    assert.equal(reopened.prepare('SELECT count(*) AS n FROM anomalies').get()!.n, 6)
    reopened.close()
  })
  await t.test('G-021 preserves the complete supplied record and supports G-prefix routes', async () => {
    const delivery = JSON.parse(readFileSync('content/G-021.json','utf8'))
    assert.equal((await request('/api/admin/records','PUT',delivery,adminCookie)).status,200)
    // Read as an agent: G-021 is members-only, so an anonymous read returns the gate, not the record.
    const response = await request('/api/records/G-021',undefined,undefined,adminCookie)
    assert.equal(response.status,200)
    const { record } = await response.json()
    assert.equal(record.id,'G-021'); assert.equal(record.risk,'ORANGE')
    assert.equal(record.coverImage,'/media/g-021-delivery.png')
    assert.deepEqual(record.sections,delivery.sections)
    assert.equal(record.sections.length,11);assert.equal(record.episodes.length,2)
    assert.equal(record.discovered,'2025년 겨울 / 대한민국 경기도')
    assert.equal((await request('/api/records/G-021/comments','POST',{body:'인원수 불일치 관련 조사 기록'},adminCookie)).status,201)
    assert.equal((await (await request('/api/records/G-021/comments',undefined,undefined,adminCookie)).json()).comments.length,1)
    assert.equal((await request('/api/admin/records','PUT',{...delivery,coverImage:'/media/../secret.png'},adminCookie)).status,400)
  })
  await t.test('G-013 preserves the complete supplied record and its four incident records', async () => {
    const inverse = JSON.parse(readFileSync('content/G-013.json','utf8'))
    assert.equal((await request('/api/admin/records','PUT',inverse,adminCookie)).status,200)
    // Read as an agent: G-013 is members-only, so an anonymous read returns the gate, not the record.
    const response = await request('/api/records/G-013',undefined,undefined,adminCookie)
    assert.equal(response.status,200)
    const { record } = await response.json()
    assert.equal(record.id,'G-013'); assert.equal(record.risk,'ORANGE')
    assert.equal(record.coverImage,'/media/g-013-inverse.png')
    assert.deepEqual(record.sections,inverse.sections)
    assert.equal(record.sections.length,8);assert.equal(record.episodes.length,4)
    assert.equal(record.discovered,'2025년 11월 / 대한민국 경기도')
    // Sections 03-06 are serialised as incidents; the card prints its own title, so the
    // source sub-heading belongs to the record body and must not repeat in the incident.
    assert.equal(record.sections.find((s:{number:string})=>s.number==='03').body.startsWith('### INCIDENT'),true)
    assert.equal(record.episodes[0].body.startsWith('###'),false)
    assert.deepEqual(record.episodes.map((e:{body:string})=>e.body),
      ['03','04','05','06'].map(n=>record.sections.find((s:{number:string})=>s.number===n).body.replace(/^###\s+.*\n+/,'')))
    // Both supplied records coexist in the public archive.
    const { records } = await (await request('/api/records')).json()
    assert.deepEqual(records.map((r:{id:string})=>r.id).filter((id:string)=>['G-013','G-021'].includes(id)).sort(),['G-013','G-021'])
  })
  await t.test('a members-only record withholds photograph and prose until an agent signs in', async () => {
    const inverse = { ...JSON.parse(readFileSync('content/G-013.json','utf8')), membersOnly: true }
    assert.equal((await request('/api/admin/records','PUT',inverse,adminCookie)).status,200)
    // Anonymous: the record still answers, so the page can explain itself, but carries nothing.
    const { record } = await (await request('/api/records/G-013')).json()
    assert.equal(record.locked,true); assert.equal(record.membersOnly,true)
    for (const key of ['coverImage','sections','description','protocol','episodes','evidence'])
      assert.equal(record[key],undefined,`${key} must not reach a reader with no agent`)
    // Name and risk stay, or there is nothing worth registering for.
    assert.equal(record.subtitle,'THE INVERSE'); assert.equal(record.riskLabel,'LEVEL III — ORANGE')
    assert.equal((await request('/api/records/G-013/comments')).status,401)
    // The photograph is served out of /media by a guessable name, so that path is gated too.
    assert.equal((await request('/media/g-013-inverse.png')).status,401)
    // An agent with clearance 0 - what registration grants - sees the whole record.
    assert.equal((await request('/api/auth/register','POST',{username:'observer_g13',password:'observer-pass-1'})).status,200)
    const cookie = (await request('/api/auth/login','POST',{username:'observer_g13',password:'observer-pass-1'})).headers.get('set-cookie').split(';')[0]
    const open = (await (await request('/api/records/G-013',undefined,undefined,cookie)).json()).record
    assert.equal(open.locked,undefined)
    assert.equal(open.sections.length,8); assert.equal(open.episodes.length,4)
    assert.equal(open.coverImage,'/media/g-013-inverse.png')
    assert.equal((await request('/media/g-013-inverse.png',undefined,undefined,cookie)).status,200)
    assert.equal((await request('/api/admin/records','PUT',JSON.parse(readFileSync('content/G-013.json','utf8')),adminCookie)).status,200)
  })
  await t.test('clearance hides complete record sections and cover metadata', async () => {
    const delivery = JSON.parse(readFileSync('content/G-021.json','utf8'))
    await request('/api/admin/records','PUT',{...delivery,id:'G-022',clearance:5},adminCookie)
    assert.equal((await request('/api/records/G-022')).status,403)
    const { records }=await (await request('/api/records')).json()
    const locked=records.find((r:{id:string})=>r.id==='G-022')
    assert.equal(locked.locked,true);assert.equal(locked.sections,undefined);assert.equal(locked.coverImage,undefined)
  })
})
