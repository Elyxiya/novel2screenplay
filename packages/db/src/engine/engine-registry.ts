/**
 * EngineRegistry - DbEngine 单例注册与选择
 *
 * 由上层（app）在启动时通过 useEngine() 注入当前引擎（SQLite 或 Postgres）。
 * 未注入时无可用引擎，调用方应先初始化。
 * 设计目标：repository 通过 getEngine() 取到统一存储句柄，引擎可替换而调用方零改动。
 */

import type { DbEngine, StorageKind } from './storage-engine.js';
import { SqliteEngine, type SqliteLike } from './sqlite-engine.js';
import { PostgresEngine, type PgSyncRunner } from './postgres-engine.js';
import { createPostgresWorkerRunner } from './postgres-runner.js';

let engine: DbEngine | null = null;

/** 探测当前存储类型：DATABASE_URL 存在 → postgres，否则 sqlite（默认） */
export function detectStorageKind(env: Record<string, string | undefined> = process.env): StorageKind {
  return env.DATABASE_URL ? 'postgres' : 'sqlite';
}

/** 注入当前引擎（应用启动时调用） */
export function useEngine(e: DbEngine): void {
  engine = e;
}

/** 用已有 SQLite 连接（SqliteLike）快速创建并注入 SqliteEngine */
export function useSqlite(raw: SqliteLike): SqliteEngine {
  const e = new SqliteEngine(raw);
  useEngine(e);
  return e;
}

/** 用 PostgreSQL 连接注入 PostgresEngine（runner 缺省走 worker+Atomics 同步桥） */
export function usePostgres(connectionString: string, runner?: PgSyncRunner): PostgresEngine {
  // 懒加载，避免未启用 PG 时引入 worker 开销
  const usedRunner = runner ?? createPostgresWorkerRunner(connectionString);
  const e = new PostgresEngine(usedRunner);
  useEngine(e);
  return e;
}

/** 按 env 选择并注入引擎；PG 连接不可用则优雅回退（抛回 SqliteLike 兜底由上层决定） */
export function selectEngine(env: Record<string, string | undefined> = process.env): DbEngine {
  if (env.DATABASE_URL) {
    try {
      const e = usePostgres(env.DATABASE_URL);
      if (e.healthCheck()) return e;
    } catch {
      // 连接失败，不注册，走上层 SQLite 兜底
    }
  }
  throw new Error('PG unavailable; caller should fall back to SQLite');
}

/** 获取当前引擎（未注入时抛错，提示先初始化） */
export function getEngine(): DbEngine {
  if (!engine) {
    // 避免在未初始化时静默返回 null，抛出明确错误
    throw new Error('No storage engine registered. Call useEngine() / useSqlite() first.');
  }
  return engine;
}

/** 当前引擎类型（未注入时按 env 探测，不注册） */
export function getStorageKind(): StorageKind {
  return engine ? engine.getKind() : detectStorageKind();
}

/** 关闭并清空当前引擎（测试/优雅关闭用） */
export function resetEngine(): void {
  if (engine) {
    try {
      engine.close();
    } catch {
      // 关闭失败不阻塞重置
    }
  }
  engine = null;
}