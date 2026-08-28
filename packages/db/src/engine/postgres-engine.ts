/**
 * PostgresEngine - PostgreSQL 后端实现
 *
 * 实现 DbEngine（同步语义），把 prepare().run/get/all 与 exec/applySchema/healthCheck
 * 统一委托给「同步执行器」（默认 worker + Atomics 桥，测试可注入 fake）来执行。
 *
 * 调用方（repository/pipeline）零改动：拿到的 PreparedStatement 与 SQLite 形态一致，
 * 返回 { changes, lastInsertRowid } / 首行 / 全部行。
 */

import type { DbEngine, PreparedStatement, StorageKind } from './storage-engine.js';
import { SCHEMA_PG_SQL } from './schema-pg.js';
import { translateQuery } from './pg-params.js';

/** 一条同步执行的 PG 操作 */
export interface PgOp {
  sql: string;
  params: unknown[];
  mode: 'run' | 'get' | 'all' | 'exec';
}

/** 同步执行结果（对齐 better-sqlite3 run 的返回形状） */
export interface PgOpResult {
  changes: number;
  lastInsertRowid: bigint | number;
  rows: Record<string, unknown>[];
}

/** 同步执行器抽象：注入 worker 桥或测试 fake */
export interface PgSyncRunner {
  sync(op: PgOp): PgOpResult;
  close(): void;
}

export class PostgresEngine implements DbEngine {
  readonly kind: StorageKind = 'postgres';

  constructor(private readonly runner: PgSyncRunner) {}

  getKind(): StorageKind {
    return this.kind;
  }

  prepare(sql: string): PreparedStatement {
    const runner = this.runner;
    return {
      run(...params: unknown[]): { changes: number; lastInsertRowid: bigint | number } {
        const t = translateQuery(sql, params);
        const r = runner.sync({ sql: t.sql, params: t.values, mode: 'run' });
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
      get<T extends object = Record<string, unknown>>(...params: unknown[]): T | undefined {
        const t = translateQuery(sql, params);
        return runner.sync({ sql: t.sql, params: t.values, mode: 'get' }).rows[0] as T | undefined;
      },
      all<T extends object = Record<string, unknown>>(...params: unknown[]): T[] {
        const t = translateQuery(sql, params);
        return runner.sync({ sql: t.sql, params: t.values, mode: 'all' }).rows as T[];
      },
    };
  }

  exec(sql: string): void {
    this.runner.sync({ sql, params: [], mode: 'exec' });
  }

  applySchema(): void {
    this.exec(SCHEMA_PG_SQL);
  }

  healthCheck(): boolean {
    try {
      this.runner.sync({ sql: 'SELECT 1 AS ok', params: [], mode: 'all' });
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.runner.close();
  }
}