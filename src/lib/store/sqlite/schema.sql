-- Novel2Screenplay Database Schema
-- Version: 001

-- Jobs 表：存储转换任务
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  current_phase INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,
  sub_progress REAL,
  scenes_status TEXT, -- JSON array of SceneStatus
  logs TEXT NOT NULL DEFAULT '[]', -- JSON array of LogEntry
  error TEXT,
  result_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,

  -- Pipeline 相关字段
  novel_text TEXT NOT NULL,
  chapter_texts TEXT NOT NULL, -- JSON array

  -- Config
  config TEXT NOT NULL, -- JSON: {modelId, selectedChapters, temperature}

  -- Pipeline State (JSON 序列化)
  pipeline_state TEXT,

  -- 关联小说资产（工作台续转）
  novel_id TEXT,

  -- 归属用户（多用户数据隔离，NULL 表示旧库遗留数据）
  user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_novel_id ON jobs(novel_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);

-- Novels 表：小说资产（工作台上传历史）
CREATE TABLE IF NOT EXISTS novels (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  novel_text TEXT NOT NULL,
  chapter_texts TEXT NOT NULL, -- JSON array of {title, text, paragraphCount}
  converted_chapters TEXT NOT NULL DEFAULT '[]', -- JSON array of 已转换章节索引
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_job_id TEXT,

  -- 归属用户（多用户数据隔离）
  user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_novels_created_at ON novels(created_at);
CREATE INDEX IF NOT EXISTS idx_novels_updated_at ON novels(updated_at);
CREATE INDEX IF NOT EXISTS idx_novels_user_id ON novels(user_id);

-- Projects 表：存储项目（用户创建的转换项目）
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source_novel_id TEXT, -- 关联到第一个 Job
  status TEXT NOT NULL DEFAULT 'active', -- active, archived, deleted
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT -- JSON: {totalConversions, totalScenes, totalCharacters}
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);

-- History 表：存储转换历史记录
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  job_id TEXT NOT NULL,
  title TEXT,
  author TEXT,
  scene_count INTEGER,
  character_count INTEGER,
  location_count INTEGER,
  yaml_content TEXT, -- 完整剧本 YAML
  created_at INTEGER NOT NULL,
  user_id TEXT, -- 归属用户（多用户数据隔离）

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_project_id ON history(project_id);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at);
CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id);

-- Schema 版本表：用于数据库迁移
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

-- 初始版本记录
INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial schema');

-- Users 表：用户账户
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL, -- scrypt: salt$hash（hex）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Sessions 表：登录会话（token 仅存哈希，cookie 存明文 token）
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Schema 版本记录：认证功能
INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (2, strftime('%s', 'now') * 1000, 'Add auth: users & sessions, user_id on jobs/novels');

-- Dramas 表：短剧分镜（剧本 → 分镜转换结果，溯源 source_job_id → jobs.id）
CREATE TABLE IF NOT EXISTS dramas (
  id TEXT PRIMARY KEY,
  source_job_id TEXT NOT NULL, -- 溯源：来源剧本任务 ID（jobs.id）
  source_novel_id TEXT, -- 溯源：来源小说资产 ID（novels.id，可为空）
  title TEXT NOT NULL,
  drama_yaml TEXT NOT NULL, -- 分镜 YAML 全文（novel2drama-v1）
  created_at INTEGER NOT NULL,
  user_id TEXT -- 归属用户（多用户数据隔离）
);

CREATE INDEX IF NOT EXISTS idx_dramas_source_job_id ON dramas(source_job_id);
CREATE INDEX IF NOT EXISTS idx_dramas_created_at ON dramas(created_at);
CREATE INDEX IF NOT EXISTS idx_dramas_user_id ON dramas(user_id);

-- Schema 版本记录：短剧分镜
INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (3, strftime('%s', 'now') * 1000, 'Add dramas: short-drama storyboard (screenplay -> shots)');
