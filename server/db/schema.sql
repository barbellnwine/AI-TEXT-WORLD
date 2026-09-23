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

-- AI WORLD — real user accounts. Additive, site-wide (not AI-Community-specific).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  nickname TEXT NOT NULL,
  password_hash TEXT,
  provider TEXT NOT NULL DEFAULT 'local' CHECK (provider IN ('local', 'google', 'kakao')),
  provider_id TEXT,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  locale TEXT NOT NULL DEFAULT 'ko-KR',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider_id ON users(provider, provider_id) WHERE provider_id IS NOT NULL;

-- Session tokens are stored only as a SHA-256 digest (id column) — the raw token that goes
-- into the browser cookie is never persisted, mirroring the admin-token digest pattern above.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- AI WORLD — ADMIN WORLD BUILDER & CHARACTER SYSTEM.
-- These tables hold the *design-time* data the admin Wizard produces (WORLD RULE PRESET,
-- DRAFT WORLD, DRAFT CHARACTERS, etc). None of this replaces WORLD ENGINE / WORLD STATE
-- (server/domain/worldStore.ts, server/world/*.ts) — START WORLD hands a finished, validated
-- WorldState to that existing engine; the tables below never represent a *running* world.

-- WORLD RULE PRESET — a reusable, editable set of per-world rules (distinct from the
-- site-wide WORLD CONSTITUTION baked into every prompt at server/prompts/worldRules.ts,
-- which this Builder can never edit).
CREATE TABLE IF NOT EXISTS world_rule_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS world_rules (
  id TEXT PRIMARY KEY,
  preset_id TEXT NOT NULL REFERENCES world_rule_presets(id),
  category TEXT NOT NULL CHECK (category IN (
    'BASIC_PRINCIPLE','PHYSICS','SPACE_MOVEMENT','RESOURCE_ITEM','SURVIVAL_BODY',
    'EMOTION_DESIRE','RELATIONSHIP','KNOWLEDGE_INFO','TECHNOLOGY_SETTING','DEATH_INJURY','CUSTOM'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  system_locked INTEGER NOT NULL DEFAULT 0,
  custom INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_world_rules_preset ON world_rules(preset_id);

-- DRAFT WORLD — one row per world the admin is designing or has designed. START WORLD flips
-- status DRAFT/READY -> RUNNING; it never deletes this row (it becomes the historical record).
CREATE TABLE IF NOT EXISTS world_drafts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY','RUNNING','PAUSED','ENDED','ARCHIVED')),
  wizard_step INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL DEFAULT '',
  intro TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  season_name TEXT NOT NULL DEFAULT '',
  max_days INTEGER,
  sim_speed_ms INTEGER NOT NULL DEFAULT 60000,
  target_population INTEGER NOT NULL DEFAULT 10,
  is_public INTEGER NOT NULL DEFAULT 1,
  rule_preset_id TEXT REFERENCES world_rule_presets(id),
  start_day INTEGER NOT NULL DEFAULT 1,
  start_time TEXT NOT NULL DEFAULT '08:00',
  start_weather TEXT NOT NULL DEFAULT 'clear',
  start_temperature_c INTEGER NOT NULL DEFAULT 20,
  background_situation TEXT NOT NULL DEFAULT '',
  initial_event TEXT NOT NULL DEFAULT '',
  power_status TEXT NOT NULL DEFAULT '',
  initial_resources_json TEXT NOT NULL DEFAULT '[]',
  facility_status TEXT NOT NULL DEFAULT '',
  hidden_world_truth TEXT NOT NULL DEFAULT '',
  end_condition TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS draft_places (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES world_drafts(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'GENERIC',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1,
  is_discovered INTEGER NOT NULL DEFAULT 1,
  capacity INTEGER,
  resources_json TEXT NOT NULL DEFAULT '[]',
  items_json TEXT NOT NULL DEFAULT '[]',
  facility_status TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_draft_places_draft ON draft_places(draft_id);

CREATE TABLE IF NOT EXISTS draft_place_connections (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES world_drafts(id),
  from_place_id TEXT NOT NULL REFERENCES draft_places(id),
  to_place_id TEXT NOT NULL REFERENCES draft_places(id),
  travel_time INTEGER NOT NULL DEFAULT 5,
  connection_type TEXT NOT NULL DEFAULT 'PATH',
  blocked INTEGER NOT NULL DEFAULT 0,
  requirements TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_draft_connections_draft ON draft_place_connections(draft_id);

CREATE TABLE IF NOT EXISTS draft_characters (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES world_drafts(id),
  name TEXT NOT NULL DEFAULT '',
  age INTEGER,
  gender TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  occupation TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  strengths_json TEXT NOT NULL DEFAULT '[]',
  weaknesses_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai', 'anthropic')),
  model TEXT NOT NULL DEFAULT '',
  human_state_json TEXT NOT NULL DEFAULT '{"survival_need":5,"fatigue":3,"stress":3,"sexual_desire":3,"greed":3,"ambition":4}',
  emotion_json TEXT NOT NULL DEFAULT '{"mood":6,"anger":2,"fear":2}',
  knowledge_json TEXT NOT NULL DEFAULT '[]',
  private_info TEXT NOT NULL DEFAULT '',
  inventory_json TEXT NOT NULL DEFAULT '[]',
  initial_place_id TEXT REFERENCES draft_places(id),
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('AI_AUTO', 'MANUAL', 'AI_EDITED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_draft_characters_draft ON draft_characters(draft_id);

-- Directional: (A -> B) and (B -> A) are stored as two independent rows.
CREATE TABLE IF NOT EXISTS draft_relationships (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES world_drafts(id),
  from_character_id TEXT NOT NULL REFERENCES draft_characters(id),
  to_character_id TEXT NOT NULL REFERENCES draft_characters(id),
  trust INTEGER NOT NULL DEFAULT 5,
  affection INTEGER NOT NULL DEFAULT 5,
  attraction INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_rel_pair ON draft_relationships(draft_id, from_character_id, to_character_id);

-- Immutable copy of the rules actually in effect the moment START WORLD ran. Editing the
-- source world_rule_presets/world_rules afterward must never change an already-started world.
CREATE TABLE IF NOT EXISTS season_rule_snapshots (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES world_drafts(id),
  source_preset_id TEXT,
  rules_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_season_rule_snapshots_draft ON season_rule_snapshots(draft_id);
CREATE TABLE IF NOT EXISTS world_runtime_checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS world_event_journal (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  season_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_event_season ON world_event_journal(season_id, sequence);
CREATE TABLE IF NOT EXISTS draft_discoverable_truths (
  draft_id TEXT PRIMARY KEY REFERENCES world_drafts(id) ON DELETE CASCADE,
  payload TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS world_studio_config (
  draft_id TEXT PRIMARY KEY REFERENCES world_drafts(id) ON DELETE CASCADE,
  payload TEXT NOT NULL
);
