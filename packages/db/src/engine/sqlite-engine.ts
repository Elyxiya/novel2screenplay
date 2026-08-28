/**
 * SqliteEngine - better-sqlite3 后端实现
 *
 * 包装底层 better-sqlite3 Database，暴露 DbEngine 成形接口。
 * 现有 repository 仅使用 prepare().run/get/all，因此适配面小而稳定。
 * 初始化/迁移逻辑仍由上层（app 的 store/sqlite/db）负责，引擎只承载执行。
 */

import type { DbEngine, PreparedStatement, StorageKind } from './storage-engine.js';

/** 对 better-sqlite3 Statement 的一层极薄包装，隔离驱动类型 */
function adaptStatement(stmt: {
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}): PreparedStatement {
  return {
    run(...params: unknown[]) {
      return stmt.run(...params);
    },
    get<T extends object = Record<string, unknown>>(...params: unknown[]): T | undefined {
      return stmt.get(...params) as T | undefined;
    },
    all<T extends object = Record<string, unknown>>(...params: unknown[]): T[] {
      return stmt.all(...params) as T[];
    },
  };
}

export interface SqliteLike {
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
  exec(sql: string): void;
  close(): void;
}

export class SqliteEngine implements DbEngine {
  readonly kind: StorageKind = 'sqlite';

  constructor(private readonly raw: SqliteLike) {}

  getKind(): StorageKind {
    return this.kind;
  }

  prepare(sql: string): PreparedStatement {
    return adaptStatement(this.raw.prepare(sql));
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  applySchema(): void {
    // schema 由上层（app 的 store/sqlite/db.createDatabase）负责初始化，
    // 引擎侧无需重复建表。
  }

  healthCheck(): boolean {
    try {
      this.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.raw.close();
  }
}