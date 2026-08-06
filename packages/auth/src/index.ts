/**
 * 认证统一入口
 *
 * API 路由用法：
 *   const user = await getCurrentUser();
 *   if (!user) return authError();
 */

import { NextResponse } from 'next/server';
import { getSessionUser } from './session';
import { getAuthStore, type PublicUser } from './store';

export { hashPassword, verifyPassword } from './password';
export {
  createSession,
  setSessionCookie,
  getSessionUser,
  destroySession,
  cleanupExpiredSessions,
  SESSION_COOKIE,
  type SessionUser,
} from './session';
export { configureAuth, type AuthStore, type AuthDatabase, type PublicUser } from './store';

/** 获取当前登录用户（未登录返回 null） */
export async function getCurrentUser(): Promise<Awaited<ReturnType<typeof getSessionUser>>> {
  return getSessionUser();
}

/** 获取当前登录用户的公开信息（null 表示未登录） */
export async function getCurrentPublicUser(): Promise<PublicUser | null> {
  const session = await getSessionUser();
  if (!session) return null;
  return getAuthStore().getUserById(session.id);
}

/** 401 响应（未登录 / 无权限） */
export function authError(message = '请先登录', status = 401): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
