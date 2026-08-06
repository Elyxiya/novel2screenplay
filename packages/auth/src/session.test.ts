// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock next/headers：模拟 Cookie 存储，验证会话全生命周期
vi.mock('next/headers', () => {
  const store = new Map<string, { value: string; opts: Record<string, unknown> }>();
  return {
    cookies: vi.fn(async () => ({
      get: (k: string) => (store.has(k) ? { name: k, value: store.get(k)!.value } : undefined),
      set: (k: string, v: string, opts: Record<string, unknown> = {}) => store.set(k, { value: v, opts }),
      delete: (k: string) => store.delete(k),
    })),
    __store: store,
  };
});

import type { AuthDatabase } from './store';
import { configureAuth, __resetAuthStore } from './store';
import { hashPassword } from './password';
import { createSession, setSessionCookie, getSessionUser, destroySession, SESSION_COOKIE, cleanupExpiredSessions } from './session';
import { getCurrentPublicUser } from './index';

describe('session 会话管理（@novel/auth）', () => {
  let db: InstanceType<typeof Database>;
  let userId: string;
  let username: string;

  beforeAll(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );
    `);

    const hash = await hashPassword('test-pass');
    const now = Date.now();
    userId = `user_session_${now}`;
    username = 'session_user';
    db.prepare(
      'INSERT INTO users (id, username, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(userId, username, 's@t.dev', hash, now, now);

    configureAuth({
      getDatabase: () => db as unknown as AuthDatabase,
      getUserById: (id: string) => {
        const row = db
          .prepare('SELECT id, username, email, created_at FROM users WHERE id = ?')
          .get(id) as { id: string; username: string; email: string | null; created_at: number } | undefined;
        if (!row) return null;
        return { id: row.id, username: row.username, email: row.email, createdAt: row.created_at };
      },
    });
  });

  afterAll(() => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.close();
    __resetAuthStore();
  });

  beforeEach(async () => {
    const mod = (await import('next/headers')) as unknown as {
      __store: Map<string, { value: string; opts: Record<string, unknown> }>;
    };
    mod.__store.clear();
    db.prepare('DELETE FROM sessions').run();
    vi.clearAllMocks();
  });

  it('创建会话 → 写入 Cookie → 可解析出用户', async () => {
    const token = createSession(userId);
    await setSessionCookie(token);

    const user = await getSessionUser();
    expect(user?.id).toBe(userId);
    expect(user?.username).toBe(username);
  });

  it('getCurrentPublicUser 返回公开信息（无会话时为 null）', async () => {
    expect(await getCurrentPublicUser()).toBeNull();

    const token = createSession(userId);
    await setSessionCookie(token);
    const pub = await getCurrentPublicUser();
    expect(pub?.id).toBe(userId);
    expect(pub?.username).toBe(username);
    expect(pub?.email).toBe('s@t.dev');
    expect(typeof pub?.createdAt).toBe('number');
  });

  it('Cookie 缺失时返回 null', async () => {
    expect(await getSessionUser()).toBeNull();
  });

  it('销毁会话后无法再解析用户，且 Cookie 被删除', async () => {
    const token = createSession(userId);
    await setSessionCookie(token);
    expect(await getSessionUser()).not.toBeNull();

    await destroySession();
    expect(await getSessionUser()).toBeNull();

    const mod = (await import('next/headers')) as unknown as {
      __store: Map<string, { value: string; opts: Record<string, unknown> }>;
    };
    expect(mod.__store.has(SESSION_COOKIE)).toBe(false);
  });

  it('伪造 token 无法通过（数据库只存哈希）', async () => {
    await setSessionCookie('forged-token-123');
    expect(await getSessionUser()).toBeNull();
  });

  it('cleanupExpiredSessions 清理已过期会话', async () => {
    const now = Date.now();
    db.prepare(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(`sess_expired_${now}`, userId, 'expired-hash', now, now - 1000, now);
    db.prepare(
      'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(`sess_live_${now}`, userId, 'live-hash', now, now + 1000, now);

    expect(cleanupExpiredSessions()).toBe(1);
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    expect(remaining.n).toBe(1);
  });
});
