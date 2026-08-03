'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface AuthFormProps {
  mode: 'login' | 'register';
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/upload';
  const isLogin = mode === 'login';

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isLogin && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }

    setLoading(true);
    try {
      const payload = isLogin
        ? { username, password }
        : { username, password, email: email.trim() || undefined };

      const res = await fetch(`/api/auth/${isLogin ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '操作失败，请重试');
        return;
      }

      // 登录成功：跳转到来源页或首页
      router.push(next);
      router.refresh();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full px-4 py-3 rounded-xl border border-slate-300 bg-white/80 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-transparent transition-all';

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="glass-card rounded-3xl p-8 shadow-2xl shadow-indigo-200/40">
        <div className="text-center mb-8">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-300/50 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{isLogin ? '欢迎回来' : '创建账户'}</h2>
          <p className="text-sm text-slate-500 mt-1">
            {isLogin ? '登录后继续你的小说转剧本之旅' : '注册后自动登录，数据与账户绑定'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">用户名{isLogin ? ' / 邮箱' : ''}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isLogin ? '输入用户名或邮箱' : '3-20 位字母、数字、下划线或中文'}
              required
              className={inputCls}
              autoComplete="username"
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">邮箱（可选）</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputCls}
                autoComplete="email"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isLogin ? '输入密码' : '至少 6 位'}
              required
              minLength={isLogin ? undefined : 6}
              className={inputCls}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">确认密码</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入密码"
                required
                minLength={6}
                className={inputCls}
                autoComplete="new-password"
              />
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-cyan-500 shadow-lg shadow-indigo-300/40 hover:shadow-xl hover:shadow-indigo-300/60 hover:-translate-y-0.5 transition-all duration-300 disabled:opacity-60 disabled:hover:translate-y-0 flex items-center justify-center gap-2"
          >
            {loading && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isLogin ? '登 录' : '注 册'}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          {isLogin ? (
            <>
              还没有账户？{' '}
              <Link href="/auth/register" className="text-cyan-600 font-medium hover:text-cyan-700 hover:underline">
                立即注册
              </Link>
            </>
          ) : (
            <>
              已有账户？{' '}
              <Link href="/auth/login" className="text-cyan-600 font-medium hover:text-cyan-700 hover:underline">
                直接登录
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
