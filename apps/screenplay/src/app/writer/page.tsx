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
      <div className="space-y-6 animate-float-up">
        {/* Header */}
        <div className="relative glass-card rounded-2xl p-6 sm:p-8 overflow-hidden">
          <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
          <div className="relative flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
                创作台 <span className="neon-text">Writer</span>
              </h1>
              <p className="text-slate-500 mt-1.5 text-sm">
                编写与管理你的小说，大纲、章节、人物卡与世界观一站管理，完成后一键转剧本
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={load} className="glow-btn-ghost !px-4 !py-2 text-xs">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M20 9A8 8 0 005.636 5.636L4 7m0 0v2M4 17a8 8 0 0014.364 3.364L20 17m0 0v-2" />
                </svg>
                刷新
              </button>
              <button onClick={() => setShowCreate(true)} className="glow-btn !px-4 !py-2 text-xs">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                新建小说
              </button>
            </div>
          </div>

          <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <div className="glass-card p-3 text-center">
              <p className="text-2xl font-bold neon-text font-mono">{novels.length}</p>
              <p className="text-xs text-slate-500 mt-0.5">创作作品</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-2xl font-bold text-cyan-600 font-mono">{novels.reduce((s, n) => s + n.chapterCount, 0)}</p>
              <p className="text-xs text-slate-500 mt-0.5">章节总数</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600 font-mono">{novels.reduce((s, n) => s + n.convertedCount, 0)}</p>
              <p className="text-xs text-slate-500 mt-0.5">已转剧本</p>
            </div>
            <div className="glass-card p-3 text-center">
              <p className="text-2xl font-bold text-slate-800 font-mono">{novels.reduce((s, n) => s + n.totalWords, 0).toLocaleString()}</p>
              <p className="text-xs text-slate-500 mt-0.5">累计字数</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        ) : novels.length === 0 ? (
          <div className="glass-card p-14 text-center">
            <svg className="w-14 h-14 mx-auto text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <p className="text-slate-500 mt-4 mb-6">还没有创作小说</p>
            <button
              onClick={() => setShowCreate(true)}
              className="glow-btn !px-6 !py-2.5 text-sm"
            >
              创建第一本小说
            </button>
          </div>
        ) : (
          <div
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            data-grid-note="窄屏1列 / md2 / lg3 / xl4"
          >
            {novels.map((n) => (
              <div key={n.id} className="glass-card glass-card-hover p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    onClick={() => router.push(`/writer/${n.id}`)}
                    className="text-left flex-1 min-w-0"
                  >
                    <h3 className="font-bold text-lg truncate text-slate-900">
                      《{n.title}》
                    </h3>
                    {n.author && <p className="text-xs text-slate-400 mt-0.5">{n.author}</p>}
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
                  <p className="text-sm text-slate-500 line-clamp-2">{n.synopsis}</p>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
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

                <div className="flex gap-2 pt-1 mt-auto">
                  <button
                    onClick={() => router.push(`/writer/${n.id}`)}
                    className="glow-btn flex-1 !py-2 text-xs"
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
                    className="glow-btn-ghost !py-2 text-xs !text-emerald-600 !border-emerald-200 hover:!border-emerald-400 hover:!text-emerald-700"
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
            <div className="relative glass-card rounded-2xl shadow-2xl w-full max-w-md p-6 animate-float-up" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                新建创作小说
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1.5">标题 *</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="给小说起个名字"
                    className="tech-input"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1.5">作者</label>
                  <input
                    value={form.author}
                    onChange={(e) => setForm({ ...form, author: e.target.value })}
                    placeholder="可选"
                    className="tech-input"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1.5">简介</label>
                  <textarea
                    value={form.synopsis}
                    onChange={(e) => setForm({ ...form, synopsis: e.target.value })}
                    placeholder="一句话简介，AI 写作会参考它保持设定一致（可选）"
                    rows={3}
                    className="tech-input resize-none"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  className="glow-btn-ghost !px-4 !py-2 text-xs"
                >
                  取消
                </button>
                <button
                  onClick={create}
                  disabled={!form.title.trim() || creating}
                  className="glow-btn !px-5 !py-2 text-xs disabled:opacity-50"
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
