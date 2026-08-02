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
  pipeline_state TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

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

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_project_id ON history(project_id);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at);

-- Schema 版本表：用于数据库迁移
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT
);

-- 初始版本记录
INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial schema');
