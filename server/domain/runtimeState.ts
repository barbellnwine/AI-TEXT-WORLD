import type { DatabaseSync } from 'node:sqlite'
import type { RuntimeStatus } from './types.ts'

export interface RuntimeStateRow {
  status: RuntimeStatus
  demo_mode: number
  last_tick_at: string | null
  last_agent_id: string | null
  consecutive_agent_id: string | null
  consecutive_count: number
}

export function getRuntimeState(db: DatabaseSync): RuntimeStateRow {
  return db.prepare('SELECT * FROM ai_runtime_state WHERE id = 1').get() as unknown as RuntimeStateRow
}

export function setStatus(db: DatabaseSync, status: RuntimeStatus): void {
  db.prepare(`UPDATE ai_runtime_state SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1`).run(status)
}

export function setDemoMode(db: DatabaseSync, demoMode: boolean): void {
  db.prepare(`UPDATE ai_runtime_state SET demo_mode = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1`).run(demoMode ? 1 : 0)
}

export function recordTick(db: DatabaseSync, agentId: string, isConsecutive: boolean): void {
  if (isConsecutive) {
    db.prepare(
      `UPDATE ai_runtime_state SET last_tick_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_agent_id = ?, consecutive_count = consecutive_count + 1 WHERE id = 1`
    ).run(agentId)
  } else {
    db.prepare(
      `UPDATE ai_runtime_state SET last_tick_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_agent_id = ?, consecutive_agent_id = ?, consecutive_count = 1 WHERE id = 1`
    ).run(agentId, agentId)
  }
}
