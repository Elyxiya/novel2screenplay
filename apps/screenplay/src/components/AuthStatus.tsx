'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  createdAt: number;
}

/** 导航栏用户状态：未登录显示登录/注册，已登录显示用户菜单（设置/登出） */
export function AuthStatus() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('unauth'))))
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setMenuOpen(false);
      router.push('/');
      router.refresh();
    }
  };

  if (!loaded) {
    return <div className="w-28 h-9 rounded-xl bg-slate-100 animate-pulse" aria-hidden />;
  }

  if (!user) {
    const next = pathname && pathname !== '/auth/login' && pathname !== '/auth/register'
      ? `?next=${encodeURIComponent(pathname)}`
      : '';
    return (
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/auth/login${next}`}
          className="px-3.5 py-2 rounded-xl text-sm font-medium text-slate-600 border border-slate-300 bg-white/70 hover:border-cyan-400/60 hover:text-slate-900 transition-all duration-300"
        >
          登录
        </Link>
        <Link
          href="/auth/register"
          className="px-3.5 py-2 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-cyan-500 shadow-md shadow-indigo-300/40 hover:shadow-lg hover:shadow-indigo-300/60 transition-all duration-300"
        >
          注册
        </Link>
      </div>
    );
  }

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-xl border border-slate-300 bg-white/70 hover:border-cyan-400/60 hover:shadow-md hover:shadow-cyan-100/60 transition-all duration-300"
        aria-label="账户菜单"
      >
        <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-gradient-to-br from-indigo-600 to-cyan-400 text-white text-xs font-bold">
          {user.username.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden sm:inline text-sm font-medium text-slate-700 max-w-[8rem] truncate">
          {user.username}
        </span>
        <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl bg-white border border-slate-200 shadow-2xl shadow-slate-200/60 overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800 truncate">{user.username}</p>
            <p className="text-xs text-slate-400 truncate">{user.email || '未绑定邮箱'}</p>
          </div>
          <Link
            href="/settings"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            账户设置
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
