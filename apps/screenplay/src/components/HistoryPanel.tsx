'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface HistoryItem {
  jobId: string;
  title: string | null;
  author: string | null;
  sceneCount: number | null;
  characterCount: number | null;
  locationCount: number | null;
  createdAt: number;
}

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
  const [entries, setEntries] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/history');
      if (!res.ok) return;
      const data = await res.json();
      setEntries(data.history ?? []);
    } catch {
      // network error: keep current list
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = async (jobId: string) => {
    try {
      await fetch(`/api/history?jobId=${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
    await refresh();
  };

  const clearAll = async () => {
    try {
      await fetch('/api/history', { method: 'DELETE' });
    } catch {
      // ignore
    }
    setEntries([]);
    setConfirmClear(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">转换历史</h3>
          {entries.length > 0 && (
            confirmClear ? (
              <div className="flex gap-1">
                <button onClick={clearAll} className="text-xs px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700">确认</button>
                <button onClick={() => setConfirmClear(false)} className="text-xs px-2 py-0.5 border rounded hover:bg-gray-50">取消</button>
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
          <div className="flex items-center justify-center h-full text-xs text-gray-400">加载中…</div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="text-3xl mb-2 opacity-40">📭</div>
            <p className="text-xs text-gray-400">暂无历史记录</p>
          </div>
        ) : (
          <div className="space-y-0.5 px-2">
            {entries.map(entry => {
              const isActive = pathname === `/result/${entry.jobId}`;
              return (
                <div
                  key={entry.jobId}
                  className={`group rounded-lg p-2 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-blue-50 border border-blue-200'
                      : 'hover:bg-gray-50 border border-transparent'
                  }`}
                >
                  <button
                    onClick={() => router.push(`/result/${entry.jobId}`)}
                    className="w-full text-left"
                  >
                    <div className={`text-sm font-medium truncate ${isActive ? 'text-blue-700' : 'text-gray-700'}`}>
                      {entry.title || '未命名'}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate">
                      {entry.author || '未署名'}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400">{formatDate(entry.createdAt)}</span>
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{entry.sceneCount ?? 0} 场景</span>
                    </div>
                  </button>
                  <div className="flex items-center justify-end mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); void remove(entry.jobId); }}
                      className="text-xs text-red-400 hover:text-red-600 px-1 py-0.5 rounded hover:bg-red-50 transition-colors"
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
      <div className="px-3 pb-2 pt-1 border-t border-gray-100 shrink-0">
        <p className="text-xs text-gray-300 leading-relaxed">
          服务端持久化保存，跨浏览器访问不丢失
        </p>
      </div>
    </div>
  );
}
