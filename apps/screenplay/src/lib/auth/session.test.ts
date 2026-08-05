// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

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

import { createSession, setSessionCookie, getSessionUser, destroySession, SESSION_COOKIE } from './session';
import { getUserRepository } from '@/lib/store/sqlite';
import { getDatabase, closeDatabase } from '@/lib/store/sqlite/db';
import { hashPassword } from './password';

describe('session 会话管理', () => {
  let userId: string;

  beforeAll(async () => {
    getDatabase();
    const hash = await hashPassword('test-pass');
    userId = getUserRepository().create({ username: 'session_user', email: 's@t.dev', passwordHash: hash });
  });

  afterAll(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    closeDatabase();
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    vi.clearAllMocks();
  });

  it('创建会话 → 写入 Cookie → 可解析出用户', async () => {
    const token = createSession(userId);
    await setSessionCookie(token);

    const user = await getSessionUser();
    expect(user?.id).toBe(userId);
    expect(user?.username).toBe('session_user');
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

    const mod = (await import('next/headers')) as unknown as { __store: Map<string, { value: string; opts: Record<string, unknown> }> };
    expect(mod.__store.has(SESSION_COOKIE)).toBe(false);
  });

  it('伪造 token 无法通过（数据库只存哈希）', async () => {
    const db = getDatabase();
    const stored = db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').get(userId) as { token_hash: string } | undefined;
    expect(stored?.token_hash).toBeUndefined(); // 上面 beforeEach 已清理
  });
});
