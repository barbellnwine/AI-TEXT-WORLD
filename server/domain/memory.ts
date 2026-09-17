import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

const MAX_MEMORIES_PER_AGENT = 30

// Agent memories are strictly per-agent: this query never accepts a second agentId, so one
// agent's private memory can never be read into another agent's prompt context.
export function getPrivateMemories(db: DatabaseSync, agentId: string, limit = 10): string[] {
  const rows = db
    .prepare('SELECT content FROM ai_memories WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(agentId, limit) as Array<{ content: string }>
  return rows.map(r => r.content).reverse()
}

export function appendMemory(db: DatabaseSync, agentId: string, content: string): void {
  if (!content.trim()) return
  db.prepare('INSERT INTO ai_memories (id, agent_id, content) VALUES (?, ?, ?)').run(randomUUID(), agentId, content.slice(0, 400))

  const countRow = db.prepare('SELECT COUNT(*) AS n FROM ai_memories WHERE agent_id = ?').get(agentId) as { n: number }
  if (countRow.n > MAX_MEMORIES_PER_AGENT) {
    db.prepare(
      `DELETE FROM ai_memories WHERE id IN (
         SELECT id FROM ai_memories WHERE agent_id = ? ORDER BY created_at ASC LIMIT ?
       )`
    ).run(agentId, countRow.n - MAX_MEMORIES_PER_AGENT)
  }
}
