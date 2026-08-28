/**
 * PostgreSQL schema（与 SQLite schema.sql 语义对齐）
 *
 * 迁移映射约定（保持「调用方零改动」）：
 * - 所有 JSON / 文本列一律用 TEXT（repository 以字符串往返 JSON.parse/stringify，
 *   若用 JSONB，pg 会返回已解析对象，导致上层 JSON.parse(object) 报错）。
 * - 时间戳/计数 INTEGER → BIGINT（ms 级时间戳远小于 2^53，同步到 Number 无精度损失）。
 * - 进度/阶段等小整数 INTEGER → INTEGER。REAL → DOUBLE PRECISION。
 * - `DEFAULT '[]'` → `DEFAULT '[]'`（TEXT 默认值即 JSON 字符串字面量）。
 * - `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`。
 */

export const SCHEMA_PG_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  current_phase INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  sub_progress TEXT,
  scenes_status TEXT,
  logs TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  result_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  started_at BIGINT,
  completed_at BIGINT,
  novel_text TEXT NOT NULL,
  chapter_texts TEXT NOT NULL,
  config TEXT NOT NULL,
  pipeline_state TEXT,
  novel_id TEXT,
  user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_novel_id ON jobs(novel_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);

CREATE TABLE IF NOT EXISTS novels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  novel_text TEXT NOT NULL,
  chapter_texts TEXT NOT NULL,
  converted_chapters TEXT NOT NULL DEFAULT '[]',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_job_id TEXT,
  user_id TEXT,
  kind TEXT NOT NULL DEFAULT 'upload',
  synopsis TEXT NOT NULL DEFAULT '',
  volumes TEXT NOT NULL DEFAULT '[]',
  characters TEXT NOT NULL DEFAULT '[]',
  world_items TEXT NOT NULL DEFAULT '[]',
  draft_chapters TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_novels_created_at ON novels(created_at);
CREATE INDEX IF NOT EXISTS idx_novels_updated_at ON novels(updated_at);
CREATE INDEX IF NOT EXISTS idx_novels_user_id ON novels(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source_novel_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  job_id TEXT NOT NULL,
  title TEXT,
  author TEXT,
  scene_count INTEGER,
  character_count INTEGER,
  location_count INTEGER,
  yaml_content TEXT,
  created_at BIGINT NOT NULL,
  user_id TEXT,
  CONSTRAINT fk_history_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_history_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_history_project_id ON history(project_id);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at);
CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at BIGINT NOT NULL,
  description TEXT
);
INSERT INTO schema_version (version, applied_at, description)
VALUES (1, (extract(epoch FROM now()) * 1000)::bigint, 'Initial schema')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  last_used_at BIGINT,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

INSERT INTO schema_version (version, applied_at, description)
VALUES (2, (extract(epoch FROM now()) * 1000)::bigint, 'Add auth: users & sessions, user_id on jobs/novels')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS dramas (
  id TEXT PRIMARY KEY,
  source_job_id TEXT NOT NULL,
  source_novel_id TEXT,
  title TEXT NOT NULL,
  drama_yaml TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_dramas_source_job_id ON dramas(source_job_id);
CREATE INDEX IF NOT EXISTS idx_dramas_created_at ON dramas(created_at);
CREATE INDEX IF NOT EXISTS idx_dramas_user_id ON dramas(user_id);

INSERT INTO schema_version (version, applied_at, description)
VALUES (3, (extract(epoch FROM now()) * 1000)::bigint, 'Add dramas: short-drama storyboard (screenplay -> shots)')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  user_id TEXT,
  task_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_id ON agent_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at ON agent_tasks(created_at);

INSERT INTO schema_version (version, applied_at, description)
VALUES (4, (extract(epoch FROM now()) * 1000)::bigint, 'Add agent_tasks: persist orchestrator tasks (P-记忆)')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_llm (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  default_model TEXT NOT NULL,
  supported_models TEXT NOT NULL DEFAULT '[]',
  context_window INTEGER NOT NULL DEFAULT 128000,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_llm_user_id ON user_llm(user_id);

INSERT INTO schema_version (version, applied_at, description)
VALUES (5, (extract(epoch FROM now()) * 1000)::bigint, 'Add user_llm: per-user custom LLM imports')
ON CONFLICT (version) DO NOTHING;

INSERT INTO schema_version (version, applied_at, description)
VALUES (6, (extract(epoch FROM now()) * 1000)::bigint, 'Encrypt user_llm.api_key (AES-GCM), migrate legacy plaintext')
ON CONFLICT (version) DO NOTHING;
`;