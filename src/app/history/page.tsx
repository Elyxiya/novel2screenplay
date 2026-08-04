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

  return (
    <RequireAuth>
      <div className="space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">转换历史</h2>
            <p className="text-gray-500 text-sm mt-1">服务端持久化保存，跨设备与重启不丢失</p>
          </div>
          <div className="flex gap-2">
            {jobs.some((j) => j.status === 'failed') && (
              <button
                onClick={clearFailed}
                className="px-3 py-1.5 border border-red-200 text-red-500 text-xs rounded-lg hover:bg-red-50"
              >
                清理失败任务
              </button>
            )}
            <button
              onClick={load}
              className="px-3 py-1.5 border text-xs rounded-lg hover:bg-gray-50"
            >
              刷新
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="bg-white rounded-xl border p-12 text-center text-gray-400 text-sm">
            加载中...
          </div>
        ) : jobs.length === 0 ? (
          <div className="bg-white rounded-xl border p-12 text-center">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-gray-500">暂无转换记录</p>
            <button
              onClick={() => router.push('/upload')}
              className="mt-4 px-6 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              去转换一本小说
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left">
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs">任务</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs w-24">状态</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs w-24">创建时间</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs w-20">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map((j) => {
                  const meta = STATUS_META[j.status] ?? { label: j.status, cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' };
                  const hasResult = j.status === 'completed' || j.status === 'failed';
                  return (
                    <tr key={j.id} className="hover:bg-gray-50 transition-colors group">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => hasResult && router.push(`/result/${j.id}`)}
                          className={`text-left font-medium ${hasResult ? 'hover:text-blue-600' : 'cursor-default'}`}
                        >
                          {j.title ? `《${j.title}》` : `任务 ${j.id.slice(-8)}`}
                        </button>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-gray-400 mt-0.5">
                          {j.modelId && <span className="font-mono">{j.modelId}</span>}
                          {j.selectedChapterCount > 0 && <span>{j.selectedChapterCount} 章</span>}
                          {j.resultId && <span>已生成剧本</span>}
                        </div>
                        {j.error && (
                          <p className="text-xs text-red-400 mt-1 truncate max-w-xs" title={j.error}>
                            ⚠ {j.error.slice(0, 60)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs ${meta.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{formatDate(j.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {hasResult && (
                            <button
                              onClick={() => router.push(`/result/${j.id}`)}
                              className="text-xs border rounded px-2 py-1 hover:bg-blue-50 hover:text-blue-600"
                            >
                              查看
                            </button>
                          )}
                          <button
                            onClick={() => remove(j.id)}
                            disabled={deletingId === j.id}
                            className="text-xs text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-50"
                          >
                            {deletingId === j.id ? '删除中' : '删除'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center">
          转换历史存储在服务端 SQLite，登录后跨设备可见。
        </p>
      </div>
    </RequireAuth>
  );
}
