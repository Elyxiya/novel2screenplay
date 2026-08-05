'use client';

/**
 * 客户端认证工具
 *
 * 页面内 fetch 遇到 401（会话过期 / 未登录）时统一处理：
 * 跳转登录页并保留完整来源路径，登录后自动回跳。
 */

/** 跳转到登录页并保留完整来源（pathname + search） */
export function redirectToLogin(): void {
  const next = window.location.pathname + window.location.search;
  window.location.href = `/auth/login?next=${encodeURIComponent(next || '/')}`;
}

/**
 * 包装 fetch：响应 401/403 时自动跳转登录（登录后回跳来源页）。
 * 返回原始 Response，调用方无需再处理 401。
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 || res.status === 403) {
    redirectToLogin();
  }
  return res;
}

/** 检查登录态（供页面级调用，返回是否已登录） */
export async function isAuthed(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/me');
    return res.ok;
  } catch {
    return false;
  }
}
