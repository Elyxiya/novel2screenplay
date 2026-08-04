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
const DB_DIR = process.env.DB_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'data');
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

  // 兼容旧库：先补齐缺失列（幂等迁移），再初始化 schema（含依赖新列的索引）
  // 顺序不能反：旧库若直接跑 schema.sql，jobs(novel_id) 索引会因缺列而崩溃
  migrateJobColumns(database);
  migrateAuthColumns(database);
  migrateWriterColumns(database);
  initializeSchema(database);

  return database;
}

/**
 * 兼容旧数据库文件：为 jobs 表补齐缺失的列。
 * schema.sql 面向新库；已存在的旧库通过 ALTER TABLE 幂等补齐。
 */
function migrateJobColumns(database: Database.Database): void {
  try {
    const columns = (
      database.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>
    ).map((c) => c.name);

    const missingColumns: Array<{ name: string; ddl: string }> = [];
    if (!columns.includes('started_at')) {
      missingColumns.push({ name: 'started_at', ddl: 'started_at INTEGER' });
    }
    if (!columns.includes('completed_at')) {
      missingColumns.push({ name: 'completed_at', ddl: 'completed_at INTEGER' });
    }
    if (!columns.includes('pipeline_state')) {
      missingColumns.push({ name: 'pipeline_state', ddl: 'pipeline_state TEXT' });
    }
    if (!columns.includes('novel_id')) {
      missingColumns.push({ name: 'novel_id', ddl: 'novel_id TEXT' });
    }

    for (const col of missingColumns) {
      database.exec(`ALTER TABLE jobs ADD COLUMN ${col.ddl}`);
      console.log(`[DB] Migrated: added column jobs.${col.name}`);
    }
    database.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_novel_id ON jobs(novel_id)`);
    // 幂等建 novels 表（旧库走 ALTER 补齐后需补建表）
    database.exec(`
      CREATE TABLE IF NOT EXISTS novels (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        novel_text TEXT NOT NULL,
        chapter_texts TEXT NOT NULL,
        converted_chapters TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_job_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_novels_created_at ON novels(created_at);
      CREATE INDEX IF NOT EXISTS idx_novels_updated_at ON novels(updated_at);
    `);
  } catch (err) {
    // jobs 表不存在时静默（首次建表会走 schema.sql 完整结构）
    console.log(`[DB] Column migration skipped: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * 认证相关迁移：为旧库的 jobs/novels 补齐 user_id 列，
 * 并确保 users / sessions 表存在（schema.sql 已包含建表，此处幂等兜底）。
 */
function migrateAuthColumns(database: Database.Database): void {
  try {
    const addColumnIfMissing = (table: string, column: string, ddl: string): void => {
      const columns = (
        database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      ).map((c) => c.name);
      if (!columns.includes(column)) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        console.log(`[DB] Migrated: added column ${table}.${column}`);
      }
    };

    addColumnIfMissing('jobs', 'user_id', 'user_id TEXT');
    addColumnIfMissing('novels', 'user_id', 'user_id TEXT');
    addColumnIfMissing('history', 'user_id', 'user_id TEXT');
    database.exec('CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_novels_user_id ON novels(user_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_history_user_id ON history(user_id)');

    // 兜底建表（新库由 schema.sql 完成；旧库升级时补齐）
    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_used_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `);
  } catch (err) {
    console.log(`[DB] Auth migration skipped: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Writer 模块迁移：为 novels 表补齐创作侧列（分卷/人物卡/世界观/创作章节）。
 * 与上传资产（kind='upload'）共存于同一张表，经 kind 区分。
 */
function migrateWriterColumns(database: Database.Database): void {
  try {
    const columns = (
      database.prepare('PRAGMA table_info(novels)').all() as Array<{ name: string }>
    ).map((c) => c.name);

    const missingColumns: Array<{ name: string; ddl: string }> = [];
    if (!columns.includes('kind')) {
      missingColumns.push({ name: 'kind', ddl: "kind TEXT NOT NULL DEFAULT 'upload'" });
    }
    if (!columns.includes('synopsis')) {
      missingColumns.push({ name: 'synopsis', ddl: "synopsis TEXT NOT NULL DEFAULT ''" });
    }
    if (!columns.includes('volumes')) {
      missingColumns.push({ name: 'volumes', ddl: "volumes TEXT NOT NULL DEFAULT '[]'" });
    }
    if (!columns.includes('characters')) {
      missingColumns.push({ name: 'characters', ddl: "characters TEXT NOT NULL DEFAULT '[]'" });
    }
    if (!columns.includes('world_items')) {
      missingColumns.push({ name: 'world_items', ddl: "world_items TEXT NOT NULL DEFAULT '[]'" });
    }
    if (!columns.includes('draft_chapters')) {
      missingColumns.push({ name: 'draft_chapters', ddl: "draft_chapters TEXT NOT NULL DEFAULT '[]'" });
    }

    for (const col of missingColumns) {
      database.exec(`ALTER TABLE novels ADD COLUMN ${col.ddl}`);
      console.log(`[DB] Migrated: added column novels.${col.name}`);
    }
    database.exec('CREATE INDEX IF NOT EXISTS idx_novels_kind ON novels(kind)');
  } catch (err) {
    // novels 表不存在时静默（首次建表走 schema.sql 完整结构）
    console.log(`[DB] Writer migration skipped: ${err instanceof Error ? err.message : err}`);
  }
}

function initializeSchema(database: Database.Database): void {
  // 读取并执行 schema.sql
  const schemaPath = path.join(/* turbopackIgnore: true */ process.cwd(), 'src/lib/store/sqlite', 'schema.sql');
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
        started_at INTEGER,
        completed_at INTEGER,
        novel_text TEXT NOT NULL,
        chapter_texts TEXT NOT NULL,
        config TEXT NOT NULL,
        pipeline_state TEXT
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

      CREATE TABLE IF NOT EXISTS dramas (
        id TEXT PRIMARY KEY,
        source_job_id TEXT NOT NULL,
        source_novel_id TEXT,
        title TEXT NOT NULL,
        drama_yaml TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        user_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_dramas_source_job_id ON dramas(source_job_id);
      CREATE INDEX IF NOT EXISTS idx_dramas_created_at ON dramas(created_at);
      CREATE INDEX IF NOT EXISTS idx_dramas_user_id ON dramas(user_id);
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
