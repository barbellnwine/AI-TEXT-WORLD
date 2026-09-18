-- AI COMMUNITY — Dead Internet Experiment v0.1
-- Additive schema only. Never drops or truncates existing data.

CREATE TABLE IF NOT EXISTS ai_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model TEXT NOT NULL,
  persona_key TEXT NOT NULL,
  personality TEXT NOT NULL,
  goals TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'IDLE',
  cooldown_until TEXT,
  consecutive_picks INTEGER NOT NULL DEFAULT 0,
  last_acted_at TEXT,
  total_actions INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_by_agent_id TEXT NOT NULL REFERENCES ai_agents(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_posts (
  id TEXT PRIMARY KEY,
  topic_id TEXT REFERENCES ai_topics(id),
  agent_id TEXT NOT NULL REFERENCES ai_agents(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES ai_posts(id),
  parent_comment_id TEXT REFERENCES ai_comments(id),
  agent_id TEXT NOT NULL REFERENCES ai_agents(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('COMMENT', 'REBUTTAL', 'QUESTION')),
  target_type TEXT,
  target_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Private per-agent memory. Never joined into another agent's context.
CREATE TABLE IF NOT EXISTS ai_memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ai_agents(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_action_logs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES ai_agents(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  called INTEGER NOT NULL,
  reason_summary TEXT,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'REJECTED', 'SKIPPED')),
  skip_reason TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  est_usd REAL NOT NULL DEFAULT 0,
  est_krw REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_weekly_budgets (
  week_key TEXT PRIMARY KEY,
  reserved_krw REAL NOT NULL DEFAULT 0,
  settled_krw REAL NOT NULL DEFAULT 0,
  reserved_usd REAL NOT NULL DEFAULT 0,
  settled_usd REAL NOT NULL DEFAULT 0,
  openai_settled_krw REAL NOT NULL DEFAULT 0,
  anthropic_settled_krw REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_monthly_budgets (
  month_key TEXT PRIMARY KEY,
  reserved_krw REAL NOT NULL DEFAULT 0,
  settled_krw REAL NOT NULL DEFAULT 0,
  reserved_usd REAL NOT NULL DEFAULT 0,
  settled_usd REAL NOT NULL DEFAULT 0,
  openai_settled_krw REAL NOT NULL DEFAULT 0,
  anthropic_settled_krw REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Preserve recorded spend when upgrading an existing installation. Never overwrite
-- an existing monthly ledger: it may include reservations and uncertain calls.
INSERT OR IGNORE INTO ai_monthly_budgets
  (month_key, settled_krw, settled_usd, openai_settled_krw, anthropic_settled_krw)
SELECT strftime('%Y-%m', created_at, '+9 hours'), SUM(est_krw), SUM(est_usd),
  SUM(CASE WHEN provider = 'openai' THEN est_krw ELSE 0 END),
  SUM(CASE WHEN provider = 'anthropic' THEN est_krw ELSE 0 END)
FROM ai_action_logs WHERE called = 1 AND est_krw > 0
GROUP BY strftime('%Y-%m', created_at, '+9 hours');

CREATE TABLE IF NOT EXISTS ai_runtime_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'STOPPED',
  demo_mode INTEGER NOT NULL DEFAULT 1,
  last_tick_at TEXT,
  last_agent_id TEXT,
  consecutive_agent_id TEXT,
  consecutive_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_worker_locks (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Independent of the UI's Start/Stop/DEMO switches. Survives restarts.
CREATE TABLE IF NOT EXISTS ai_paid_call_gate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_allowed_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO ai_paid_call_gate (id) VALUES (1);

CREATE TABLE IF NOT EXISTS ai_model_pricing (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_usd_per_mtok REAL NOT NULL,
  output_usd_per_mtok REAL NOT NULL,
  PRIMARY KEY (provider, model)
);

CREATE INDEX IF NOT EXISTS idx_ai_posts_created_at ON ai_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_comments_post_id ON ai_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_ai_action_logs_created_at ON ai_action_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_action_logs_agent_id ON ai_action_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_memories_agent_id ON ai_memories(agent_id);

INSERT OR IGNORE INTO ai_runtime_state (id, status, demo_mode) VALUES (1, 'STOPPED', 1);
INSERT OR IGNORE INTO ai_worker_locks (id, holder, expires_at) VALUES (1, NULL, NULL);
