/**
 * DbEngine 引擎层测试
 *
 * 验证：
 * - useSqlite 注入后 getEngine() 返回统一句柄
 * - prepare().run/get/all 与 better-sqlite3 语义一致（含 changes）
 * - 未注入时 getEngine() 抛出明确错误
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabase, closeDatabase } from '@/lib/store/sqlite/db';
import { getEngine, getStorageKind, resetEngine, useEngine } from '@/lib/store/sqlite';
import { getEngine as rawGetEngine } from '@novel/db';

describe('DbEngine 引擎层', () => {
  beforeEach(() => {
    // 保证有已注册引擎（getDatabase 内部会 useSqlite 注册）
    getDatabase();
  });

  afterEach(() => {
    // 只清理底层连接；引擎注册随下次 getDatabase 自动重建
    try {
      resetEngine();
    } catch {
      // 引擎已关闭时忽略
    }
    closeDatabase();
  });

  it('useSqlite 注册后 getEngine() 返回 SQLite 后端', () => {
    const engine = getEngine();
    expect(engine.getKind()).toBe('sqlite');
    expect(getStorageKind()).toBe('sqlite');
  });

  it('prepare().run/.get/.all 语义与 better-sqlite3 一致，含 changes', () => {
    const engine = getEngine();
    // 插入一条明文用户则验证 run/get/all
    const run1 = engine.prepare(
      `INSERT INTO users (id, username, password_hash, created_at, updated_at)
       VALUES ('u_engine_1', 'engine_user', 'hash', 1, 1)`,
    ).run();
    expect(run1.changes).toBe(1);

    const found = engine.prepare('SELECT id, username FROM users WHERE id = ?').get<{ id: string; username: string }>('u_engine_1');
    expect(found?.username).toBe('engine_user');

    const all = engine.prepare('SELECT username FROM users WHERE id = ?').all<{ username: string }>('u_engine_1');
    expect(all).toHaveLength(1);
    expect(all[0].username).toBe('engine_user');

    // 清理
    engine.prepare('DELETE FROM users WHERE id = ?').run('u_engine_1');
  });

  it('healthCheck() 返回 true', () => {
    expect(getEngine().healthCheck()).toBe(true);
  });

  it('未注入时 @novel/db 原生 getEngine() 抛出明确错误', () => {
    resetEngine();
    expect(() => rawGetEngine()).toThrow(/No storage engine registered/);
    // 恢复：重新注册供后续用例使用
    getDatabase();
  });

  it('app 层 getEngine() 未注册时自动初始化，不抛错', () => {
    resetEngine();
    // app 层 facade：引擎未注册 → 内部触发 getDatabase() 完成注册
    expect(getEngine().getKind()).toBe('sqlite');
  });

  it('useEngine 可注入自定义引擎覆盖后端', () => {
    const engine = getEngine();
    resetEngine();
    useEngine(engine);
    expect(getEngine()).toBe(engine);
    expect(getStorageKind()).toBe('sqlite');
  });
});