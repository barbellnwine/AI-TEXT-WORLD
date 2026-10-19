import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { hashPassword } from './password.ts'

export type Episode = { title: string; body: string; clearance: number; publishAt: string }
export type Evidence = { title: string; type: string; url: string; body: string; clearance: number }
export type Anomaly = { id: string; title: string; subtitle: string; coverImage?: string; riskLabel?: string; phenomenon?: string; discovered?: string; region?: string; recordStatus?: string; featured?: boolean; membersOnly?: boolean; incidentHeadline?: string; sections?: { number: string; title: string; body: string }[]; category: string; risk: string; status: string; clearance: number; summary: string; description: string; protocol: string; art: string; published: boolean; archived?: boolean; episodes: Episode[]; evidence: Evidence[]; mission: { title: string; question: string; answer: string; clearance: number } | null }
export type Agent = { id: number; username: string; role: string; clearance: number }
export function openStore(path: string) {
  mkdirSync(dirname(resolve(path)), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS agents(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'AGENT', clearance INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS anomalies(id TEXT PRIMARY KEY, document TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, anomaly_id TEXT NOT NULL REFERENCES anomalies(id), agent_id INTEGER NOT NULL REFERENCES agents(id), body TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS submissions(agent_id INTEGER NOT NULL REFERENCES agents(id), anomaly_id TEXT NOT NULL REFERENCES anomalies(id), completed_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(agent_id,anomaly_id));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, agent_id INTEGER, action TEXT NOT NULL, target TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, anomaly_id TEXT NOT NULL REFERENCES anomalies(id), mime TEXT NOT NULL, content BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT);`)
  const name = process.env.ADMIN_SEED_USERNAME
  const password = process.env.ADMIN_SEED_PASSWORD
  if (!db.prepare("SELECT 1 FROM agents WHERE role='ADMIN'").get() && name && password) {
    if (!/^[a-zA-Z0-9_-]{3,24}$/.test(name) || password.length < 12 || password.length > 200) throw new Error('Admin seed requires a valid username and a 12–200 character password')
    const existing = db.prepare('SELECT 1 FROM agents WHERE username=?').get(name)
    if (existing) throw new Error('Admin seed username is already registered. Use a distinct administrator username.')
    db.prepare("INSERT INTO agents(username,password,role,clearance) VALUES(?,?,'ADMIN',5)").run(name, hashPassword(password))
  }
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now())
  return db
}
export function getRecords(db: DatabaseSync): Anomaly[] {
  return (db.prepare('SELECT document FROM anomalies ORDER BY id').all() as { document: string }[]).map(r => JSON.parse(r.document) as Anomaly).filter(r => !r.archived)
}
export function visibleRecord(record: Anomaly, agent?: Agent) {
  const level = agent?.role === 'ADMIN' ? 5 : (agent?.clearance ?? 0)
  if (!record.published && agent?.role !== 'ADMIN') return null
  // Separate from clearance: a new agent also holds level 0, so clearance cannot express
  // "signed in at all". The teaser keeps the name and risk — enough to be worth registering
  // for — and withholds the photograph, the prose, the incidents and the evidence.
  if (record.membersOnly && !agent) return { id: record.id, title: record.title, subtitle: record.subtitle, category: record.category, risk: record.risk, riskLabel: record.riskLabel, status: record.status, phenomenon: record.phenomenon, clearance: record.clearance, art: record.art, featured: record.featured, locked: true, membersOnly: true, summary: '요원 등록 후 열람할 수 있는 기록입니다.' }
  if (record.clearance > level) return { id: record.id, title: '기밀 접근 제한', subtitle: 'ACCESS RESTRICTED', category: record.category, risk: record.risk, status: record.status, clearance: record.clearance, art: record.art, locked: true, summary: `LEVEL ${record.clearance} 인가가 필요한 기록입니다.` }
  const admin = agent?.role === 'ADMIN'
  return { ...record, episodes: record.episodes.filter(e => admin || new Date(e.publishAt).getTime() <= Date.now()).map(e => e.clearance <= level ? e : { title: e.title, clearance: e.clearance, locked: true }), evidence: record.evidence.map(e => e.clearance <= level ? e : { title: e.title, type: e.type, clearance: e.clearance, locked: true }), mission: record.mission ? { title: record.mission.title, clearance: record.mission.clearance, ...(record.mission.clearance <= level ? { question: record.mission.question } : { locked: true }) } : null }
}
