/**
 * 会话管理：HttpOnly Cookie + SQLite sessions 表
 *
 * - Cookie 中存放随机 token（base64url），HttpOnly / SameSite=Lax
 * - 数据库只存 token 的 SHA-256 哈希，泄露数据库也无法伪造会话
 * - 会话默认 30 天有效，滑动续期（读取时刷新过期时间）
 */

import { createHash, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { getEngine } from '@/lib/store/sqlite';

export const SESSION_COOKIE = 'n2s_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const SLIDING_WINDOW_MS = 24 * 60 * 60 * 1000; // 距过期不足 24h 时续期

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 为用户创建会话，返回需要写入 Cookie 的明文 token */
export function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const db = getEngine();
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    `sess_${now}_${randomBytes(4).toString('hex')}`,
    userId,
    hashToken(token),
    now,
    now + SESSION_TTL_MS,
    now,
  );
  return token;
}

/** 将会话 token 写入 HttpOnly Cookie */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/**
 * 从 Cookie 解析当前登录用户。
 * 会话不存在 / 已过期 / token 无效时返回 null。
 * 距过期不足 24h 时自动续期并刷新 Cookie。
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getEngine();
  const row = db.prepare(`
    SELECT s.id AS session_id, s.expires_at, u.id AS user_id, u.username, u.email
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(hashToken(token)) as
    | { session_id: string; expires_at: number; user_id: string; username: string; email: string | null }
    | undefined;

  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    // 过期会话：删除并清理 Cookie
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    store.delete(SESSION_COOKIE);
    return null;
  }

  // 滑动续期
  if (row.expires_at - Date.now() < SLIDING_WINDOW_MS) {
    const newExpires = Date.now() + SESSION_TTL_MS;
    db.prepare('UPDATE sessions SET expires_at = ?, last_used_at = ? WHERE id = ?')
      .run(newExpires, Date.now(), row.session_id);
    store.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
  } else {
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run(Date.now(), row.session_id);
  }

  return { id: row.user_id, username: row.username, email: row.email };
}

/** 销毁当前会话（登出） */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = getEngine();
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }
  store.delete(SESSION_COOKIE);
}

/** 清理全部已过期会话（启动时/定时调用） */
export function cleanupExpiredSessions(): number {
  const db = getEngine();
  const res = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  return res.changes;
}
