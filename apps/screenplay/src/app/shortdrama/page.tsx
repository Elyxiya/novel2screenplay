'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import YAML from 'yaml';
import { DramaSchema, type Drama, type Shot } from '@novel/contracts/drama';
import { RequireAuth } from '@/components/RequireAuth';
import { SHOT_TYPE_LABELS, CAMERA_MOVE_LABELS, computeDramaStats, formatDuration } from '@/lib/drama/drama-stats';
import { exportDramaJson, exportDramaExcel } from '@/lib/drama/drama-export';

// ── 展示辅助 ──

interface DramaSummary {
  id: string;
  title: string;
  sourceJobId: string;
  sourceNovelId: string | null;
  totalShots: number;
  totalScenes: number;
  createdAt: number;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'accent' | 'cyan' | 'emerald' | 'amber' | 'default' }) {
  const tones: Record<string, string> = {
    accent: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    cyan: 'bg-cyan-50 text-cyan-600 border-cyan-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    default: 'bg-slate-50 text-slate-600 border-slate-200',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${tones[tone]}`}>
      {children}
    </span>
  );
}

function ShotCard({ shot, sourceScreenplayId }: { shot: Shot; sourceScreenplayId?: string }) {
  const sceneUrl = sourceScreenplayId
    ? `/result/${sourceScreenplayId}?scene=${shot.sceneNumber}`
    : null;
  return (
    <div className="bg-white/85 backdrop-blur border border-slate-200/70 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-500 text-white text-sm font-bold shadow-md shadow-indigo-200/60">
          {shot.shotNumber}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{shot.slugline}</p>
          <p className="text-xs text-slate-400">场景 #{shot.sceneNumber}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Badge tone="accent">{SHOT_TYPE_LABELS[shot.shotType] ?? shot.shotType}</Badge>
          <Badge tone="cyan">{CAMERA_MOVE_LABELS[shot.cameraMove] ?? shot.cameraMove}</Badge>
          <Badge tone="amber">约 {shot.durationSec}s</Badge>
        </div>
      </div>

      {/* 规则增强元数据：情绪/氛围 / 环境音 / 说话人情绪 */}
      {(shot.mood || shot.sound || shot.characterEmotion) && (
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {shot.mood && <Badge tone="default">氛围 · {shot.mood}</Badge>}
          {shot.sound && <Badge tone="emerald"># {shot.sound}</Badge>}
          {shot.characterEmotion && <Badge tone="accent">情绪 · {shot.characterEmotion}</Badge>}
        </div>
      )}

      {/* 溯源入口：分镜 → 剧本场景（剧本页「原文对照」再跳小说原文） */}
      {sceneUrl && (
        <div className="mb-3">
          <Link
            href={sceneUrl}
            prefetch={false}
            className="inline-flex items-center gap-1 text-xs text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-1 hover:bg-teal-100/80 transition-colors"
            title="查看该镜头对应的剧本场景（剧本页可切「原文对照」查看小说原文）"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9v6m3-6v6m3-6v6m6-6v6m3-6v6M7 5h10" />
            </svg>
            溯源 · 剧本场景 #{shot.sceneNumber}
          </Link>
        </div>
      )}

      {shot.dialogue && (
        <div className="mb-2.5 rounded-xl bg-indigo-50/70 border border-indigo-100 px-3.5 py-2.5">
          <p className="text-sm text-slate-800">
            <span className="font-semibold text-indigo-600">{shot.speaker ?? '角色'}：</span>
            {shot.dialogue}
          </p>
        </div>
      )}

      {shot.visual && (
        <p className="text-sm text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-400 mr-1.5">画面</span>
          {shot.visual}
        </p>
      )}

      {shot.action && (
        <p className="mt-1.5 text-xs text-slate-500">
          <span className="font-semibold text-slate-400 mr-1.5">动作</span>
          {shot.action}
        </p>
      )}

      {shot.notes && (
        <p className="mt-1.5 text-xs text-amber-600">
          <span className="font-semibold mr-1.5">备注</span>
          {shot.notes}
        </p>
      )}

      {shot.subtitle && (
        <p className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-400">
          <span className="font-semibold mr-1.5">字幕</span>
          {shot.subtitle}
        </p>
      )}
    </div>
  );
}

// ── 页面 ──

function ShortDramaPageInner() {
  const searchParams = useSearchParams();
  const dramaId = searchParams.get('id');

  // 列表视图状态
  const [summaries, setSummaries] = useState<DramaSummary[] | null>(null);
  // 详情视图状态
  const [drama, setDrama] = useState<Drama | null>(null);
  const [yamlText, setYamlText] = useState('');
  const [showYaml, setShowYaml] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [source, setSource] = useState<{ sourceJobId: string; sourceNovelId: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 编辑弹窗状态
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editYaml, setEditYaml] = useState('');
  const [saving, setSaving] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/drama');
      const data = await res.json();
      if (res.ok) setSummaries(data.dramas ?? []);
      else setError(data.error ?? '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/drama/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '分镜不存在');
        return;
      }
      const parsed = DramaSchema.safeParse(YAML.parse(data.yaml));
      if (!parsed.success) {
        setError('分镜数据解析失败');
        return;
      }
      setDrama(parsed.data);
      setYamlText(data.yaml);
      setSource({ sourceJobId: data.sourceJobId, sourceNovelId: data.sourceNovelId });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (dramaId) await loadDetail(dramaId);
        else await loadList();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [dramaId, loadDetail, loadList]);

  const copyYaml = async () => {
    try {
      await navigator.clipboard.writeText(yamlText);
    } catch {
      // 降级：textarea 选中复制
      const ta = document.createElement('textarea');
      ta.value = yamlText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    alert('分镜 YAML 已复制');
  };

  const downloadYaml = () => {
    const blob = new Blob([yamlText], { type: 'text/yaml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${drama?.metadata.title ?? 'shortdrama'}-分镜.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 打开编辑弹窗（预填标题与 YAML） */
  const openEditor = () => {
    if (!drama) return;
    setEditTitle(drama.metadata.title);
    setEditYaml(yamlText);
    setEditing(true);
  };

  /** 保存编辑：PATCH /api/drama/[id] */
  const saveEdits = async () => {
    if (!dramaId || !drama) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/drama/${dramaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, yaml: editYaml }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '保存失败');
        return;
      }
      setEditing(false);
      await loadDetail(dramaId);
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  /** 删除分镜：DELETE /api/drama/[id] */
  const handleDelete = async () => {
    if (!dramaId || !drama) return;
    if (!window.confirm(`确定删除分镜「${drama.metadata.title}」吗？此操作不可恢复。`)) return;
    try {
      const res = await fetch(`/api/drama/${dramaId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '删除失败');
        return;
      }
      // 回到列表
      window.location.href = '/shortdrama';
    } catch {
      setError('删除失败，请重试');
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-teal-600 to-indigo-600 text-white shadow-lg shadow-teal-200/60">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <rect x="2" y="4" width="20" height="16" rx="3" />
                <path d="M10 9l5 3-5 3V9z" />
              </svg>
            </span>
            短剧分镜
          </h1>
          <p className="text-sm text-slate-500 mt-1">剧本 → 分镜：小说 · 剧本 · 短剧创作链路第三跳</p>
        </div>
        {!dramaId && (
          <Link
            href="/workbench"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-300/40 hover:shadow-lg transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            去生成分镜（从剧本页）
          </Link>
        )}
      </div>

      {/* 详情视图：溯源链 + 分镜表 */}
      {dramaId && drama && (
        <>
          <div className="bg-white/85 backdrop-blur border border-slate-200/70 rounded-2xl p-4 sm:p-5 mb-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900 truncate">{drama.metadata.title}</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9v6m3-6v6m3-6v6m6-6v6m3-6v6M7 5h10" />
                    </svg>
                    {drama.metadata.totalShots} 个镜头
                  </span>
                  <span>覆盖 {drama.metadata.totalScenes} 个场景</span>
                  <span>{new Date(drama.metadata.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setShowStats(v => !v)} className="glow-btn-ghost !px-4 !py-2 text-xs">
                  {showStats ? '收起统计' : '分镜统计'}
                </button>
                <button onClick={() => setShowYaml(v => !v)} className="glow-btn-ghost !px-4 !py-2 text-xs">
                  {showYaml ? '返回分镜表' : '查看 YAML'}
                </button>
                <button onClick={() => exportDramaJson(drama)} className="glow-btn-ghost !px-4 !py-2 text-xs">导出 JSON</button>
                <button onClick={() => exportDramaExcel(drama)} className="glow-btn-ghost !px-4 !py-2 text-xs">导出 Excel</button>
                <button onClick={copyYaml} className="glow-btn-ghost !px-4 !py-2 text-xs">复制 YAML</button>
                <button onClick={downloadYaml} className="glow-btn-ghost !px-4 !py-2 text-xs">下载 YAML</button>
                <button onClick={openEditor} className="glow-btn-ghost !px-4 !py-2 text-xs">编辑</button>
                <button
                  onClick={handleDelete}
                  className="!px-4 !py-2 text-xs rounded-xl border border-red-200 text-red-500 hover:bg-red-50 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>

            {/* 溯源链：小说 → 剧本 → 短剧 */}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400">溯源链</span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-100 text-teal-700">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                小说
                {source?.sourceNovelId ? (
                  <Link href={`/configure?novel=${source.sourceNovelId}`} className="font-semibold underline decoration-teal-200 underline-offset-2 hover:text-teal-800">
                    查看资产
                  </Link>
                ) : '（未关联）'}
              </span>
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <Link
                href={`/result/${source?.sourceJobId}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 hover:bg-indigo-100/80 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                剧本
              </Link>
              <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-teal-600 to-indigo-600 text-white shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                短剧分镜（当前）
              </span>
            </div>
          </div>

          {/* 统计面板 */}
          {showStats && drama && (() => {
            const stats = computeDramaStats(drama);
            const maxType = stats.shotTypeDist[0]?.count ?? 1;
            const maxCam = stats.cameraDist[0]?.count ?? 1;
            return (
              <div className="bg-white/85 backdrop-blur border border-slate-200/70 rounded-2xl p-4 sm:p-5 mb-4 shadow-sm">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 py-3">
                    <p className="text-xl font-bold text-indigo-600">{formatDuration(stats.totalDurationSec)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">预估成片时长</p>
                  </div>
                  <div className="rounded-xl bg-teal-50/70 border border-teal-100 py-3">
                    <p className="text-xl font-bold text-teal-600">{stats.dialogueShots} / {stats.mixedShots}</p>
                    <p className="text-xs text-slate-500 mt-0.5">纯对白 / 混合镜头</p>
                  </div>
                  <div className="rounded-xl bg-cyan-50/70 border border-cyan-100 py-3">
                    <p className="text-xl font-bold text-cyan-600">{stats.dialogueChars}</p>
                    <p className="text-xs text-slate-500 mt-0.5">台词总字数</p>
                  </div>
                  <div className="rounded-xl bg-amber-50/70 border border-amber-100 py-3">
                    <p className="text-xl font-bold text-amber-600">{stats.actionChars}</p>
                    <p className="text-xs text-slate-500 mt-0.5">动作总字数</p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-5 mt-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2">景别分布（{stats.shotTypeDist.length} 种）</p>
                    <div className="space-y-1.5">
                      {stats.shotTypeDist.map(d => (
                        <div key={d.type} className="flex items-center gap-2 text-xs">
                          <span className="w-12 shrink-0 text-slate-600">{d.label}</span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400" style={{ width: `${(d.count / maxType) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right text-slate-400">{d.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2">运镜分布（{stats.cameraDist.length} 种）</p>
                    <div className="space-y-1.5">
                      {stats.cameraDist.map(d => (
                        <div key={d.move} className="flex items-center gap-2 text-xs">
                          <span className="w-14 shrink-0 text-slate-600">{d.label}</span>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400" style={{ width: `${(d.count / maxCam) * 100}%` }} />
                          </div>
                          <span className="w-8 text-right text-slate-400">{d.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {showYaml ? (
            <pre className="bg-slate-900/95 text-slate-100 rounded-2xl p-5 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap shadow-inner">
              {yamlText}
            </pre>
          ) : (
            <div className="grid gap-3">
              {drama.shots.map(s => <ShotCard key={s.shotId} shot={s} sourceScreenplayId={drama.metadata.sourceScreenplayId} />)}
            </div>
          )}
        </>
      )}

      {/* 列表视图 */}
      {!dramaId && (
        <>
          {loading && <p className="text-sm text-slate-400">加载中...</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && summaries && summaries.length === 0 && (
            <div className="bg-white/85 backdrop-blur border border-slate-200/70 rounded-2xl p-12 text-center shadow-sm">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <rect x="2" y="4" width="20" height="16" rx="3" />
                  <path d="M10 9l5 3-5 3V9z" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-800">还没有短剧分镜</h3>
              <p className="text-sm text-slate-500 mt-1.5 mb-5">
                完成小说 → 剧本转换后，在剧本结果页点击「生成短剧分镜」即可创建
              </p>
              <Link
                href="/workbench"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-300/40 hover:shadow-lg transition-all"
              >
                前往工作台
              </Link>
            </div>
          )}
          {!loading && summaries && summaries.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {summaries.map(s => (
                <Link
                  key={s.id}
                  href={`/shortdrama?id=${s.id}`}
                  prefetch={false}
                  className="bg-white/85 backdrop-blur border border-slate-200/70 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-teal-200/80 transition-all group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-800 truncate group-hover:text-teal-700 transition-colors">{s.title}</h3>
                      <p className="text-xs text-slate-400 mt-1">{fmtDate(s.createdAt)}</p>
                    </div>
                    <svg className="w-4 h-4 text-slate-300 group-hover:text-teal-500 shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Badge tone="accent">{s.totalShots} 镜头</Badge>
                    <Badge tone="cyan">{s.totalScenes} 场景</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">编辑分镜</h3>
              <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">标题</label>
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                  maxLength={100}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  分镜 YAML（保存时将校验结构合法性）
                </label>
                <textarea
                  value={editYaml}
                  onChange={e => setEditYaml(e.target.value)}
                  rows={18}
                  spellCheck={false}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-300 resize-y"
                />
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl text-sm text-slate-500 hover:bg-slate-100 transition-colors">
                取消
              </button>
              <button
                onClick={saveEdits}
                disabled={saving}
                className="px-5 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-300/40 hover:shadow-lg transition-all disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ShortDramaPage() {
  return (
    <RequireAuth>
      <Suspense
        fallback={
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 text-sm text-slate-400">加载中…</div>
        }
      >
        <ShortDramaPageInner />
      </Suspense>
    </RequireAuth>
  );
}
