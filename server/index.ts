import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs'
import { resolve, extname, relative } from 'node:path'
import { openStore, getRecords, visibleRecord, type Agent, type Anomaly } from './store.ts'
import { hashPassword, verifyPassword } from './password.ts'

const db = openStore(process.env.ANOMALY_DB_PATH || 'data/the-anomaly.sqlite')
const production = process.env.NODE_ENV === 'production'
const dist = resolve('dist')
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const limits = new Map<string, { count: number; expires: number }>()
class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }
function fail(status: number, message: string): never { throw new HttpError(status, message) }
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON 형식만 허용됩니다.')
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 512_000) fail(413, '자료 크기가 너무 큽니다.'); chunks.push(chunk) }
  try { const parsed = JSON.parse(Buffer.concat(chunks).toString()); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed } catch { return fail(400, '올바른 JSON이 아닙니다.') }
}
function text(value: unknown, max = 20000, min = 1): string { if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, '입력 길이를 확인하십시오.'); return value.trim() }
function level(value: unknown): number { if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 5) fail(400, '인가 등급은 0–5입니다.'); return Number(value) }
function validateRecord(input: Record<string, unknown>): Anomaly {
  // TA is the live prefix. AN and G stay accepted so records filed under the old numbering,
  // and links handed out before the change, still resolve.
  const id = text(input.id, 16); if (!/^(?:TA|AN|G)-\d{3,6}$/.test(id)) fail(400, '개체 번호 형식: TA-021. 이전 AN·G 번호는 보존용으로만 받는다.')
  const risk = text(input.risk, 20); if (!['WHITE','YELLOW','ORANGE','RED','BLACK'].includes(risk)) fail(400, '위험 등급을 확인하십시오.')
  if (!Array.isArray(input.episodes) || !Array.isArray(input.evidence) || input.episodes.length > 100 || input.evidence.length > 100) fail(400, '사건·증거 배열을 확인하십시오.')
  const episodes = input.episodes.map((e: Record<string, unknown>) => { const publishAt = text(e.publishAt, 40); if (!Number.isFinite(Date.parse(publishAt))) fail(400, '공개 일시를 확인하십시오.'); return { title: text(e.title, 200), body: text(e.body), clearance: level(e.clearance), publishAt } })
  const evidence = input.evidence.map((e: Record<string, unknown>) => {
    const type = text(e.type, 20); if (!['image','audio','video','transcript'].includes(type)) fail(400, '증거 유형을 확인하십시오.')
    const url = typeof e.url === 'string' ? e.url : ''
    if (url && (!url.startsWith('https://') && !/^\/[\w./-]+$/.test(url))) fail(400, '증거 URL은 HTTPS 또는 로컬 자료 경로여야 합니다.')
    return { title: text(e.title, 200), type, url: text(url, 2000, 0), body: text(e.body, 20000, 0), clearance: level(e.clearance) }
  })
  let mission: Anomaly['mission'] = null
  if (input.mission) { const m = input.mission as Record<string, unknown>; mission = { title: text(m.title, 200), question: text(m.question, 1000), answer: text(m.answer, 200), clearance: level(m.clearance) } }
  const optional: Partial<Anomaly> = {}
  for (const key of ['riskLabel','phenomenon','discovered','region','recordStatus','incidentHeadline','unresolvedSection'] as const) if (input[key] !== undefined) optional[key] = text(input[key], 300, 0)
  // Pins the home hero to a chosen record instead of letting 식별번호 order decide it.
  if (input.featured !== undefined) optional.featured = input.featured === true
  if (input.membersOnly !== undefined) optional.membersOnly = input.membersOnly === true
  if (input.coverImage !== undefined) { const coverImage = text(input.coverImage, 300, 0); if (coverImage && !/^\/media\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/.test(coverImage)) fail(400, '공개 표지 이미지 경로를 확인하십시오.'); optional.coverImage = coverImage }
  if (input.sections !== undefined) {
    if (!Array.isArray(input.sections) || input.sections.length > 30) fail(400, '기록서 섹션을 확인하십시오.')
    optional.sections = input.sections.map((s: Record<string,unknown>) => ({ number: text(s.number, 4), title: text(s.title, 200), body: text(s.body) }))
  }
  return { ...optional, id, title: text(input.title, 100), subtitle: text(input.subtitle, 150), category: text(input.category, 30), risk, status: text(input.status, 40), clearance: level(input.clearance), summary: text(input.summary, 1000), description: text(input.description), protocol: text(input.protocol), art: ['door','platform','letter','frequency','mirror','delivery','inverse','observed','crown','lazyriver'].includes(String(input.art)) ? String(input.art) : 'door', published: input.published === true, archived: input.archived === true, episodes, evidence, mission }
}
function rate(req: IncomingMessage, key: string, max: number) {
  const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now()
  if (limits.size > 10000) for (const [k,v] of limits) if (v.expires < now) limits.delete(k)
  const k = `${ip}:${key}`; let entry = limits.get(k)
  if (!entry || entry.expires < now) { entry = { count: 0, expires: now + 60000 }; limits.set(k, entry) }
  if (++entry.count > max) fail(429, '요청이 너무 많습니다. 잠시 후 다시 시도하십시오.')
}
function current(req: IncomingMessage): Agent | undefined {
  const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('anomaly_session='))?.slice(16)
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return
  return db.prepare('SELECT a.id,a.username,a.role,a.clearance FROM agents a JOIN sessions s ON a.id=s.agent_id WHERE s.token=? AND s.expires>?').get(digest(token), Date.now()) as Agent | undefined
}
const cookie = (token: string, age: number) => `anomaly_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${production ? '; Secure' : ''}`
const audit = (agent: Agent, action: string, target: string) => db.prepare('INSERT INTO audit(agent_id,action,target) VALUES(?,?,?)').run(agent.id, action, target)
export const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
  try {
    const url = new URL(req.url || '/', 'http://localhost'); const path = decodeURIComponent(url.pathname); const method = req.method || 'GET'
    if (path.startsWith('/api/')) {
      rate(req, 'all', 180)
      if (!['GET','HEAD'].includes(method)) {
        const origin = req.headers.origin
        const allowed = process.env.APP_ORIGIN || `${production ? 'https' : 'http'}://${req.headers.host}`
        if (origin && origin !== allowed) fail(403, '허용되지 않은 요청 출처입니다.')
        if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, '외부 사이트 요청이 차단되었습니다.')
      }
      const agent = current(req)
      const fileMatch = path.match(/^\/api\/files\/([a-f0-9]{32})$/)
      if (fileMatch && method === 'GET') {
        const file = db.prepare('SELECT anomaly_id,mime,content FROM files WHERE id=?').get(fileMatch[1]) as { anomaly_id: string; mime: string; content: Uint8Array } | undefined
        if (!file) fail(404, '자료를 찾을 수 없습니다.')
        const record = getRecords(db).find(r => r.id === file.anomaly_id)
        const evidence = record?.evidence.find(e => e.url === path)
        if (!record || !evidence || (!record.published && agent?.role !== 'ADMIN') || (record.membersOnly && !agent) || Math.max(record.clearance, evidence.clearance) > (agent?.clearance ?? 0)) fail(403, '자료 접근 인가가 필요합니다.')
        res.writeHead(200, { 'content-type': file.mime, 'cache-control': 'private, no-store' }); return res.end(file.content)
      }
      if (path === '/api/health' && method === 'GET') { db.prepare('SELECT 1').get(); return json(res, 200, { ok: true, service: 'THE ANOMALY' }) }
      if (path === '/api/auth/me' && method === 'GET') return json(res, 200, { agent: agent || null })
      if (['/api/auth/register','/api/auth/login'].includes(path) && method === 'POST') {
        rate(req, 'auth', 10); const input = await body(req); const username = text(input.username, 24)
        if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 200) fail(400, '비밀번호는 8–200자입니다.')
        const password = input.password
        if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) fail(400, '요원 식별명은 영문·숫자·_·- 조합 3–24자입니다.')
        let user = db.prepare('SELECT * FROM agents WHERE username=?').get(username) as (Agent & { password: string }) | undefined
        if (path.endsWith('register')) {
          if (user) fail(409, '이미 등록된 식별명입니다.')
          db.prepare('INSERT INTO agents(username,password) VALUES(?,?)').run(username, hashPassword(password))
          user = db.prepare('SELECT * FROM agents WHERE username=?').get(username) as Agent & { password: string }
        } else if (!user || !verifyPassword(password, user.password)) fail(401, '식별명 또는 비밀번호가 일치하지 않습니다.')
        const token = randomBytes(32).toString('hex')
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), user!.id, Date.now() + 7 * 86400000)
        res.setHeader('set-cookie', cookie(token, 7 * 86400)); return json(res, 200, { agent: { id: user!.id, username, role: user!.role, clearance: user!.clearance } })
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('anomaly_session='))?.slice(16)
        if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token))
        res.setHeader('set-cookie', cookie('', 0)); return json(res, 200, { ok: true })
      }
      if (path.startsWith('/api/admin')) {
        if (!agent) fail(401, '로그인이 필요합니다.'); if (agent.role !== 'ADMIN') fail(403, '관리자 인가가 필요합니다.')
        if (path === '/api/admin/files' && method === 'POST') {
          const record = getRecords(db).find(r => r.id === url.searchParams.get('record'))
          if (!record) fail(404, '개체를 먼저 등록하십시오.')
          const mime = req.headers['content-type'] || ''
          const kinds: Record<string,string> = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'audio/mpeg': 'audio', 'audio/wav': 'audio', 'audio/x-wav': 'audio', 'video/mp4': 'video', 'video/webm': 'video' }
          if (!kinds[mime]) fail(415, 'JPG, PNG, WebP, MP3, WAV, MP4, WebM 자료만 허용됩니다.')
          const title = text(url.searchParams.get('title'), 200); const clearance = level(Number(url.searchParams.get('clearance')))
          let size = 0; const chunks: Buffer[] = []
          for await (const chunk of req) { size += chunk.length; if (size > 10 * 1024 * 1024) fail(413, '자료는 최대 10MB입니다.'); chunks.push(chunk) }
          if (!size) fail(400, '빈 파일입니다.')
          const id = randomBytes(16).toString('hex')
          record.evidence.push({ title, type: kinds[mime], clearance, url: `/api/files/${id}`, body: '관리국 업로드 자료' })
          db.exec('BEGIN')
          try { db.prepare('INSERT INTO files VALUES(?,?,?,?)').run(id, record.id, mime, Buffer.concat(chunks)); db.prepare('UPDATE anomalies SET document=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(record), record.id); audit(agent, 'UPLOAD_EVIDENCE', record.id); db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
          return json(res, 201, { ok: true, url: `/api/files/${id}` })
        }
        if (path === '/api/admin/records' && method === 'GET') return json(res, 200, { records: getRecords(db) })
        if (path === '/api/admin/records' && method === 'PUT') {
          const record = validateRecord(await body(req)); db.prepare('INSERT INTO anomalies(id,document) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,updated_at=CURRENT_TIMESTAMP').run(record.id, JSON.stringify(record)); audit(agent, 'SAVE_RECORD', record.id); return json(res, 200, { ok: true })
        }
        if (path === '/api/admin/agents' && method === 'GET') return json(res, 200, { agents: db.prepare('SELECT id,username,role,clearance,created_at FROM agents ORDER BY id').all() })
        if (path === '/api/admin/agents' && method === 'PATCH') {
          const input = await body(req); if (!Number.isInteger(input.id)) fail(400, '요원 ID를 확인하십시오.')
          const target = db.prepare('SELECT role FROM agents WHERE id=?').get(Number(input.id)); if (!target) fail(404, '요원을 찾을 수 없습니다.'); if (target.role === 'ADMIN') fail(403, '관리자 인가는 변경할 수 없습니다.')
          db.prepare('UPDATE agents SET clearance=? WHERE id=?').run(level(input.clearance), Number(input.id)); audit(agent, 'SET_CLEARANCE', String(input.id)); return json(res, 200, { ok: true })
        }
        if (path === '/api/admin/audit' && method === 'GET') return json(res, 200, { entries: db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all() })
        const deleteMatch = path.match(/^\/api\/admin\/comments\/(\d+)$/)
        if (deleteMatch && method === 'DELETE') { db.prepare('DELETE FROM comments WHERE id=?').run(Number(deleteMatch[1])); audit(agent, 'DELETE_COMMENT', deleteMatch[1]); return json(res, 200, { ok: true }) }
      }
      if (path === '/api/records' && method === 'GET') return json(res, 200, { records: getRecords(db).filter(r => r.published).map(r => visibleRecord(r, agent)).filter(Boolean) })
      const match = path.match(/^\/api\/records\/((?:TA|AN|G)-\d{3,6})(?:\/(comments|mission))?$/)
      if (match) {
        const record = getRecords(db).find(r => r.id === match[1]); if (!record || (!record.published && agent?.role !== 'ADMIN')) fail(404, '기록이 존재하지 않습니다.')
        if (record.clearance > (agent?.clearance ?? 0)) fail(403, '해당 기록에 대한 인가가 필요합니다.')
        // The record itself still answers, with the teaser visibleRecord builds, so the page can
        // explain why it is closed. Everything hanging off it stays shut to a reader with no agent.
        if (record.membersOnly && !agent && match[2]) fail(401, '요원 등록 후 열람할 수 있는 기록입니다.')
        if (!match[2] && method === 'GET') return json(res, 200, { record: visibleRecord(record, agent) })
        if (match[2] === 'comments') {
          if (method === 'GET') return json(res, 200, { comments: db.prepare('SELECT c.id,c.body,c.created_at,a.username,a.clearance FROM comments c JOIN agents a ON a.id=c.agent_id WHERE anomaly_id=? ORDER BY c.id DESC LIMIT 100').all(record.id) })
          if (method === 'POST') { if (!agent) fail(401, '로그인 후 조사에 참여할 수 있습니다.'); rate(req, 'comment', 10); const input = await body(req); db.prepare('INSERT INTO comments(anomaly_id,agent_id,body) VALUES(?,?,?)').run(record.id, agent.id, text(input.body, 2000)); return json(res, 201, { ok: true }) }
        }
        if (match[2] === 'mission') {
          if (!agent) fail(401, '요원 로그인이 필요합니다.')
          if (!record.mission || record.mission.clearance > agent.clearance) fail(403, '미션 접근 인가가 필요합니다.')
          if (method === 'GET') return json(res, 200, { completed: !!db.prepare('SELECT 1 FROM submissions WHERE agent_id=? AND anomaly_id=?').get(agent.id, record.id) })
          if (method === 'POST') { rate(req, 'mission', 20); const input = await body(req); const correct = text(input.answer, 200).normalize('NFKC').toLowerCase() === record.mission.answer.normalize('NFKC').toLowerCase(); if (correct) db.prepare('INSERT OR IGNORE INTO submissions(agent_id,anomaly_id) VALUES(?,?)').run(agent.id, record.id); return json(res, 200, { correct }) }
        }
      }
      return json(res, 404, { error: '존재하지 않는 API입니다.' })
    }
    if (!['GET','HEAD'].includes(method)) fail(405, '허용되지 않은 요청입니다.')
    if (path.split('/').some(p => p.startsWith('.')) || /^\/(data|server|src|node_modules|tool)(\/|$)/.test(path) || /\.(sqlite|env|ts|tsx|map)$/.test(path)) fail(404, '자료를 찾을 수 없습니다.')
    // Withholding a photograph from the API is not enough while the same file is served
    // straight out of /media by its own guessable name. A media file claimed by a
    // members-only record needs an agent, exactly as the record itself does.
    if (path.startsWith('/media/') && !current(req) && getRecords(db).some(r => r.membersOnly && (r.coverImage === path || r.evidence.some(e => e.url === path)))) fail(401, '요원 등록 후 열람할 수 있는 자료입니다.')
    const file = resolve(dist, '.' + path); if (relative(dist, file).startsWith('..')) fail(404, '자료를 찾을 수 없습니다.')
    const target = existsSync(file) && statSync(file).isFile() ? file : extname(path) ? '' : resolve(dist, 'index.html')
    if (!target || !existsSync(target)) fail(404, '자료를 찾을 수 없습니다.')
    const mime: Record<string,string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm' }
    const type = mime[extname(target)] || 'application/octet-stream'
    const head: Record<string,string> = { 'content-type': type, 'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }
    // A reel is seekable only if the player may ask for a slice of it, and a file that size must
    // not be read whole into memory to answer. Everything else is still sent in one piece.
    if (/^(video|audio)\//.test(type)) {
      const size = statSync(target).size
      head['accept-ranges'] = 'bytes'
      const asked = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim())
      if (asked && (asked[1] || asked[2])) {
        const start = asked[1] ? Number(asked[1]) : Math.max(0, size - Number(asked[2]))
        const end = asked[1] && asked[2] ? Math.min(Number(asked[2]), size - 1) : size - 1
        if (start >= size || start > end) { res.writeHead(416, { ...head, 'content-range': `bytes */${size}` }); return res.end() }
        res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) })
        if (method === 'HEAD') return res.end()
        return void createReadStream(target, { start, end }).on('error', () => res.destroy()).pipe(res)
      }
      res.writeHead(200, { ...head, 'content-length': String(size) })
      if (method === 'HEAD') return res.end()
      return void createReadStream(target).on('error', () => res.destroy()).pipe(res)
    }
    res.writeHead(200, head); res.end(method === 'HEAD' ? undefined : readFileSync(target))
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof URIError ? 400 : 500
    if (status === 500) console.error('[anomaly] Request failed', error instanceof Error ? error.message : 'unknown')
    if (!res.headersSent) json(res, status, { error: status === 500 ? '내부 오류가 발생했습니다.' : error instanceof Error ? error.message : '요청 오류' }); else res.end()
  }
})
server.requestTimeout = 15000; server.headersTimeout = 10000
server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log(`THE ANOMALY listening on port ${process.env.PORT || 8787}`))
function shutdown() { server.close(() => { db.close(); process.exit(0) }); setTimeout(() => process.exit(1), 10000).unref() }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
