'use client';

import { useEffect, useState } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import type { AuthUser } from '@/components/AuthStatus';
import UserLLMList from '@/components/UserLLMList';
import CustomLLMForm from '@/components/CustomLLMForm';

export default function SettingsPage() {
  return (
    <RequireAuth>
      <SettingsContent />
    </RequireAuth>
  );
}

function SettingsContent() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 修改密码
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwdMsg, setPwdMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pwdLoading, setPwdLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('unauth'))))
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoaded(true));
  }, []);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);
    if (newPassword !== confirm) {
      setPwdMsg({ type: 'err', text: '两次输入的新密码不一致' });
      return;
    }
    if (newPassword.length < 6) {
      setPwdMsg({ type: 'err', text: '新密码至少 6 位' });
      return;
    }
    setPwdLoading(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwdMsg({ type: 'err', text: data.error || '修改失败' });
        return;
      }
      setPwdMsg({ type: 'ok', text: data.message || '密码修改成功' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch {
      setPwdMsg({ type: 'err', text: '网络错误，请重试' });
    } finally {
      setPwdLoading(false);
    }
  };

  const inputCls = 'w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white/80 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-transparent transition-all';

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">账户设置</h2>
        <p className="text-sm text-slate-500 mt-1">管理你的登录信息与密码</p>
      </div>

      {/* 账户信息 */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="font-semibold text-slate-800 mb-4">账户信息</h3>
        {!loaded ? (
          <div className="h-16 bg-slate-100 animate-pulse rounded-xl" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="text-sm text-slate-500">用户名</span>
              <span className="text-sm font-medium text-slate-800">{user?.username ?? '-'}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-100">
              <span className="text-sm text-slate-500">邮箱</span>
              <span className="text-sm font-medium text-slate-800">{user?.email || '未绑定'}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-slate-500">注册时间</span>
              <span className="text-sm font-medium text-slate-800">
                {user ? new Date(user.createdAt).toLocaleDateString('zh-CN') : '-'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 修改密码 */}
      <div className="glass-card rounded-2xl p-6">
        <h3 className="font-semibold text-slate-800 mb-4">修改密码</h3>
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">当前密码</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className={inputCls}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">新密码</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className={inputCls}
              autoComplete="new-password"
              placeholder="至少 6 位"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">确认新密码</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              className={inputCls}
              autoComplete="new-password"
            />
          </div>

          {pwdMsg && (
            <div className={`px-4 py-3 rounded-xl text-sm ${pwdMsg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
              {pwdMsg.text}
            </div>
          )}

          <button
            type="submit"
            disabled={pwdLoading}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-cyan-500 shadow-lg shadow-indigo-300/40 hover:shadow-xl hover:shadow-indigo-300/60 transition-all duration-300 disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {pwdLoading && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            保存新密码
          </button>
        </form>
      </div>

      {/* 自定义 LLM 导入 */}
      <div className="glass-card rounded-2xl p-6">
        <div className="mb-4">
          <h3 className="font-semibold text-slate-800">自定义 LLM</h3>
          <p className="text-sm text-slate-500 mt-1">
            导入你自己的模型服务（OpenAI 兼容 / Anthropic 原生）。配置仅对当前账号生效，生成任务将优先使用此模型。
          </p>
        </div>
        <CustomLLMForm onCreated={() => window.location.reload()} />
        <div className="mt-6 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-slate-700">已导入的模型</h4>
          </div>
          <UserLLMList onRefresh={() => window.location.reload()} />
        </div>
      </div>
    </div>
  );
}
