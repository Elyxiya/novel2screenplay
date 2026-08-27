'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/RequireAuth';

interface HistoryJob {
  id: string;
  status: string;
  currentPhase: number;
  progress: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  novelId: string | null;
  resultId: string | null;
  title: string | null;
  modelId: string | null;
  selectedChapterCount: number;
}

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  pending: { label: '等待中', cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
  running: { label: '转换中', cls: 'bg-cyan-50 text-cyan-700 border-cyan-200', dot: 'bg-cyan-500 animate-pulse' },
  processing: { label: '转换中', cls: 'bg-cyan-50 text-cyan-700 border-cyan-200', dot: 'bg-cyan-500 animate-pulse' },
  completed: { label: '已完成', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  failed: { label: '失败', cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500' },
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function HistoryPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/history');
      if (!res.ok) throw new Error(`加载失败(${res.status})`);
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const res = await fetch('/api/jobs/history');
        if (!res.ok) throw new Error(`加载失败(${res.status})`);
        const data = await res.json();
        if (!cancelled) {
          setJobs(data.jobs ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = async (jobId: string) => {
    setDeletingId(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `删除失败(${res.status})`);
      }
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const clearFailed = async () => {
    const failed = jobs.filter((j) => j.status === 'failed');
    for (const j of failed) {
      await fetch(`/api/jobs/${j.id}`, { method: 'DELETE' });
    }
    setJobs((prev) => prev.filter((j) => j.status !== 'failed'));
  };

  const stats = {
    total: jobs.length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    running: jobs.filter((j) => j.status === 'running' || j.status === 'processing' || j.status === 'pending').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
  };

  return (
    <RequireAuth>
      <div className="space-y-6 animate-float-up">
        {/* 页头 + 统计 */}
        <div className="relative glass-card rounded-2xl p-6 sm:p-8 overflow-hidden">
          <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                转换历史 <span className="neon-text">History</span>
              </h1>
              <p className="text-slate-500 mt-1.5 text-sm">服务端持久化保存，跨设备与重启不丢失</p>
            </div>
            <div className="flex gap-2">
              {stats.failed > 0 && (
                <button
                  onClick={clearFailed}
                  className="glow-btn-ghost !px-4 !py-2 text-xs !text-red-500 !border-red-200 hover:!border-red-400 hover:!text-red-600"
                >
                  清理失败任务
                </button>
              )}
              <button onClick={load} className="glow-btn-ghost !px-4 !py-2 text-xs">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M20 9A8 8 0 005.636 5.636L4 7m0 0v2M4 17a8 8 0 0014.364 3.364L20 17m0 0v-2" />
                </svg>
                刷新
              </button>
            </div>
          </div>

          {/* 统计 */}
          <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <div className="glass-card p-3 text-center">
              <p className="text-2xl font-bold neon-text font-mono">{stats.total}</p>
              <p className="text-xs text-slate-500 mt-0.5">全部任务</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600 font-mono">{stats.completed}</p>
              <p className="text-xs text-slate-500 mt-0.5">已完成</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-2xl font-bold text-cyan-600 font-mono">{stats.running}</p>
              <p className="text-xs text-slate-500 mt-0.5">进行中</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-2xl font-bold text-red-500 font-mono">{stats.failed}</p>
              <p className="text-xs text-slate-500 mt-0.5">失败</p>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        ) : jobs.length === 0 ? (
          <div className="glass-card p-14 text-center">
            <svg className="w-14 h-14 mx-auto text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-slate-500 mt-4">暂无转换记录</p>
            <button
              onClick={() => router.push('/upload')}
              className="glow-btn mt-5 !px-6 !py-2.5 text-sm"
            >
              去转换一本小说
            </button>
          </div>
        ) : (
          <div className="glass-card divide-y divide-slate-100/80 overflow-hidden">
            {jobs.map((j) => {
              const meta = STATUS_META[j.status] ?? { label: j.status, cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' };
              const hasResult = j.status === 'completed' || j.status === 'failed';
              return (
                <div key={j.id} className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-5 py-3.5 hover:bg-white/60 transition-colors">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs shrink-0 ${meta.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => hasResult && router.push(`/result/${j.id}`)}
                      className={`text-sm font-medium text-slate-800 truncate block ${hasResult ? 'hover:text-cyan-700' : 'cursor-default'}`}
                    >
                      {j.title ? `《${j.title}》` : `任务 ${j.id.slice(-8)}`}
                    </button>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400 mt-0.5">
                      <span>{formatDate(j.createdAt)}</span>
                      {j.modelId && <span className="font-mono">{j.modelId}</span>}
                      {j.selectedChapterCount > 0 && <span>{j.selectedChapterCount} 章</span>}
                      {j.resultId && <span>已生成剧本</span>}
                    </div>
                    {j.error && (
                      <p className="text-xs text-red-400 mt-1 truncate max-w-xs" title={j.error}>
                        ⚠ {j.error.slice(0, 60)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0 ml-auto">
                    {hasResult && (
                      <button
                        onClick={() => router.push(`/result/${j.id}`)}
                        className="glow-btn !px-3 !py-1.5 text-xs"
                      >
                        查看结果
                      </button>
                    )}
                    <button
                      onClick={() => remove(j.id)}
                      disabled={deletingId === j.id}
                      className="glow-btn-ghost !px-3 !py-1.5 text-xs !text-red-500 !border-red-200 hover:!border-red-400 hover:!text-red-600 disabled:opacity-50"
                    >
                      {deletingId === j.id ? '删除中' : '删除'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-slate-400 text-center">
          转换历史存储在服务端 SQLite，登录后跨设备可见。
        </p>
      </div>
    </RequireAuth>
  );
}
