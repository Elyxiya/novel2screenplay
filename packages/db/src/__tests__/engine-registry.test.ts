/**
 * EngineRegistry 测试（Task 4/6 补充）
 *
 * 覆盖不依赖真实 PG 的注册/选择语义：
 * - detectStorageKind：DATABASE_URL 探择
 * - useSqlite + getEngine + getStorageKind：注入与读取
 * - resetEngine：清空后 getEngine 抛错（防污染）
 * - 注意：不触发 usePostgres（会创建 worker 连真实 PG），PG 分支由 postgres-engine.test.ts 用 fake runner 覆盖
 */

import { describe, expect, it, afterEach } from 'vitest';
import { detectStorageKind, getEngine, getStorageKind, resetEngine, useSqlite } from '../engine/engine-registry.js';

const ORIG_DB_URL = process.env.DATABASE_URL;

afterEach(() => {
  resetEngine();
  if (ORIG_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIG_DB_URL;
});

/** 内存 SQLite 桩（仅需 prepare().run/get/all + close） */
function fakeSqlite() {
  const rows: unknown[][] = [];
  return {
    prepare: () => ({
      run: (...args: unknown[]) => {
        rows.push(args);
        return { changes: 1, lastInsertRowid: 1n };
      },
      get: () => rows[0] as unknown,
      all: () => rows as unknown[],
    }),
    pragma: () => [],
    exec: () => {},
    close: () => {},
  };
}

describe('detectStorageKind · 环境探择', () => {
  it('无 DATABASE_URL → sqlite', () => {
    delete process.env.DATABASE_URL;
    expect(detectStorageKind({})).toBe('sqlite');
    expect(detectStorageKind()).toBe('sqlite');
  });

  it('有 DATABASE_URL → postgres', () => {
    expect(detectStorageKind({ DATABASE_URL: 'postgres://u:p@h:5432/db' })).toBe('postgres');
  });
});

describe('useSqlite / getEngine / getStorageKind · 注入与读取', () => {
  it('useSqlite 注入后 getEngine 可用，kind=sqlite', () => {
    useSqlite(fakeSqlite() as never);
    expect(getEngine()).toBeTruthy();
    expect(getStorageKind()).toBe('sqlite');
  });

  it('getStorageKind 未注入时按 env 探测', () => {
    delete process.env.DATABASE_URL;
    expect(getStorageKind()).toBe('sqlite');
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/db';
    expect(getStorageKind()).toBe('postgres');
  });

  it('resetEngine 清空后 getEngine 抛错（防止跨测试污染）', () => {
    useSqlite(fakeSqlite() as never);
    resetEngine();
    expect(() => getEngine()).toThrow(/No storage engine registered/);
  });
});
