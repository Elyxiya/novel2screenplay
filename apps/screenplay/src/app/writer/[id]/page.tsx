'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/RequireAuth';

interface NovelVolume {
  id: string;
  title: string;
  order: number;
  description: string;
}
interface NovelChapter {
  id: string;
  volumeId: string | null;
  title: string;
  order: number;
  content: string;
  wordCount: number;
  updatedAt: number;
}
interface CharacterCard {
  id: string;
  name: string;
  role: string;
  traits: string;
  background: string;
  notes: string;
}
interface WorldItem {
  id: string;
  name: string;
  category: string;
  description: string;
}
interface DraftNovel {
  id: string;
  title: string;
  author: string;
  synopsis: string;
  volumes: NovelVolume[];
  chapters: NovelChapter[];
  characters: CharacterCard[];
  worldItems: WorldItem[];
  userId: string | null;
  createdAt: number;
  updatedAt: number;
}

type Tab = 'chapters' | 'characters' | 'world';
type AiAction = 'continue' | 'expand' | 'rewrite' | 'polish';

const AI_ACTION_LABEL: Record<AiAction, string> = {
  continue: '续写',
  expand: '扩写',
  rewrite: '改写',
  polish: '润色',
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// React Compiler 规则不追踪模块级函数内部的不纯调用，用它包装 Date.now()
const nowTs = () => Date.now();

export default function WriterEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const novelId = params.id;

  const [novel, setNovel] = useState<DraftNovel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('chapters');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // 章节编辑缓冲
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [saving, setSaving] = useState(false);

  // AI
  const [aiAction, setAiAction] = useState<AiAction>('continue');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // 新建/编辑面板
  const [editingCharacter, setEditingCharacter] = useState<CharacterCard | null>(null);
  const [showCharacterForm, setShowCharacterForm] = useState(false);
  const [editingWorld, setEditingWorld] = useState<WorldItem | null>(null);
  const [showWorldForm, setShowWorldForm] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [metaDraft, setMetaDraft] = useState({ title: '', author: '', synopsis: '' });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/writer/novels/${novelId}`);
        if (!res.ok) throw new Error(`加载失败(${res.status})`);
        const data = await res.json();
        if (!cancelled) {
          setNovel(data.novel);
          setMetaDraft({ title: data.novel.title, author: data.novel.author, synopsis: data.novel.synopsis });
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
  }, [novelId]);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };

  const selectedChapter = useMemo(
    () => novel?.chapters.find((c) => c.id === selectedId) ?? null,
    [novel, selectedId],
  );

  const selectChapter = (id: string) => {
    const ch = novel?.chapters.find((c) => c.id === id);
    if (!ch) return;
    setSelectedId(id);
    setDraftTitle(ch.title);
    setDraftContent(ch.content);
    setAiResult(null);
    setAiError(null);
  };

  // ── 章节操作 ──

  const addChapter = async (volumeId: string | null) => {
    if (!novel) return;
    const volumeChapters = novel.chapters.filter((c) => c.volumeId === volumeId);
    const chapter: NovelChapter = {
      id: uid(),
      volumeId,
      title: `第 ${volumeChapters.length + 1} 章`,
      order: volumeChapters.length,
      content: '',
      wordCount: 0,
      updatedAt: nowTs(),
    };
    const res = await fetch(`/api/writer/novels/${novelId}/chapter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chapter),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? '创建章节失败');
      return;
    }
    setNovel((prev) => (prev ? { ...prev, chapters: [...prev.chapters, chapter] } : prev));
    selectChapter(chapter.id);
    showToast('已创建章节');
  };

  const saveChapter = async () => {
    if (!novel || !selectedId) return;
    setSaving(true);
    try {
      const chapter = novel.chapters.find((c) => c.id === selectedId);
      if (!chapter) return;
      const payload: NovelChapter = {
        ...chapter,
        title: draftTitle || '未命名章节',
        content: draftContent,
        updatedAt: nowTs(),
      };
      const res = await fetch(`/api/writer/novels/${novelId}/chapter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('保存失败');
      setNovel((prev) =>
        prev ? { ...prev, chapters: prev.chapters.map((c) => (c.id === selectedId ? payload : c)) } : prev,
      );
      setDraftTitle(payload.title);
      showToast('已保存');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteChapter = async (id: string) => {
    if (!window.confirm('删除该章节？')) return;
    const res = await fetch(`/api/writer/novels/${novelId}/chapter`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId: id }),
    });
    if (!res.ok) return;
    setNovel((prev) => (prev ? { ...prev, chapters: prev.chapters.filter((c) => c.id !== id) } : prev));
    if (selectedId === id) {
      setSelectedId(null);
      setDraftTitle('');
      setDraftContent('');
    }
    showToast('已删除章节');
  };

  // ── 卷操作 ──

  const addVolume = async () => {
    if (!novel) return;
    const volume: NovelVolume = {
      id: uid(),
      title: `第 ${novel.volumes.length + 1} 卷`,
      order: novel.volumes.length,
      description: '',
    };
    const res = await fetch(`/api/writer/novels/${novelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volumes: [...novel.volumes, volume] }),
    });
    if (!res.ok) return;
    setNovel((prev) => (prev ? { ...prev, volumes: [...prev.volumes, volume] } : prev));
    showToast('已新建分卷');
  };

  const renameVolume = async (id: string, title: string) => {
    if (!novel) return;
    const volumes = novel.volumes.map((v) => (v.id === id ? { ...v, title } : v));
    await fetch(`/api/writer/novels/${novelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volumes }),
    });
    setNovel((prev) => (prev ? { ...prev, volumes } : prev));
  };

  // ── 元信息 ──

  const saveMeta = async () => {
    if (!novel) return;
    const res = await fetch(`/api/writer/novels/${novelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: metaDraft }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? '保存失败');
      return;
    }
    setNovel((prev) => (prev ? { ...prev, ...metaDraft } : prev));
    showToast('作品信息已保存');
  };

  // ── 人物卡 / 世界观 ──

  const saveCharacters = async (characters: CharacterCard[]) => {
    if (!novel) return;
    const res = await fetch(`/api/writer/novels/${novelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characters }),
    });
    if (!res.ok) return;
    setNovel((prev) => (prev ? { ...prev, characters } : prev));
  };

  const saveWorldItems = async (worldItems: WorldItem[]) => {
    if (!novel) return;
    const res = await fetch(`/api/writer/novels/${novelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worldItems }),
    });
    if (!res.ok) return;
    setNovel((prev) => (prev ? { ...prev, worldItems } : prev));
  };

  const submitCharacter = async () => {
    if (!novel) return;
    const base = {
      name: form.name || '未命名',
      role: form.role ?? '',
      traits: form.traits ?? '',
      background: form.background ?? '',
      notes: form.notes ?? '',
    };
    if (editingCharacter) {
      await saveCharacters(novel.characters.map((c) => (c.id === editingCharacter.id ? { ...c, ...base } : c)));
    } else {
      await saveCharacters([...novel.characters, { id: uid(), ...base }]);
    }
    setShowCharacterForm(false);
    setEditingCharacter(null);
    setForm({});
    showToast('人物卡已保存');
  };

  const submitWorld = async () => {
    if (!novel) return;
    const base = {
      name: form.name || '未命名',
      category: form.category ?? '',
      description: form.description ?? '',
    };
    if (editingWorld) {
      await saveWorldItems(novel.worldItems.map((w) => (w.id === editingWorld.id ? { ...w, ...base } : w)));
    } else {
      await saveWorldItems([...novel.worldItems, { id: uid(), ...base }]);
    }
    setShowWorldForm(false);
    setEditingWorld(null);
    setForm({});
    showToast('词条已保存');
  };

  // ── AI 写作 ──

  const runAi = async () => {
    if (!selectedId) return;
    if (!draftContent.trim() && aiAction !== 'continue') {
      setAiError('请先输入正文内容');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch(`/api/writer/novels/${novelId}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: aiAction,
          content: draftContent,
          instruction: aiInstruction || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'AI 生成失败');
      }
      const data = await res.json();
      setAiResult(data.result);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const applyAi = () => {
    if (!aiResult) return;
    if (aiAction === 'continue') {
      const sep = draftContent.trim() ? '\n\n' : '';
      setDraftContent((prev) => (prev + sep + aiResult).trim());
    } else {
      setDraftContent(aiResult);
    }
    setAiResult(null);
    showToast('AI 结果已应用到正文，记得保存');
  };

  // ── 导出 ──

  const exportFile = (format: 'md' | 'txt') => {
    if (!novel) return;
    const sorted = [...novel.chapters].sort((a, b) => {
      const va = a.volumeId ? a.order : 9999 + a.order;
      const vb = b.volumeId ? b.order : 9999 + b.order;
      return va - vb;
    });
    const lines: string[] = [];
    lines.push(`# ${novel.title}`);
    if (novel.author) lines.push(`作者：${novel.author}`);
    if (novel.synopsis) lines.push(`\n> ${novel.synopsis}`);
    lines.push('');

    const volumeMap = new Map(novel.volumes.map((v) => [v.id, v]));
    let lastVolumeId: string | null = null;
    for (const ch of sorted) {
      if (ch.volumeId !== lastVolumeId && ch.volumeId) {
        const vol = volumeMap.get(ch.volumeId);
        if (vol && vol.title !== lastVolumeId) {
          lines.push(`\n${format === 'md' ? '## ' : ''}${vol.title}\n`);
        }
        lastVolumeId = ch.volumeId;
      }
      lines.push(`${format === 'md' ? '## ' : ''}${ch.title}\n`);
      lines.push(ch.content);
      lines.push('');
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${novel.title}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${format.toUpperCase()}`);
  };

  // ── 送去转剧本 ──

  const convert = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/writer/novels/${novelId}/convert`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? '无法转剧本');
      }
      const data = await res.json();
      router.push(`/configure?novel=${data.novelId}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (loading) {
    return (
      <RequireAuth>
        <div className="max-w-5xl mx-auto bg-white rounded-xl border p-16 text-center text-gray-400 text-sm">加载中...</div>
      </RequireAuth>
    );
  }

  if (!novel) {
    return (
      <RequireAuth>
        <div className="max-w-5xl mx-auto bg-white rounded-xl border p-16 text-center">
          <p className="text-gray-500 mb-4">{error ?? '创作小说不存在'}</p>
          <button onClick={() => router.push('/writer')} className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg">
            返回创作台
          </button>
        </div>
      </RequireAuth>
    );
  }

  const volumeChapters = (volumeId: string | null) =>
    novel.chapters.filter((c) => c.volumeId === volumeId).sort((a, b) => a.order - b.order);

  return (
    <RequireAuth>
      <div className="max-w-[1400px] mx-auto flex flex-col h-[calc(100vh-90px)]">
        {/* 顶部工具条 */}
        <div className="flex items-center gap-3 flex-wrap bg-white rounded-xl border px-4 py-2.5">
          <button
            onClick={() => router.push('/writer')}
            className="text-gray-400 hover:text-gray-600 text-sm flex items-center gap-1"
          >
            ← 创作台
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <input
            value={metaDraft.title}
            onChange={(e) => setMetaDraft({ ...metaDraft, title: e.target.value })}
            className="text-base font-semibold bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1.5 py-0.5 w-48"
            placeholder="作品标题"
          />
          <input
            value={metaDraft.author}
            onChange={(e) => setMetaDraft({ ...metaDraft, author: e.target.value })}
            className="text-xs text-gray-400 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1.5 py-0.5 w-24"
            placeholder="作者"
          />
          <button
            onClick={saveMeta}
            className="px-2.5 py-1 text-xs border rounded-lg hover:bg-gray-50 text-gray-500"
          >
            保存信息
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-400">
              {novel.chapters.length} 章 · {novel.chapters.reduce((s, c) => s + c.wordCount, 0).toLocaleString()} 字
            </span>
            <div className="relative group">
              <button className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 text-gray-600">
                导出 ▾
              </button>
              <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg py-1 w-28 hidden group-hover:block z-20">
                <button onClick={() => exportFile('md')} className="block w-full px-3 py-1.5 text-xs hover:bg-gray-50 text-left">
                  Markdown
                </button>
                <button onClick={() => exportFile('txt')} className="block w-full px-3 py-1.5 text-xs hover:bg-gray-50 text-left">
                  TXT
                </button>
              </div>
            </div>
            <button
              onClick={convert}
              className="px-4 py-1.5 text-xs rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 shadow-md shadow-emerald-200/50"
            >
              送去转剧本 →
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-2 mt-3 flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* 主体三栏 */}
        <div className="flex flex-1 min-h-0 mt-3 gap-3">
          {/* 左栏：树/人物/世界观 */}
          <div className="w-60 shrink-0 bg-white rounded-xl border flex flex-col min-h-0">
            <div className="flex border-b">
              {(
                [
                  ['chapters', '章节'],
                  ['characters', `人物${novel.characters.length ? `(${novel.characters.length})` : ''}`],
                  ['world', `世界观${novel.worldItems.length ? `(${novel.worldItems.length})` : ''}`],
                ] as Array<[Tab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    tab === key ? 'text-indigo-600 border-b-2 border-indigo-500 bg-indigo-50/50' : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-2 min-h-0">
              {tab === 'chapters' && (
                <div className="space-y-1">
                  <button
                    onClick={() => addChapter(null)}
                    className="w-full py-1.5 text-xs rounded-lg border border-dashed border-indigo-300 text-indigo-500 hover:bg-indigo-50"
                  >
                    + 未分卷章节
                  </button>
                  <button
                    onClick={addVolume}
                    className="w-full py-1.5 text-xs rounded-lg border border-dashed border-slate-300 text-gray-500 hover:bg-gray-50"
                  >
                    + 新建分卷
                  </button>
                  {novel.volumes
                    .sort((a, b) => a.order - b.order)
                    .map((vol) => {
                      const isCollapsed = collapsed.has(vol.id);
                      return (
                        <div key={vol.id} className="pt-1">
                          <div className="flex items-center gap-1 group">
                            <button
                              onClick={() =>
                                setCollapsed((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(vol.id)) next.delete(vol.id);
                                  else next.add(vol.id);
                                  return next;
                                })
                              }
                              className="text-gray-400 hover:text-gray-600 text-xs w-4"
                            >
                              {isCollapsed ? '▸' : '▾'}
                            </button>
                            <input
                              defaultValue={vol.title}
                              onBlur={(e) => {
                                if (e.target.value !== vol.title) renameVolume(vol.id, e.target.value || vol.title);
                              }}
                              className="flex-1 text-xs font-medium bg-transparent focus:outline-none rounded px-1 py-0.5"
                            />
                            <button
                              onClick={() => addChapter(vol.id)}
                              className="text-gray-300 hover:text-indigo-500 text-xs opacity-0 group-hover:opacity-100"
                              title="在本卷新建章节"
                            >
                              +
                            </button>
                          </div>
                          {!isCollapsed && (
                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-100 pl-2">
                              {volumeChapters(vol.id).map((ch) => (
                                <ChapterItem
                                  key={ch.id}
                                  chapter={ch}
                                  active={selectedId === ch.id}
                                  onSelect={() => selectChapter(ch.id)}
                                  onDelete={() => deleteChapter(ch.id)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  <div className="ml-3 mt-1 space-y-0.5">
                    {volumeChapters(null).map((ch) => (
                      <ChapterItem
                        key={ch.id}
                        chapter={ch}
                        active={selectedId === ch.id}
                        onSelect={() => selectChapter(ch.id)}
                        onDelete={() => deleteChapter(ch.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {tab === 'characters' && (
                <div className="space-y-2">
                  <button
                    onClick={() => {
                      setEditingCharacter(null);
                      setForm({});
                      setShowCharacterForm(true);
                    }}
                    className="w-full py-1.5 text-xs rounded-lg border border-dashed border-indigo-300 text-indigo-500 hover:bg-indigo-50"
                  >
                    + 新增人物卡
                  </button>
                  {novel.characters.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => {
                        setEditingCharacter(c);
                        setForm({ name: c.name, role: c.role, traits: c.traits, background: c.background, notes: c.notes });
                        setShowCharacterForm(true);
                      }}
                      className="p-2 rounded-lg border hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{c.name}</span>
                        <span className="text-[10px] text-gray-400">{c.role || '未定'}</span>
                      </div>
                      {c.traits && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{c.traits}</p>}
                    </div>
                  ))}
                  {novel.characters.length === 0 && (
                    <p className="text-xs text-gray-300 text-center py-4">还没有人物卡</p>
                  )}
                </div>
              )}

              {tab === 'world' && (
                <div className="space-y-2">
                  <button
                    onClick={() => {
                      setEditingWorld(null);
                      setForm({});
                      setShowWorldForm(true);
                    }}
                    className="w-full py-1.5 text-xs rounded-lg border border-dashed border-indigo-300 text-indigo-500 hover:bg-indigo-50"
                  >
                    + 新增词条
                  </button>
                  {novel.worldItems.map((w) => (
                    <div
                      key={w.id}
                      onClick={() => {
                        setEditingWorld(w);
                        setForm({ name: w.name, category: w.category, description: w.description });
                        setShowWorldForm(true);
                      }}
                      className="p-2 rounded-lg border hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{w.name}</span>
                        <span className="text-[10px] text-gray-400">{w.category || '未分类'}</span>
                      </div>
                      {w.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{w.description}</p>}
                    </div>
                  ))}
                  {novel.worldItems.length === 0 && (
                    <p className="text-xs text-gray-300 text-center py-4">还没有世界观词条</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 中栏：编辑器 */}
          <div className="flex-1 min-w-0 bg-white rounded-xl border flex flex-col min-h-0">
            {selectedChapter ? (
              <>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b">
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="flex-1 font-medium text-sm bg-transparent focus:outline-none rounded px-1"
                    placeholder="章节标题"
                  />
                  <span className="text-xs text-gray-400">{draftContent.replace(/\s/g, '').length} 字</span>
                  <button
                    onClick={saveChapter}
                    disabled={saving}
                    className="px-4 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {saving ? '保存中...' : '保存章节'}
                  </button>
                </div>
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  placeholder="在此输入章节正文……"
                  className="flex-1 w-full p-4 text-sm leading-7 focus:outline-none resize-none min-h-0"
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-300 text-sm">
                从左侧选择章节开始写作
              </div>
            )}
          </div>

          {/* 右栏：AI 助手 */}
          <div className="w-72 shrink-0 bg-white rounded-xl border flex flex-col min-h-0">
            <div className="px-4 py-2.5 border-b font-medium text-sm flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              AI 写作助手
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
              <div className="grid grid-cols-4 gap-1">
                {(Object.keys(AI_ACTION_LABEL) as AiAction[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => {
                      setAiAction(a);
                      setAiResult(null);
                    }}
                    className={`py-1.5 text-xs rounded-lg border transition-colors ${
                      aiAction === a
                        ? 'bg-cyan-500 text-white border-cyan-500'
                        : 'text-gray-500 hover:border-cyan-300'
                    }`}
                  >
                    {AI_ACTION_LABEL[a]}
                  </button>
                ))}
              </div>

              <input
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                placeholder={
                  aiAction === 'rewrite'
                    ? '改写风格要求，如：改为轻松幽默的文风'
                    : aiAction === 'continue'
                      ? '续写方向，如：主角发现真相'
                      : '可选补充要求'
                }
                className="w-full px-3 py-2 border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-cyan-300"
              />

              <button
                onClick={runAi}
                disabled={aiLoading || !selectedChapter}
                className="w-full py-2 text-xs rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40"
              >
                {aiLoading ? 'AI 生成中...' : `开始${AI_ACTION_LABEL[aiAction]}`}
              </button>

              {aiError && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{aiError}</p>}

              {aiResult && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-gray-50 px-3 py-1.5 border-b">
                    <span className="text-[10px] text-gray-400">生成结果</span>
                    <button
                      onClick={applyAi}
                      className="text-[10px] text-cyan-600 hover:text-cyan-800 font-medium"
                    >
                      {aiAction === 'continue' ? '追加到正文' : '替换正文'}
                    </button>
                  </div>
                  <div className="p-3 text-xs leading-6 max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {aiResult}
                  </div>
                </div>
              )}

              {!selectedChapter && (
                <p className="text-xs text-gray-300 text-center pt-4">选择章节后可用 AI 续写/扩写/改写/润色</p>
              )}
            </div>
          </div>
        </div>

        {/* 人物卡/世界观编辑弹窗 */}
        {showCharacterForm && (
          <Modal
            title={editingCharacter ? '编辑人物卡' : '新增人物卡'}
            onClose={() => {
              setShowCharacterForm(false);
              setEditingCharacter(null);
            }}
            onSubmit={submitCharacter}
            submitLabel="保存"
          >
            <FormField label="姓名 *" value={form.name ?? ''} onChange={(v) => setForm({ ...form, name: v })} />
            <FormField label="角色定位" value={form.role ?? ''} onChange={(v) => setForm({ ...form, role: v })} placeholder="主角 / 反派 / 配角" />
            <FormField label="性格特质" value={form.traits ?? ''} onChange={(v) => setForm({ ...form, traits: v })} textarea />
            <FormField label="背景设定" value={form.background ?? ''} onChange={(v) => setForm({ ...form, background: v })} textarea />
            <FormField label="备注" value={form.notes ?? ''} onChange={(v) => setForm({ ...form, notes: v })} textarea />
          </Modal>
        )}

        {showWorldForm && (
          <Modal
            title={editingWorld ? '编辑词条' : '新增世界观词条'}
            onClose={() => {
              setShowWorldForm(false);
              setEditingWorld(null);
            }}
            onSubmit={submitWorld}
            submitLabel="保存"
          >
            <FormField label="词条名 *" value={form.name ?? ''} onChange={(v) => setForm({ ...form, name: v })} />
            <FormField label="分类" value={form.category ?? ''} onChange={(v) => setForm({ ...form, category: v })} placeholder="地理 / 势力 / 设定 / 物品" />
            <FormField label="描述" value={form.description ?? ''} onChange={(v) => setForm({ ...form, description: v })} textarea />
          </Modal>
        )}

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm px-5 py-2.5 rounded-xl shadow-2xl z-50 animate-pulse">
            {toast}
          </div>
        )}
      </div>
    </RequireAuth>
  );
}

function ChapterItem({
  chapter,
  active,
  onSelect,
  onDelete,
}: {
  chapter: NovelChapter;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer text-xs transition-colors ${
        active ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      <span className="flex-1 truncate">{chapter.title}</span>
      {chapter.wordCount > 0 && (
        <span className={`text-[9px] ${active ? 'text-indigo-200' : 'text-gray-300'}`}>{chapter.wordCount}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={`opacity-0 group-hover:opacity-100 text-[10px] ${active ? 'text-indigo-200 hover:text-white' : 'text-gray-300 hover:text-red-500'}`}
      >
        ✕
      </button>
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        <div className="space-y-3">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 border rounded-lg hover:bg-gray-50">
            取消
          </button>
          <button onClick={onSubmit} className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  const cls =
    'w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300';
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={`${cls} resize-none`} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
    </div>
  );
}
