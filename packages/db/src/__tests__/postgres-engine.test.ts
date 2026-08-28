/**
 * PostgresEngine（sync-facade）+ registry 选择/回退 单元测试
 *
 * 用注入的 fake PgSyncRunner 验证 DbEngine 同步语义，不依赖真实 PG（决策 B：仅迁移脚本先行）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { PostgresEngine, type PgOp, type PgOpResult, type PgSyncRunner } from '../engine/postgres-engine.js';
import { SCHEMA_PG_SQL } from '../engine/schema-pg.js';
import {
  detectStorageKind,
  getEngine,
  getStorageKind,
  resetEngine,
  selectEngine,
  usePostgres,
} from '../engine/engine-registry.js';

/** 记录每次同步调用的 fake runner */
function makeFakeRunner(impl?: (op: PgOp) => PgOpResult): { runner: PgSyncRunner; calls: PgOp[] } {
  const calls: PgOp[] = [];
  const runner: PgSyncRunner = {
    sync: vi.fn((op: PgOp): PgOpResult => {
      calls.push(op);
      if (impl) return impl(op);
      // 默认：按 mode 返回空结果
      return { rows: [], changes: 0, lastInsertRowid: 0 };
    }),
    close: vi.fn(),
  };
  return { runner, calls };
}

describe('PostgresEngine · sync-facade', () => {
  it('prepare().run 返回 changes/lastInsertRowid，并按 mode=run 委托 runner', () => {
    const { runner, calls } = makeFakeRunner(() => ({
      rows: [{ id: 123 }],
      changes: 1,
      lastInsertRowid: 123,
    }));
    const engine = new PostgresEngine(runner);
    const res = engine.prepare('INSERT INTO jobs (id) VALUES (?)').run('123');
    expect(res.changes).toBe(1);
    expect(res.lastInsertRowid).toBe(123);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ sql: 'INSERT INTO jobs (id) VALUES ($1)', params: ['123'], mode: 'run' });
  });

  it('prepare().get 返回首行（未命中返回 undefined）', () => {
    const { runner } = makeFakeRunner((op) => {
      if (op.sql.includes('nope')) return { rows: [], changes: 0, lastInsertRowid: 0 };
      return { rows: [{ id: 'a', title: 'X' }], changes: 0, lastInsertRowid: 0 };
    });
    const engine = new PostgresEngine(runner);
    expect(engine.prepare('SELECT id, title FROM jobs').get()).toEqual({ id: 'a', title: 'X' });
    expect(engine.prepare('SELECT * FROM jobs WHERE id = nope').get()).toBeUndefined();
  });

  it('prepare().all 返回全部行', () => {
    const { runner, calls } = makeFakeRunner(() => ({
      rows: [{ id: 'a' }, { id: 'b' }],
      changes: 0,
      lastInsertRowid: 0,
    }));
    const engine = new PostgresEngine(runner);
    const rows = engine.prepare('SELECT id FROM jobs').all();
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(calls[0].mode).toBe('all');
  });

  it('exec / applySchema 走 mode=exec', () => {
    const { runner, calls } = makeFakeRunner();
    const engine = new PostgresEngine(runner);
    engine.exec('CREATE TABLE t (id text)');
    engine.applySchema();
    expect(calls[0]).toMatchObject({ sql: 'CREATE TABLE t (id text)', params: [], mode: 'exec' });
    expect(calls[1]).toMatchObject({ sql: SCHEMA_PG_SQL, mode: 'exec' });
  });

  it('healthCheck 成功 true / runner 抛错 false', () => {
    const ok = new PostgresEngine(makeFakeRunner().runner);
    expect(ok.healthCheck()).toBe(true);

    const boom = new PostgresEngine(
      makeFakeRunner(() => {
        throw new Error('conn refused');
      }).runner,
    );
    expect(boom.healthCheck()).toBe(false);
  });

  it('close 委托给 runner.close', () => {
    const { runner } = makeFakeRunner();
    const engine = new PostgresEngine(runner);
    engine.close();
    expect(runner.close).toHaveBeenCalledTimes(1);
  });
});

describe('registry · 引擎选择与回退', () => {
  afterEach(() => {
    resetEngine();
  });

  it('detectStorageKind：DATABASE_URL → postgres，否则 sqlite', () => {
    expect(detectStorageKind({})).toBe('sqlite');
    expect(detectStorageKind({ DATABASE_URL: 'postgres://x' })).toBe('postgres');
  });

  it('usePostgres 注入后可注入 runner；getEngine 返回 postgres 引擎', () => {
    const { runner } = makeFakeRunner();
    usePostgres('postgres://x', runner);
    expect(getEngine().getKind()).toBe('postgres');
    expect(getStorageKind()).toBe('postgres');
  });

  it('resetEngine 后 getEngine 抛错', () => {
    usePostgres('postgres://x', makeFakeRunner().runner);
    resetEngine();
    expect(() => getEngine()).toThrow(/No storage engine registered/);
  });

  it('selectEngine：无 DATABASE_URL 抛错（由上层回退 SQLite）', () => {
    expect(() => selectEngine({})).toThrow(/PG unavailable/);
  });

  it('PG healthCheck 失败 → 该引擎不被采纳（优雅回退由上层 registerEngine 承载）', () => {
    // 若不注入 runner，usePostgres 会 spin 真实 worker + 网络连接（本阶段无 PG）；
    // 因此这里用注入的 buggy runner 直接验证 healthCheck 兜底语义。
    const buggy = new PostgresEngine(
      makeFakeRunner(() => {
        throw new Error('connection refused');
      }).runner,
    );
    expect(buggy.healthCheck()).toBe(false);
    // 未注册任何引擎时，getStorageKind 按 env 探测（无 DATABASE_URL → sqlite）
    expect(getStorageKind()).toBe(process.env.DATABASE_URL ? 'postgres' : 'sqlite');
  });
});