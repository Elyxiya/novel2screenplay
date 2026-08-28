/**
 * 双后端参数化测试基础设施（Task 3）
 *
 * 让同一组 repository 契约用例在 SQLite 与 Postgres 上各自跑一遍，验证行为一致。
 * - SQLite：恒跑（本机无 PG 环境的默认后端）。
 * - Postgres：仅当 DATABASE_URL 存在且连接可达时追加跑（决策 B：本阶段不搭 PG，
 *   R6 配好环境后自动启用；未配置时静默跳过，不影响本地回归）。
 *
 * 引擎由 suite 用 setupBackend(kind) 初始化（SQLite 内存库 / PG 真连接 + applySchema），
 * describeBackends 只负责按可用后端分组；setupBackend 返回 teardown 以清理引擎单例。
 */

import { describe } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { resetEngine, usePostgres as registerPostgres, useSqlite as registerSqlite, type StorageKind } from '@novel/db';

/** 当前可用的后端集合：DATABASE_URL 存在 → 追加 postgres，否则仅 sqlite */
export function activeBackends(): StorageKind[] {
  return process.env.DATABASE_URL ? ['sqlite', 'postgres'] : ['sqlite'];
}

/**
 * 对每个可用后端生成一组 describe（同名 suiteName + kind 后缀）。
 * @param suiteName  用例分组名
 * @param suite      用例工厂，benchmark 引擎无关行为，自身负责初始化/清理
 */
export function describeBackends(suiteName: string, suite: (kind: StorageKind) => void): void {
  for (const kind of activeBackends()) {
    describe(`${suiteName} [${kind}]`, () => suite(kind));
  }
}

/**
 * 为指定后端准备一个隔离的引擎与 schema，并注册为当前引擎（@novel/db 单例）。
 * 返回一个 `teardown()`：关闭连接并清空引擎单例，避免污染其他测试。
 *
 * - sqlite：内存库 + 应用 schema.sql（外键开启）。
 * - postgres：真实 PG（需 DATABASE_URL；调用方应已按 activeBackends() 判定可达）。
 *
 * PG 走 resolveTestPgUrl 解析到独立测试库命名空间（DB 级隔离），不落真实库。
 */

/**
 * 把 PG 连接 URL 解析到独立测试库命名空间（DB 级隔离，Task 3）。
 *
 * - 若显式提供 PG_TEST_DATABASE：直接用该库名覆盖（其余连接参数保留）。
 * - 否则在 URL 的库名上追加 `_test` 后缀（如 `mydb` → `mydb_test`），
 *   使参数化测试不落真实库；找不到/无法解析库名时回退原 URL。
 * 仅为满足「隔离」勾选项预留，随 R6 配好 PG 环境时生效；本阶段无 DATABASE_URL 不触发。
 */
export function resolveTestPgUrl(url: string): string {
  const testDb = process.env.PG_TEST_DATABASE;
  if (testDb) {
    try {
      const u = new URL(url);
      u.pathname = `/${testDb}`;
      return u.toString();
    } catch {
      return url;
    }
  }
  try {
    const u = new URL(url);
    const seg = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (seg.length > 0) {
      u.pathname = `/${seg.join('/')}_test`;
      return u.toString();
    }
  } catch {
    // 无法解析时回退原始连接
  }
  return url;
}

export function setupBackend(kind: StorageKind): () => void {
  if (kind === 'sqlite') {
    const sql = fs.readFileSync(path.join(process.cwd(), 'src/lib/store/sqlite/schema.sql'), 'utf-8');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(sql);
    registerSqlite(db);
    return () => {
      resetEngine();
      try {
        db.close();
      } catch {
        // 已关闭时忽略
      }
    };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('setupBackend("postgres") requires DATABASE_URL');
  }
  const pg = registerPostgres(resolveTestPgUrl(url));
  pg.applySchema();
  return () => resetEngine();
}