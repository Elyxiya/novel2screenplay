'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { RequireAuth } from '@/components/RequireAuth';

interface NovelSummaryItem {
  id: string;
  title: string;
  author: string | null;
  totalChapters: number;
  convertedCount: number;
  createdAt: number;
  updatedAt: number;
  lastJobId: string | null;
  lastJob?: {
    id: string;
    status: string;
    completedAt: number | null;
    totalScenes: number | null;
  } | null;
}

interface JobItem {
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
  cancelled: { label: '已取消', cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
};

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return `今天 ${hm}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export default function WorkbenchPage() {
  return (
    <RequireAuth>
      <WorkbenchContent />
    </RequireAuth>
  );
}

function WorkbenchContent() {
  const [novels, setNovels] = useState<NovelSummaryItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // 追加章节弹窗
  const [appendNovel, setAppendNovel] = useState<NovelSummaryItem | null>(null);
  const [appendText, setAppendText] = useState('');
  const [appendFile, setAppendFile] = useState<File | null>(null);
  const [appendLoading, setAppendLoading] = useState(false);
  const [appendMsg, setAppendMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const openAppend = (n: NovelSummaryItem) => {
    setAppendNovel(n);
    setAppendText('');
    setAppendFile(null);
    setAppendMsg(null);
  };

  const handleAppend = async () => {
    if (!appendNovel) return;
    if (!appendText.trim() && !appendFile) {
      setAppendMsg({ type: 'err', text: '请粘贴章节文本或选择文件' });
      return;
    }
    setAppendLoading(true);
    setAppendMsg(null);
    const fd = new FormData();
    fd.append('novelId', appendNovel.id);
    if (appendFile) fd.append('file', appendFile);
    else fd.append('text', appendText);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) { setAppendMsg({ type: 'err', text: d.error ?? '追加失败' }); return; }
      if ((d.appended ?? 0) > 0) {
        setAppendMsg({ type: 'ok', text: `已追加 ${d.appended} 章，资产现有 ${d.chapters.length} 章，可在配置页继续转换未转换章节` });
        setAppendText('');
        setAppendFile(null);
        await refresh();
      } else {
        setAppendMsg({ type: 'ok', text: '未发现新章节（内容与已有章节重复），资产保持不变' });
      }
    } catch {
      setAppendMsg({ type: 'err', text: '追加失败，请重试' });
    } finally {
      setAppendLoading(false);
    }
  };

  const refresh = useCallback(async () => {
    try {
      const [nv, jb] = await Promise.all([
        fetch('/api/novels').then((r) => r.json()),
        fetch('/api/jobs/history').then((r) => r.json()),
      ]);
      setNovels(nv.novels ?? []);
      setJobs(jb.jobs ?? []);
    } catch {
      // 忽略刷新失败
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [nv, jb] = await Promise.all([
          fetch('/api/novels').then((r) => r.json()),
          fetch('/api/jobs/history').then((r) => r.json()),
        ]);
        if (!active) return;
        setNovels(nv.novels ?? []);
        setJobs(jb.jobs ?? []);
      } catch {
        // 忽略刷新失败
      } finally {
        if (active) setLoading(false);
      }
    })();
    const timer = setInterval(() => { void refresh(); }, 8000);
    return () => { active = false; clearInterval(timer); };
  }, [refresh]);

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该小说资产？相关转换历史仍保留。')) return;
    setDeleting(id);
    try {
      await fetch(`/api/novels/${id}`, { method: 'DELETE' });
      await refresh();
    } finally {
      setDeleting(null);
    }
  };

  const stats = {
    novels: novels.length,
    totalJobs: jobs.length,
    runningJobs: jobs.filter((j) => j.status === 'running' || j.status === 'processing' || j.status === 'pending').length,
    completedJobs: jobs.filter((j) => j.status === 'completed').length,
    failedJobs: jobs.filter((j) => j.status === 'failed').length,
  };

  return (
    <div className="space-y-8 animate-float-up">
      {/* 头部 */}
      <div className="relative glass-card rounded-2xl p-6 sm:p-8 overflow-hidden">
        <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              工作台 <span className="neon-text">Workbench</span>
            </h1>
            <p className="text-slate-500 mt-1.5 text-sm">
              管理你的小说资产与转换历史，支持追加章节继续转换
            </p>
          </div>
          <Link href="/upload" className="glow-btn !py-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            上传新小说
          </Link>
        </div>

        {/* 统计 */}
        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          <div className="glass-card p-3 text-center">
            <p className="text-2xl font-bold neon-text font-mono">{stats.novels}</p>
            <p className="text-xs text-slate-500 mt-0.5">小说资产</p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-2xl font-bold text-cyan-600 font-mono">{stats.runningJobs}</p>
            <p className="text-xs text-slate-500 mt-0.5">进行中</p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-2xl font-bold text-emerald-600 font-mono">{stats.completedJobs}</p>
            <p className="text-xs text-slate-500 mt-0.5">已完成</p>
          </div>
          <div className="glass-card p-3 text-center">
            <p className="text-2xl font-bold text-slate-800 font-mono">{stats.totalJobs}</p>
            <p className="text-xs text-slate-500 mt-0.5">全部任务</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          加载中...
        </div>
      ) : (
        <>
          {/* 小说资产 */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                小说资产
              </h2>
              <span className="text-xs text-slate-400">{novels.length} 部</span>
            </div>

            {novels.length === 0 ? (
              <div className="glass-card p-10 text-center">
                <p className="text-slate-400 text-sm mb-3">还没有上传过小说</p>
                <Link href="/upload" className="glow-btn text-xs">立即上传</Link>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {novels.map((n) => {
                  const pct = n.totalChapters ? Math.round((n.convertedCount / n.totalChapters) * 100) : 0;
                  return (
                    <div key={n.id} className="glass-card p-5 flex flex-col gap-3 glass-card-hover">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-bold text-slate-900 truncate">《{n.title}》</h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {n.author ? `${n.author} · ` : ''}更新于 {fmtTime(n.updatedAt)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDelete(n.id)}
                          disabled={deleting === n.id}
                          className="text-slate-300 hover:text-red-500 transition-colors shrink-0"
                          title="删除资产"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      {/* 转换进度 */}
                      <div>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-slate-500">转换进度</span>
                          <span className="font-mono text-slate-700">{n.convertedCount}/{n.totalChapters} 章</span>
                        </div>
                        <div className="w-full bg-slate-200/70 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              backgroundImage: 'linear-gradient(90deg, #6366f1, #22d3ee)',
                            }}
                          />
                        </div>
                      </div>

                      {/* 最近任务状态 */}
                      <div className="flex items-center gap-2 text-xs">
                        {n.lastJob ? (
                          <>
                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${STATUS_META[n.lastJob.status]?.cls ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[n.lastJob.status]?.dot ?? 'bg-slate-400'}`} />
                              {STATUS_META[n.lastJob.status]?.label ?? n.lastJob.status}
                            </span>
                            {n.lastJob.totalScenes != null && (
                              <span className="text-slate-400">{n.lastJob.totalScenes} 场景</span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">尚未转换</span>
                        )}
                      </div>

                      <div className="flex gap-2 pt-1 mt-auto">
                        {pct < 100 && (
                          <Link
                            href={`/configure?novel=${n.id}`}
                            className="glow-btn flex-1 !py-2 text-xs"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                            {pct === 0 ? '开始转换' : '继续转换'}
                          </Link>
                        )}
                        {pct === 100 && (
                          <Link
                            href={`/configure?novel=${n.id}`}
                            className="glow-btn-ghost flex-1 !py-2 text-xs"
                          >
                            查看配置
                          </Link>
                        )}
                        {n.lastJobId && (
                          <Link
                            href={`/result/${n.lastJobId}`}
                            className="glow-btn-ghost !py-2 text-xs"
                            title="查看最近结果"
                          >
                            结果
                          </Link>
                        )}
                        <button
                          onClick={() => openAppend(n)}
                          className="glow-btn-ghost !py-2 text-xs"
                          title="追加新章节后继续转换"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                          追加
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 转换历史 */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                转换历史
              </h2>
              <span className="text-xs text-slate-400">最近 {stats.totalJobs} 条</span>
            </div>

            {jobs.length === 0 ? (
              <div className="glass-card p-10 text-center">
                <p className="text-slate-400 text-sm">暂无转换任务</p>
              </div>
            ) : (
              <div className="glass-card divide-y divide-slate-100/80 overflow-hidden">
                {jobs.map((j) => {
                  const meta = STATUS_META[j.status] ?? { label: j.status, cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' };
                  const sceneCount = j.resultId;
                  return (
                    <div key={j.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-white/60 transition-colors">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs shrink-0 ${meta.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {j.title ? `《${j.title}》` : `任务 ${j.id.slice(-8)}`}
                          {j.modelId && (
                            <span className="ml-2 text-xs font-mono text-slate-400">{j.modelId}</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {fmtTime(j.createdAt)}
                          {j.selectedChapterCount > 0 && ` · ${j.selectedChapterCount} 章`}
                          {sceneCount && ' · 已生成剧本'}
                          {j.error && <span className="text-red-400 ml-2">⚠ {j.error.slice(0, 40)}</span>}
                        </p>
                      </div>
                      {(j.status === 'completed' || j.status === 'failed') && (
                        <Link
                          href={`/result/${j.id}`}
                          className="glow-btn-ghost !px-3 !py-1.5 text-xs shrink-0"
                        >
                          查看结果
                        </Link>
                      )}
                      {j.status === 'failed' && (
                        <Link
                          href={`/configure?novel=${j.novelId ?? ''}`}
                          className="glow-btn-ghost !px-3 !py-1.5 text-xs shrink-0"
                        >
                          重试
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* 追加章节弹窗 */}
      {appendNovel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setAppendNovel(null)} />
          <div className="relative glass-card w-full max-w-lg p-6 rounded-2xl max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                追加章节
              </h3>
              <button onClick={() => setAppendNovel(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              《{appendNovel.title}》· 当前 {appendNovel.convertedCount}/{appendNovel.totalChapters} 章已转换
              <br />
              粘贴新章节或上传文件，解析结果将并入该小说资产，已转换章节保持不变。
            </p>

            <div className="space-y-3">
              <div
                className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center cursor-pointer hover:border-cyan-400/60 transition-colors"
                onClick={() => document.getElementById('appendFileInput')?.click()}
              >
                {appendFile ? (
                  <p className="text-sm text-cyan-700 font-medium truncate">{appendFile.name}</p>
                ) : (
                  <>
                    <svg className="w-6 h-6 mx-auto text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm text-slate-500 mt-1">点击选择 .txt / .md 文件</p>
                  </>
                )}
                <input
                  id="appendFileInput"
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setAppendFile(f); }}
                />
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-slate-400">或粘贴章节文本</span></div>
              </div>

              <textarea
                value={appendText}
                onChange={(e) => setAppendText(e.target.value)}
                placeholder="粘贴新增章节内容（需包含章节标记，如 第X章）..."
                rows={8}
                className="tech-input resize-y"
              />

              {appendMsg && (
                <div className={`text-sm px-4 py-3 rounded-xl ${appendMsg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                  {appendMsg.text}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setAppendNovel(null)} className="glow-btn-ghost flex-1">取消</button>
                <button onClick={handleAppend} disabled={appendLoading} className="glow-btn flex-1">
                  {appendLoading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      解析中...
                    </>
                  ) : '解析并追加'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
