'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/RequireAuth';

interface DraftSummary {
  id: string;
  title: string;
  author: string;
  synopsis: string;
  chapterCount: number;
  totalWords: number;
  convertedCount: number;
  createdAt: number;
  updatedAt: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return d.toLocaleDateString('zh-CN');
}

export default function WriterPage() {
  const router = useRouter();
  const [novels, setNovels] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', author: '', synopsis: '' });
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/writer/novels');
      if (!res.ok) throw new Error(`加载失败(${res.status})`);
      const data = await res.json();
      setNovels(data.novels ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/writer/novels');
        if (!res.ok) throw new Error(`加载失败(${res.status})`);
        const data = await res.json();
        if (!cancelled) {
          setNovels(data.novels ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    if (!form.title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/writer/novels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? '创建失败');
      }
      const data = await res.json();
      router.push(`/writer/${data.novel.id}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('确定删除这部创作小说吗？章节内容将一并删除，不可恢复。')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/writer/novels/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      setNovels((prev) => prev.filter((n) => n.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <RequireAuth>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">创作台</h2>
            <p className="text-gray-500 text-sm mt-1">
              编写与管理你的小说，大纲、章节、人物卡与世界观一站管理，完成后一键转剧本
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} className="px-3 py-1.5 border text-xs rounded-lg hover:bg-gray-50">
              刷新
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-cyan-500 text-white text-sm rounded-lg hover:opacity-90 shadow-md shadow-indigo-200/50"
            >
              + 新建小说
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>
        )}

        {loading ? (
          <div className="bg-white rounded-xl border p-12 text-center text-gray-400 text-sm">加载中...</div>
        ) : novels.length === 0 ? (
          <div className="bg-white rounded-xl border p-14 text-center">
            <div className="text-5xl mb-4">✍️</div>
            <p className="text-gray-500 mb-6">还没有创作小说</p>
            <button
              onClick={() => setShowCreate(true)}
              className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-cyan-500 text-white text-sm rounded-lg hover:opacity-90"
            >
              创建第一本小说
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {novels.map((n) => (
              <div key={n.id} className="bg-white rounded-xl border p-5 hover:shadow-lg hover:shadow-indigo-100/50 transition-all duration-300 group">
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => router.push(`/writer/${n.id}`)}
                    className="text-left flex-1 min-w-0"
                  >
                    <h3 className="font-semibold text-lg truncate group-hover:text-indigo-600 transition-colors">
                      《{n.title}》
                    </h3>
                    {n.author && <p className="text-xs text-gray-400 mt-0.5">{n.author}</p>}
                  </button>
                  <button
                    onClick={() => remove(n.id)}
                    disabled={deleting === n.id}
                    className="shrink-0 text-xs text-red-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-600 disabled:opacity-30"
                  >
                    删除
                  </button>
                </div>

                {n.synopsis && (
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2">{n.synopsis}</p>
                )}

                <div className="flex items-center gap-3 mt-4 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {n.chapterCount} 章
                  </span>
                  <span>{n.totalWords.toLocaleString()} 字</span>
                  {n.convertedCount > 0 && (
                    <span className="text-emerald-500">{n.convertedCount} 章已转剧本</span>
                  )}
                  <span className="ml-auto">{formatTime(n.updatedAt)}</span>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => router.push(`/writer/${n.id}`)}
                    className="flex-1 py-1.5 text-xs rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
                  >
                    继续写作
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/writer/novels/${n.id}/convert`, { method: 'POST' });
                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}));
                          throw new Error(data.error ?? '无法转剧本');
                        }
                        const data = await res.json();
                        router.push(`/configure?novel=${data.novelId}`);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                    className="flex-1 py-1.5 text-xs rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                  >
                    送去转剧本
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 新建弹窗 */}
        {showCreate && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold mb-4">新建创作小说</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">标题 *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="给小说起个名字"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">作者</label>
                  <input
                    value={form.author}
                    onChange={(e) => setForm({ ...form, author: e.target.value })}
                    placeholder="可选"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">简介</label>
                  <textarea
                    value={form.synopsis}
                    onChange={(e) => setForm({ ...form, synopsis: e.target.value })}
                    placeholder="一句话简介，AI 写作会参考它保持设定一致（可选）"
                    rows={3}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-sm text-gray-500 border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={create}
                  disabled={!form.title.trim() || creating}
                  className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40"
                >
                  {creating ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
