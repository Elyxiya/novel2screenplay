'use client';

import { useEffect, useState } from 'react';

/** 跳转到登录页并保留完整来源（pathname + search），登录后回跳 */
function redirectToLogin() {
  const next = window.location.pathname + window.location.search;
  window.location.href = `/auth/login?next=${encodeURIComponent(next || '/')}`;
}

/**
 * 页面级登录保护：未登录时重定向到登录页（带 next 参数返回来源页）。
 * 包裹需要登录才能访问的页面内容。
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'redirect'>('loading');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => {
        if (r.ok) {
          setState('ok');
        } else {
          setState('redirect');
          redirectToLogin();
        }
      })
      .catch(() => {
        setState('redirect');
        redirectToLogin();
      });
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <svg className="w-10 h-10 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm text-slate-400">正在校验登录状态...</p>
      </div>
    );
  }

  if (state === 'redirect') return null;

  return <>{children}</>;
}
