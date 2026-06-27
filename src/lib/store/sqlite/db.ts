/**
 * SQLite 数据库连接与初始化
 *
 * 使用 better-sqlite3 实现同步数据库操作。
 * 在 Next.js 环境中通过 globalThis 保持单例，
 * 避免热重载时重复创建连接。
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// 数据库文件路径配置
const DB_DIR = process.env.DB_DIR || path.join(process.cwd(), 'data');
const DB_FILE = process.env.DB_FILE || 'novel2screenplay.db';

let db: Database.Database | null = null;

/**
 * 获取数据库实例（单例）
 */
export function getDatabase(): Database.Database {
  if (typeof globalThis === 'undefined') {
    // SSR 环境，直接创建
    return createDatabase();
  }

  const GLOBAL_KEY = '__novel2screenplay_db__';

  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = createDatabase();
  }

  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Database.Database;
}

function createDatabase(): Database.Database {
  // 确保目录存在
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const dbPath = path.join(DB_DIR, DB_FILE);
  console.log(`[DB] Opening database at: ${dbPath}`);

  const database = new Database(dbPath, {
    verbose: process.env.DB_VERBOSE === 'true' ? console.log : undefined,
  });

  // 启用 WAL 模式提升并发性能
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  // 初始化 schema
  initializeSchema(database);

  return database;
}

function initializeSchema(database: Database.Database): void {
  // 读取并执行 schema.sql
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    database.exec(schema);
    console.log('[DB] Schema initialized');
  } else {
    // 内联创建表（如果 schema.sql 不存在）
    database.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        current_phase INTEGER NOT NULL DEFAULT 0,
        progress INTEGER NOT NULL DEFAULT 0,
        sub_progress REAL,
        scenes_status TEXT,
        logs TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        result_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        novel_text TEXT NOT NULL,
        chapter_texts TEXT NOT NULL,
        config TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        source_novel_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
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
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_history_project_id ON history(project_id);
      CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at);

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      );
    `);
    console.log('[DB] Schema initialized (inline)');
  }
}

/**
 * 关闭数据库连接（用于测试或优雅关闭）
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    if (typeof globalThis !== 'undefined') {
      (globalThis as Record<string, unknown>).__novel2screenplay_db__ = undefined;
    }
  }
}

/**
 * 执行数据库迁移
 */
export function runMigrations(): void {
  const database = getDatabase();

  // 检查当前版本
  const row = database.prepare(`
    SELECT MAX(version) as version FROM schema_version
  `).get() as { version: number | null };

  const currentVersion = row?.version ?? 0;

  // TODO: 添加更多迁移脚本
  // if (currentVersion < 2) {
  //   migrateToV2(database);
  // }

  console.log(`[DB] Current schema version: ${currentVersion}`);
}

/**
 * 健康检查
 */
export function healthCheck(): boolean {
  try {
    const db = getDatabase();
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}
