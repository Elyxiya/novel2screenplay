/**
 * dual-backend 基础设施测试（Task 3 补充）
 *
 * 覆盖无真实 PG 环境下也能验证的纯逻辑：
 * - resolveTestPgUrl：PG 测试连接隔离（`_test` 后缀 / PG_TEST_DATABASE 覆盖 / 回退）
 * - activeBackends：无 DATABASE_URL 时仅 SQLite（有 URL 的分支在 R6 配好环境后由契约测试实跑）
 */

import { describe, expect, it, afterEach } from 'vitest';
import { activeBackends, resolveTestPgUrl } from './helpers/dual-backend';

const ORIG = {
  databaseUrl: process.env.DATABASE_URL,
  testDb: process.env.PG_TEST_DATABASE,
};

afterEach(() => {
  if (ORIG.databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIG.databaseUrl;
  if (ORIG.testDb === undefined) delete process.env.PG_TEST_DATABASE;
  else process.env.PG_TEST_DATABASE = ORIG.testDb;
});

describe('resolveTestPgUrl · PG 测试库隔离', () => {
  it('库名追加 _test 后缀（不落真实库）', () => {
    expect(resolveTestPgUrl('postgres://u:p@host:5432/mydb')).toBe('postgres://u:p@host:5432/mydb_test');
  });

  it('保留用户/密码/端口/query 参数', () => {
    const url = resolveTestPgUrl('postgres://alice:secret@db.internal:5433/app?sslmode=require');
    expect(url).toBe('postgres://alice:secret@db.internal:5433/app_test?sslmode=require');
  });

  it('PG_TEST_DATABASE 显式覆盖库名', () => {
    process.env.PG_TEST_DATABASE = 'dedicated_test';
    expect(resolveTestPgUrl('postgres://u:p@h:5432/prod')).toBe('postgres://u:p@h:5432/dedicated_test');
  });

  it('无法解析（无库名）时回退原 URL', () => {
    expect(resolveTestPgUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('activeBackends · 后端探测', () => {
  it('无 DATABASE_URL 时仅 SQLite', () => {
    delete process.env.DATABASE_URL;
    expect(activeBackends()).toEqual(['sqlite']);
  });

  it('有 DATABASE_URL 时追加 postgres（R6 配好环境后契约测试实跑）', () => {
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/db';
    expect(activeBackends()).toEqual(['sqlite', 'postgres']);
  });
});
