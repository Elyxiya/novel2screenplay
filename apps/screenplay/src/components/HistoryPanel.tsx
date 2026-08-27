'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface HistoryEntry {
  id: string;
  status: string;
  currentPhase?: number;
  progress: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  novelId: string | null;
  resultId?: string;
  title: string | null;
  author: string;
  sourceNovel: string;
  totalScenes: number;
  totalCharacters: number;
  totalLocations: number;
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

export function HistoryPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/history');
      if (!res.ok) throw new Error(`加载失败(${res.status})`);
      const data = await res.json();
      setEntries(data.jobs ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // 挂载 + 路由变化时刷新（转换完成跳转后能立即看到新记录）
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const res = await fetch('/api/jobs/history');
        if (!res.ok) throw new Error(`加载失败(${res.status})`);
        const data = await res.json();
        if (!cancelled) setEntries(data.jobs ?? []);
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const remove = async (jobId: string) => {
    try {
      await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    } catch {
      // 忽略失败，刷新后仍会显示
    }
    await loadHistory();
  };

  const clearAll = async () => {
    try {
      await fetch('/api/jobs/history', { method: 'DELETE' });
    } catch {
      // 忽略失败
    }
    setEntries([]);
    setConfirmClear(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-200/70 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <svg className="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            转换历史
          </h3>
          {!loading && entries.length > 0 && (
            confirmClear ? (
              <div className="flex gap-1">
                <button onClick={() => void clearAll()} className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">确认</button>
                <button onClick={() => setConfirmClear(false)} className="text-xs px-2 py-1 rounded-lg border border-slate-300 bg-white/70 text-slate-600 hover:bg-white transition-colors">取消</button>
              </div>
            ) : (
              <button onClick={() => setConfirmClear(true)} className="text-xs text-red-400 hover:text-red-600 transition-colors">清空</button>
            )
          )}
        </div>
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-slate-400">加载中…</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-slate-400 mt-2">暂无历史记录</p>
          </div>
        ) : (
          <div className="space-y-1 px-2">
            {entries.map(entry => {
              const isActive = pathname === `/result/${entry.id}`;
              const meta = STATUS_META[entry.status] ?? { label: entry.status, cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' };
              return (
                <div
                  key={entry.id}
                  className={`group rounded-xl p-2.5 cursor-pointer transition-all duration-200 border ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-50 to-cyan-50 border-indigo-200 shadow-sm'
                      : 'hover:bg-white/70 border-transparent hover:border-cyan-200/60'
                  }`}
                >
                  <button
                    onClick={() => router.push(`/result/${entry.id}`)}
                    className="w-full text-left"
                  >
                    <div className={`text-sm font-medium truncate ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {entry.title}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate">
                      {entry.author || entry.sourceNovel || '未命名'}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] ${meta.cls}`}>
                        <span className={`w-1 h-1 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                      <span className="text-[11px] text-slate-400">{formatDate(entry.createdAt)}</span>
                      <span className="text-[11px] text-slate-400">{entry.totalScenes} 场景</span>
                    </div>
                  </button>
                  <div className="flex items-center justify-end mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); void remove(entry.id); }}
                      className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 pb-2 pt-1 border-t border-slate-200/70 shrink-0">
        <p className="text-xs text-slate-400 leading-relaxed">
          已持久化保存，清除浏览器数据不会丢失
        </p>
      </div>
    </div>
  );
}
