'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { Screenplay, Scene, Character, Location } from '@novel/contracts/screenplay';
import { SceneEditor } from '@/components/editors/SceneEditor';
import { CharacterEditor } from '@/components/editors/CharacterEditor';
import { LocationEditor } from '@/components/editors/LocationEditor';
import { SceneCompare } from '@/components/compare/SceneCompare';
import { RequireAuth } from '@/components/RequireAuth';

type Tab = 'scenes' | 'characters' | 'locations' | 'yaml';
type SceneViewMode = 'editor' | 'compare';

function ResultPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = params.id as string;
  // 溯源跳转：shortdrama 分镜「溯源」入口带 ?scene=N，落地后定位到对应剧本场景
  const sceneParam = searchParams.get('scene');

  const [screenplay, setScreenplay] = useState<Screenplay | null>(null);
  const [yaml, setYaml] = useState('');
  const [editYaml, setEditYaml] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('scenes');
  const [activeScene, setActiveScene] = useState(0);
  const [editingYaml, setEditingYaml] = useState(false);
  const [savingYaml, setSavingYaml] = useState(false);
  const [chapterTexts, setChapterTexts] = useState<string[]>([]);
  const [sceneViewMode, setSceneViewMode] = useState<SceneViewMode>('editor');
  const [scenesCollapsed, setScenesCollapsed] = useState(false);

  // 任务元信息（工具栏展示 + 追加章节需要 novelId）
  const [novelId, setNovelId] = useState<string | null>(null);
  // 来源小说类型：'draft' = 创作台 /writer/[id]，可回跳上游
  const [sourceKind, setSourceKind] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [createdAt, setCreatedAt] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  // ── 追加章节弹窗 ──
  const [appendOpen, setAppendOpen] = useState(false);
  const [appendText, setAppendText] = useState('');
  const [appendFile, setAppendFile] = useState<File | null>(null);
  const [appendLoading, setAppendLoading] = useState(false);
  const [appendMsg, setAppendMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [appendResult, setAppendResult] = useState<{ appended: number; total: number } | null>(null);

  // ── 生成短剧分镜（剧本 → 分镜，第三跳）──
  const [dramaLoading, setDramaLoading] = useState(false);

  // ── 场景 AI 修改（L2 局部追问：结果页针对不满意场景重生成）──
  const [reviseInputs, setReviseInputs] = useState<Record<number, string>>({});
  const [reviseLoading, setReviseLoading] = useState(false);
  const [reviseMsg, setReviseMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // ── 全局套用（L3：scope=all 批量重写全部场景）──
  const [reviseAllOpen, setReviseAllOpen] = useState(false);
  const [reviseAllInput, setReviseAllInput] = useState('');
  const [reviseAllLoading, setReviseAllLoading] = useState(false);
  const [reviseAllMsg, setReviseAllMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // 事件处理器中刷新数据用（含 setState，不直接在 effect 中调用）
  const fetchScreenplay = useCallback(async () => {
    const res = await fetch(`/api/result/${jobId}`);
    const data = await res.json();
    if (res.status === 404) {
      // 任务已失效，清理 SQLite 历史记录（忽略失败）
      fetch(`/api/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
      setLoading(false);
      return;
    }
    if (data.screenplay) {
      setScreenplay(data.screenplay);
      setYaml(data.yaml);
      setEditYaml(data.yaml);
      if (data.chapterTexts) setChapterTexts(data.chapterTexts);
      if (data.novelId) setNovelId(data.novelId);
      if (data.sourceKind) setSourceKind(data.sourceKind);
      if (data.title) setJobTitle(data.title);
      if (data.createdAt) setCreatedAt(data.createdAt);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/result/${jobId}`);
      const data = await res.json();
      if (cancelled) return;
      if (res.status === 404) {
        // 任务已失效，清理 SQLite 历史记录（忽略失败）
        fetch(`/api/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
        setLoading(false);
        return;
      }
      if (data.screenplay) {
        setScreenplay(data.screenplay);
        setYaml(data.yaml);
        setEditYaml(data.yaml);
        if (data.chapterTexts) setChapterTexts(data.chapterTexts);
        if (data.novelId) setNovelId(data.novelId);
        if (data.sourceKind) setSourceKind(data.sourceKind);
        if (data.title) setJobTitle(data.title);
        if (data.createdAt) setCreatedAt(data.createdAt);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  // 溯源落地：初载时按分镜「溯源」参数 ?scene=N 定位到对应剧本场景
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/result/${jobId}`);
      const data = await res.json();
      if (cancelled) return;
      if (res.status === 404) {
        // 任务已失效，清理 SQLite 历史记录（忽略失败）
        fetch(`/api/jobs/${jobId}`, { method: 'DELETE' }).catch(() => {});
        setLoading(false);
        return;
      }
      if (data.screenplay) {
        setScreenplay(data.screenplay);
        setYaml(data.yaml);
        setEditYaml(data.yaml);
        if (data.chapterTexts) setChapterTexts(data.chapterTexts);
        if (data.novelId) setNovelId(data.novelId);
        if (data.title) setJobTitle(data.title);
        if (data.createdAt) setCreatedAt(data.createdAt);
        // 溯源跳转落地：定位到分镜「溯源」指向的剧本场景（原文对照即剧本→小说机制）
        if (sceneParam != null) {
          const sidx = (data.screenplay as Screenplay).scenes.findIndex((s) => s.sceneNumber === Number(sceneParam));
          if (sidx >= 0) setActiveScene(sidx);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, sceneParam]);

  const saveYaml = async () => {
    setSavingYaml(true);
    try {
      const res = await fetch(`/api/result/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: editYaml }),
      });
      const data = await res.json();
      if (data.success) {
        setYaml(editYaml);
        setEditingYaml(false);
        await fetchScreenplay();
      } else {
        alert('保存失败: ' + (data.error || data.details?.message || '未知错误'));
      }
    } finally {
      setSavingYaml(false);
    }
  };

  const saveScene = async (scene: Scene) => {
    const res = await fetch(`/api/result/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchScreenplay();
    } else {
      alert('保存失败: ' + (data.error || data.details?.message || '未知错误') + (data.details ? '\n\n详情: ' + data.details : ''));
    }
  };

  const saveCharacter = async (character: Character) => {
    const res = await fetch(`/api/result/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchScreenplay();
    } else {
      alert('保存失败: ' + (data.error || '未知错误'));
    }
  };

  const saveLocation = async (location: Location) => {
    const res = await fetch(`/api/result/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchScreenplay();
    } else {
      alert('保存失败: ' + (data.error || '未知错误'));
    }
  };

  const deleteCharacter = async (characterId: string) => {
    const res = await fetch(`/api/result/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteCharacterId: characterId }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchScreenplay();
    } else {
      alert('删除失败: ' + (data.error || '未知错误'));
    }
  };

  const deleteLocation = async (locationId: string) => {
    const res = await fetch(`/api/result/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deleteLocationId: locationId }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchScreenplay();
    } else {
      alert('删除失败: ' + (data.error || '未知错误'));
    }
  };

  const addCharacter = async () => {
    const next = sp.characters.length + 1;
    const newChar: Character = {
      characterId: `char_${next}`,
      name: '新角色',
      aliases: [],
      personalityTags: [],
      description: '',
      isMajor: false,
    };
    await saveCharacter(newChar);
  };

  const addLocation = async () => {
    const next = sp.locations.length + 1;
    const newLoc: Location = {
      locationId: `loc_${next}`,
      name: '新地点',
      type: 'interior',
      description: '',
    };
    await saveLocation(newLoc);
  };

  const downloadYaml = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${screenplay?.metadata?.title || '剧本'}.yaml`;
    a.click();
  };

  const copyYaml = async () => {
    await navigator.clipboard.writeText(yaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // ── 追加章节：粘贴文本或选择文件，并入当前资产 ──
  const openAppend = () => {
    setAppendOpen(true);
    setAppendText('');
    setAppendFile(null);
    setAppendMsg(null);
    setAppendResult(null);
  };
  // ── 生成短剧分镜：调用 /api/drama/convert 后跳转分镜页 ──
  const convertToDrama = async () => {
    if (!screenplay) return;
    setDramaLoading(true);
    try {
      const res = await fetch('/api/drama/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = await res.json();
      if (res.ok && data.dramaId) {
        router.push(`/shortdrama?id=${data.dramaId}`);
      } else {
        alert('生成失败: ' + (data.error ?? '未知错误'));
      }
    } catch {
      alert('生成失败，请重试');
    } finally {
      setDramaLoading(false);
    }
  };

  // ── 当前场景 AI 局部修改（L2：结果页局部追问）──
  const submitSceneRevise = async () => {
    const scene = sp?.scenes[activeScene];
    if (!scene) return;
    const instruction = (reviseInputs[scene.sceneNumber] ?? '').trim();
    if (!instruction || reviseLoading) return;
    setReviseLoading(true);
    setReviseMsg(null);
    try {
      const res = await fetch('/api/result/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, sceneNumber: scene.sceneNumber, instruction, scope: 'scene' }),
      });
      const data = await res.json();
      if (data.success) {
        setReviseMsg({ type: 'ok', text: data.message ?? '场景已更新' });
        setReviseInputs(prev => ({ ...prev, [scene.sceneNumber]: '' }));
        await fetchScreenplay();
      } else {
        setReviseMsg({ type: 'err', text: data.error ?? '修改失败' });
      }
    } catch {
      setReviseMsg({ type: 'err', text: '修改失败，请重试' });
    } finally {
      setReviseLoading(false);
    }
  };

  // ── 全局套用（L3：scope=all 按一条指令重写全部场景）──
  const submitReviseAll = async () => {
    const instruction = reviseAllInput.trim();
    if (!instruction || reviseAllLoading) return;
    setReviseAllLoading(true);
    setReviseAllMsg(null);
    try {
      const res = await fetch('/api/result/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, instruction, scope: 'all' }),
      });
      const data = await res.json();
      if (data.success) {
        setReviseAllMsg({ type: 'ok', text: data.message ?? `已重生成 ${data.totalUpdated ?? 0} 个场景` });
        setReviseAllInput('');
        await fetchScreenplay();
      } else {
        setReviseAllMsg({ type: 'err', text: data.error ?? '修改失败' });
      }
    } catch {
      setReviseAllMsg({ type: 'err', text: '修改失败，请重试' });
    } finally {
      setReviseAllLoading(false);
    }
  };

  const handleAppend = async () => {
    if (!novelId) return;
    if (!appendText.trim() && !appendFile) {
      setAppendMsg({ type: 'err', text: '请粘贴章节文本或选择文件' });
      return;
    }
    setAppendLoading(true);
    setAppendMsg(null);
    const fd = new FormData();
    fd.append('novelId', novelId);
    if (appendFile) fd.append('file', appendFile);
    else fd.append('text', appendText);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) {
        setAppendMsg({ type: 'err', text: d.error ?? '追加失败' });
        return;
      }
      const appended = d.appended ?? 0;
      const total = d.chapters?.length ?? 0;
      if (appended > 0) {
        setAppendMsg({ type: 'ok', text: `已追加 ${appended} 章，资产现有 ${total} 章` });
        setAppendText('');
        setAppendFile(null);
        setAppendResult({ appended, total });
      } else {
        setAppendMsg({ type: 'ok', text: '未发现新章节（内容与已有章节重复），资产保持不变' });
        setAppendResult(null);
      }
    } catch {
      setAppendMsg({ type: 'err', text: '追加失败，请重试' });
    } finally {
      setAppendLoading(false);
    }
  };

  const currentSceneOriginalText = useMemo(() => {
    if (!screenplay || !chapterTexts.length) return '';
    const scene = screenplay.scenes[activeScene];
    if (!scene) return '';
    if (scene.sourceChapterRange) {
      const [start, end] = scene.sourceChapterRange;
      return chapterTexts.slice(start, end + 1).join('\n\n─── 章节分隔 ───\n\n');
    }
    const allRefs = scene.content.flatMap(b => b.sourceRefs ?? []);
    const chapterIndices = [...new Set(allRefs.map(r => r.chapterIndex))].sort((a, b) => a - b);
    if (!chapterIndices.length) return '';
    return chapterIndices
      .map(ci => chapterTexts[ci] ?? '')
      .filter(Boolean)
      .join('\n\n─── 章节分隔 ───\n\n');
  }, [screenplay, activeScene, chapterTexts]);

  // 全局套用（scope=all）输入量级估算：以章节原文总字符数粗估 token
  const estimateReviseAllTokens = useMemo(() => {
    const chars = chapterTexts.reduce((sum, t) => sum + t.length, 0);
    return Math.ceil(chars / 2);
  }, [chapterTexts]);

  if (loading) return <div className="text-center py-20 text-gray-400">加载中...</div>;
  if (!screenplay) return <div className="text-center py-20 text-gray-400">未找到剧本数据</div>;

  const sp = screenplay;
  const currentScene = sp.scenes[activeScene];

  const a = sp.analytics;
  const displayTitle = jobTitle || sp.metadata.title;

  const fmtDate = (ts: number) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <RequireAuth>
    <div className="flex flex-col h-full">
      {/* ── 工具栏：标题/统计 + 操作按钮 + Tabs ── */}
      <div className="shrink-0 sticky top-0 z-20 bg-white/70 backdrop-blur-xl border-b border-slate-200/70 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 space-y-3">
          {/* 标题 + 统计徽章 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">{displayTitle}</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {sp.metadata.totalScenes} 场景
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {sp.metadata.totalCharacters} 角色
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {sp.metadata.totalLocations} 地点
                  </span>
                  {a && (
                    <>
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />对白 {a.dialoguePercentage}%
                      </span>
                      <span className="inline-flex items-center gap-1 text-cyan-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />动作 {a.actionPercentage}%
                      </span>
                      <span>共 {a.totalWords >= 10000 ? `${(a.totalWords / 10000).toFixed(1)}万` : a.totalWords} 字</span>
                    </>
                  )}
                  {createdAt > 0 && <span className="text-slate-400">{fmtDate(createdAt)}</span>}
                </div>
              </div>
            </div>

            {/* 工具栏操作按钮组 */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={convertToDrama}
                disabled={dramaLoading}
                className="glow-btn !px-4 !py-2 text-xs disabled:opacity-60"
                title="把当前剧本转换为短剧分镜表"
              >
                {dramaLoading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <rect x="2" y="4" width="20" height="16" rx="3" />
                    <path d="M10 9l5 3-5 3V9z" />
                  </svg>
                )}
                {dramaLoading ? '生成中...' : '生成短剧分镜'}
              </button>
              <button
                onClick={openAppend}
                disabled={!novelId}
                title={novelId ? '追加新章节到当前资产并续转' : '该任务未关联小说资产，无法追加'}
                className="glow-btn !px-4 !py-2 text-xs disabled:opacity-40 disabled:pointer-events-none"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                追加章节
              </button>
              <button
                onClick={() => { setReviseAllOpen(true); setReviseAllInput(''); setReviseAllMsg(null); }}
                className="glow-btn-ghost !px-4 !py-2 text-xs"
                title="按一条全局指令重写全部场景（消耗 token 较多，建议先在单场景试用）"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                全局套用
              </button>
              {novelId && (
                <Link
                  href={`/configure?novel=${novelId}`}
                  className="glow-btn-ghost !px-4 !py-2 text-xs"
                  title="在配置页续转未转换章节"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  续转
                </Link>
              )}
              <button onClick={copyYaml} className="glow-btn-ghost !px-4 !py-2 text-xs">
                {copied ? (
                  <>
                    <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    已复制
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    复制 YAML
                  </>
                )}
              </button>
              <button onClick={downloadYaml} className="glow-btn-ghost !px-4 !py-2 text-xs">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                下载 YAML
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 bg-white/80 backdrop-blur rounded-xl border border-slate-200/70 p-1">
              {([
                { key: 'scenes', label: '场景', count: sp.scenes.length },
                { key: 'characters', label: '角色', count: sp.characters.length },
                { key: 'locations', label: '地点', count: sp.locations.length },
                { key: 'yaml', label: 'YAML', count: null },
              ] as const).map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                    tab === t.key
                      ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-300/40'
                      : 'text-slate-500 hover:bg-slate-100/70'
                  }`}
                >
                  {t.label}
                  {t.count !== null && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Link
              href={sourceKind === 'draft' && novelId ? `/writer/${novelId}` : '/workbench'}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-cyan-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {sourceKind === 'draft' ? '返回创作台' : '返回工作台'}
            </Link>
          </div>
        </div>
      </div>

      {/* 可滚动内容区 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-7xl mx-auto space-y-4">

          {/* ── 场景 Tab ── */}
          {tab === 'scenes' && sp.scenes.length === 0 && (
            <div className="glass-card flex flex-col items-center justify-center text-center py-24 px-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-50 to-cyan-50 border border-slate-200/70 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16M4 12h16M4 19h10" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-slate-700">暂无场景数据</h3>
              <p className="text-sm text-slate-400 mt-1.5 max-w-md">
                本次转换未生成场景。可返回工作台重新配置（角色/地点已在下方 Tab 展示），或检查小说原文与模型选择。
              </p>
            </div>
          )}
          {/* ── 场景 Tab ── */}
          {tab === 'scenes' && sp.scenes.length > 0 && (
            <div className="flex gap-3" style={{ height: 'calc(100vh - 235px)' }}>
              {/* 场景导航（可折叠） */}
              {scenesCollapsed ? (
                <div className="w-11 shrink-0 rounded-xl bg-white border border-slate-200/80 shadow-sm flex flex-col items-center py-3 gap-3">
                  <button
                    onClick={() => setScenesCollapsed(false)}
                    title="展开场景列表"
                    className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-[10px] text-slate-400 tracking-wide [writing-mode:vertical-rl]">
                    场景列表
                  </span>
                  <span className="text-xs font-mono text-slate-400">{sp.scenes.length}</span>
                  <button
                    onClick={() => setScenesCollapsed(false)}
                    title="展开场景列表"
                    className="flex items-center justify-center w-7 h-7 rounded-lg text-indigo-500 bg-indigo-50 hover:bg-indigo-100 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="w-60 shrink-0 space-y-1.5 overflow-y-auto pr-1 transition-all duration-300">
                  <div className="flex items-center justify-between px-2 pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-400 tracking-wider">场景列表</span>
                      <button
                        onClick={() => setScenesCollapsed(true)}
                        title="收起场景列表"
                        className="flex items-center justify-center w-5 h-5 rounded-md text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l-7 7 7 7M5 5l-7 7 7 7" />
                        </svg>
                      </button>
                    </div>
                    <span className="text-xs font-mono text-slate-400">{activeScene + 1}/{sp.scenes.length}</span>
                  </div>
                  {sp.scenes.map((s, i) => (
                    <button
                      key={s.sceneNumber}
                      onClick={() => { setActiveScene(i); setReviseMsg(null); }}
                      className={`w-full text-left p-2.5 rounded-lg text-sm transition-all duration-200 border ${
                        i === activeScene
                          ? 'bg-gradient-to-r from-indigo-50 to-cyan-50 border-indigo-200 text-indigo-700 shadow-sm'
                          : 'hover:bg-slate-50 border-transparent text-slate-600'
                      }`}
                    >
                      <span className={`font-mono text-xs ${i === activeScene ? 'text-indigo-500 font-semibold' : 'text-gray-400'}`}>
                        #{String(s.sceneNumber).padStart(2, '0')}
                      </span>
                      <span className="ml-1.5 truncate block">{s.summary || s.slugline}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 场景详情 */}
              <div className="flex-1 glass-card overflow-hidden flex flex-col">
                {/* 详情头部：场景信息 + 编辑/对照切换 */}
                <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200/70 bg-white/40 backdrop-blur z-10 sticky top-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-cyan-500 text-white text-sm font-bold shrink-0 shadow-md shadow-indigo-300/40">
                      {currentScene.sceneNumber}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate text-sm">{currentScene.slugline}</p>
                      {currentScene.summary && (
                        <p className="text-xs text-slate-400 truncate">{currentScene.summary}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 bg-slate-100 rounded-lg p-1 shrink-0 ml-3">
                    {([
                      { key: 'editor', label: '编辑' },
                      { key: 'compare', label: '原文对照' },
                    ] as const).map(m => (
                      <button
                        key={m.key}
                        onClick={() => setSceneViewMode(m.key)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                          sceneViewMode === m.key
                            ? 'bg-white text-indigo-600 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI 修改栏：编辑视图下按当前场景局部追问（L2） */}
                {sceneViewMode === 'editor' && (
                  <div className="shrink-0 px-4 py-2.5 border-b border-amber-100 bg-amber-50/50">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-amber-700 shrink-0">AI 修改</span>
                      <input
                        type="text"
                        value={reviseInputs[currentScene.sceneNumber] ?? ''}
                        onChange={e => setReviseInputs(prev => ({ ...prev, [currentScene.sceneNumber]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter' && !reviseLoading) void submitSceneRevise(); }}
                        placeholder="如：这场戏对白太干，增加人物冲突，动作描写更细腻..."
                        className="tech-input flex-1 !py-1.5 text-xs"
                        disabled={reviseLoading}
                      />
                      <button
                        onClick={submitSceneRevise}
                        disabled={reviseLoading || !(reviseInputs[currentScene.sceneNumber] ?? '').trim()}
                        className="glow-btn !px-3 !py-1.5 text-xs disabled:opacity-50 shrink-0"
                      >
                        {reviseLoading ? (
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        )}
                        {reviseLoading ? '修改中...' : '应用修改'}
                      </button>
                    </div>
                    {reviseMsg && (
                      <p className={`mt-1.5 text-xs ${reviseMsg.type === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {reviseMsg.text}
                      </p>
                    )}
                  </div>
                )}

                {/* 滚动内容 */}
                <div className="flex-1 overflow-y-auto">
                  {sceneViewMode === 'editor' ? (
                    <SceneEditor
                      scene={currentScene}
                      locations={sp.locations}
                      characters={sp.characters}
                      onChange={() => {}}
                      onSave={saveScene}
                    />
                  ) : (
                    <SceneCompare
                      scene={currentScene}
                      originalText={currentSceneOriginalText}
                      characters={sp.characters}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── 角色 Tab ── */}
          {tab === 'characters' && (
            <div className="min-h-[500px]">
              <div className="flex justify-end mb-3">
                <button onClick={addCharacter} className="glow-btn-ghost !px-4 !py-2 text-xs">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  新增角色
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sp.characters.map(c => (
                  <CharacterEditor key={c.characterId} character={c} onSave={saveCharacter} onDelete={deleteCharacter} />
                ))}
              </div>
            </div>
          )}

          {/* ── 地点 Tab ── */}
          {tab === 'locations' && (
            <div className="min-h-[500px]">
              <div className="flex justify-end mb-3">
                <button onClick={addLocation} className="glow-btn-ghost !px-4 !py-2 text-xs">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  新增地点
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sp.locations.map(l => (
                  <LocationEditor key={l.locationId} location={l} onSave={saveLocation} onDelete={deleteLocation} />
                ))}
              </div>
            </div>
          )}

          {/* ── YAML Tab ── */}
          {tab === 'yaml' && (
            <div className="glass-card flex flex-col min-h-[500px] overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-slate-200/70 shrink-0">
                <h3 className="font-semibold text-sm text-slate-700">YAML 输出</h3>
                <div className="flex gap-2">
                  {!editingYaml ? (
                    <>
                      <button onClick={() => { setEditingYaml(true); setEditYaml(yaml); }} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs hover:bg-white/70 text-slate-600 transition-colors">编辑</button>
                      <button onClick={copyYaml} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs hover:bg-white/70 text-slate-600 transition-colors">复制</button>
                    </>
                  ) : (
                    <>
                      <button onClick={saveYaml} disabled={savingYaml} className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-cyan-500 text-white rounded-lg text-xs shadow-md shadow-indigo-300/40 disabled:opacity-50">
                        {savingYaml ? '保存中...' : '校验并保存'}
                      </button>
                      <button onClick={() => { setEditingYaml(false); setEditYaml(yaml); }} className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs hover:bg-white/70 text-slate-600 transition-colors">取消</button>
                    </>
                  )}
                </div>
              </div>
              <textarea
                value={editingYaml ? editYaml : yaml}
                onChange={e => editingYaml && setEditYaml(e.target.value)}
                readOnly={!editingYaml}
                rows={30}
                className={`w-full p-4 text-xs font-mono resize-none focus:outline-none overflow-y-auto flex-1 bg-transparent ${editingYaml ? 'bg-cyan-50/50' : ''}`}
                spellCheck={false}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── 追加章节弹窗 ── */}
      {appendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setAppendOpen(false)} />
          <div className="relative w-full max-w-lg glass-card rounded-3xl shadow-2xl p-6 animate-float-up">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-400 text-white shadow-lg shadow-indigo-300/40">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </span>
                <div>
                  <h3 className="font-bold text-slate-900">追加章节</h3>
                  <p className="text-xs text-slate-500">《{displayTitle}》· 续写后可在配置页继续转换</p>
                </div>
              </div>
              <button onClick={() => setAppendOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 文件选择 */}
            <button
              onClick={() => document.getElementById('appendFileInput')?.click()}
              className="w-full p-4 rounded-xl border-2 border-dashed border-slate-300 hover:border-cyan-400/60 hover:bg-cyan-50/30 transition-all text-center"
            >
              {appendFile ? (
                <p className="text-sm text-cyan-700 font-medium truncate">{appendFile.name}</p>
              ) : (
                <>
                  <svg className="w-6 h-6 mx-auto text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-sm text-slate-500 mt-2">选择 .txt / .md 文件</p>
                  <p className="text-xs text-slate-400 mt-0.5">仅追加新章节，已有内容自动去重</p>
                </>
              )}
            </button>
            <input
              type="file"
              accept=".txt,.md"
              id="appendFileInput"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setAppendFile(f); }}
            />

            {/* 文本粘贴 */}
            <div className="relative mt-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs text-slate-400">或直接粘贴章节文本</span>
              </div>
            </div>
            <textarea
              value={appendText}
              onChange={e => setAppendText(e.target.value)}
              rows={6}
              placeholder="在此粘贴新增章节的文本，系统会自动识别章节结构..."
              className="tech-input resize-y mt-3"
            />

            {/* 结果提示 */}
            {appendMsg && (
              <div className={`mt-3 text-sm px-4 py-3 rounded-xl ${appendMsg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                {appendMsg.text}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAppendOpen(false)} className="glow-btn-ghost flex-1 !py-3">取消</button>
              {appendResult ? (
                <Link
                  href={`/configure?novel=${novelId}`}
                  className="glow-btn flex-1 !py-3 justify-center"
                >
                  前往配置页续转
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              ) : (
                <button onClick={handleAppend} disabled={appendLoading} className="glow-btn flex-1 !py-3">
                  {appendLoading ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      解析并追加...
                    </>
                  ) : (
                    <>
                      解析并追加
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 全局套用弹窗（L3：scope=all）── */}
      {reviseAllOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !reviseAllLoading && setReviseAllOpen(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6 animate-float-up">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-400 text-white shadow-lg shadow-amber-300/40">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </span>
                <div>
                  <h3 className="font-bold text-slate-900">全局套用 AI 修改</h3>
                  <p className="text-xs text-slate-500">按一条指令重写全部 {sp.scenes.length} 个场景，建议先在单场景试用</p>
                </div>
              </div>
              <button
                onClick={() => setReviseAllOpen(false)}
                disabled={reviseAllLoading}
                className="text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <textarea
              value={reviseAllInput}
              onChange={e => setReviseAllInput(e.target.value)}
              rows={4}
              placeholder="如：全剧对白口语化、减少书面语；动作描写更简练；整体节奏加快..."
              className="tech-input resize-y"
              disabled={reviseAllLoading}
            />

            <div className="mt-3 flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl p-3 border border-slate-200/70">
              <svg className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                预计输入约 <b className="text-slate-700">{estimateReviseAllTokens >= 1000 ? `${(estimateReviseAllTokens / 1000).toFixed(1)}k` : estimateReviseAllTokens}</b> tokens（按章节原文长度粗估），输出另计。全局重写耗时会明显长于单场景修改。
              </span>
            </div>

            {reviseAllMsg && (
              <div className={`mt-3 text-sm px-4 py-3 rounded-xl ${reviseAllMsg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                {reviseAllMsg.text}
              </div>
            )}

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setReviseAllOpen(false)}
                disabled={reviseAllLoading}
                className="glow-btn-ghost flex-1 !py-3 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={submitReviseAll}
                disabled={reviseAllLoading || !reviseAllInput.trim()}
                className="glow-btn flex-1 !py-3 disabled:opacity-50"
              >
                {reviseAllLoading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    重写中，请勿关闭页面...
                  </>
                ) : (
                  <>
                    确认应用
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </RequireAuth>
  );
}

export default function ResultPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-gray-400">加载中...</div>}>
      <ResultPageInner />
    </Suspense>
  );
}
