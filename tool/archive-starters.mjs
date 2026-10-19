import { readFileSync, writeFileSync } from 'node:fs'
const [base, credentialsPath, backupPath] = process.argv.slice(2)
if (!base || !credentialsPath || !backupPath) throw new Error('Usage: archive-starters.mjs <base-url> <credentials-file> <backup-json>')
const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'))
const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: credentials.username, password: credentials.password }) })
if (!login.ok) throw new Error('Administrator authentication failed')
const cookie = login.headers.get('set-cookie').split(';')[0]
try {
  const response = await fetch(`${base}/api/admin/records`, { headers: { Cookie: cookie } })
  if (!response.ok) throw new Error('Records backup failed')
  const data = await response.json()
  writeFileSync(backupPath, JSON.stringify(data,null,2), { flag: 'wx' })
  const names = { 'AN-001': '문 너머의 방문자', 'AN-002': '잊혀진 승강장', 'AN-003': '수신인 없는 편지', 'AN-004': '백색 주파수', 'AN-005': '거울 속 관측자' }
  let count = 0
  for (const record of data.records) {
    if (names[record.id] !== record.title) continue
    const result = await fetch(`${base}/api/admin/records`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...record, published: false, archived: true }) })
    if (!result.ok) throw new Error(`Archive failed for ${record.id}`)
    count++
  }
  const remaining = await (await fetch(`${base}/api/records`)).json()
  if (remaining.records.some(r => names[r.id] === r.title)) throw new Error('Starter records remain visible')
  console.log(`Archived ${count} starter records; ${remaining.records.length} public records remain. Original records backed up.`)
} finally { await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } }) }
