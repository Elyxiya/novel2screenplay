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
  // 移动端侧栏/助手抽屉开关
  const [mobilePanel, setMobilePanel] = useState<'none' | 'sidebar' | 'ai'>('none');

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

  // 拖拽状态：当前正在拖拽的章节 id
  const [draggingChapterId, setDraggingChapterId] = useState<string | null>(null);
  // dropTarget 细分为 5 种：
  // - volume: 某卷末尾（拖到卷头）
  // - unassigned: 未分卷末尾
  // - chapter-before / chapter-after: 某章节之前/之后
  // 渲染层按此类型精准显示 before/after 指示条或卷高亮
  const [dropTarget, setDropTarget] = useState<
    | null
    | { type: 'volume'; volumeId: string }
    | { type: 'unassigned' }
    | { type: 'chapter-before' | 'chapter-after'; chapterId: string }
  >(null);

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

  /**
   * 移动章节（统一按"快照→splice→重新编号"执行）
   *
   * 参数契约（from Experience 347975 成功经验：from/to 必须基于同一份操作前快照）：
   *  - targetVolumeId  : 目标卷，null 代表"未分卷"
   *  - anchorChapterId : 可选，锚点章节
   *  - position        : 'before'（插到锚点之前）| 'after'（之后）| 'end'（卷末尾）
   */
  const moveChapter = async (
    chapterId: string,
    targetVolumeId: string | null,
    anchorChapterId: string | undefined,
    position: 'before' | 'after' | 'end',
  ) => {
    if (!novel) return;
    const moving = novel.chapters.find((c) => c.id === chapterId);
    if (!moving) return;

    // 先在本地快照上排序：按 volumeId 分组、每组内按 order 升序
    const snap = novel.chapters.slice();
    const snapVolumeIds = Array.from(new Set(snap.map((c) => String(c.volumeId))));
    const group = (volId: string | null) =>
      snap.filter((c) => String(c.volumeId) === String(volId)).sort((a, b) => a.order - b.order);

    const srcGroup = group(moving.volumeId);
    const dstGroup = group(targetVolumeId);

    // 1) 找到从原组中移除的 index
    const fromIndex = srcGroup.findIndex((c) => c.id === chapterId);
    if (fromIndex < 0) return;

    // 2) 计算插入目标 dstGroup 的 index
    let toIndex = dstGroup.length;
    if (position === 'end') {
      // 目标卷末尾
      toIndex = moving.volumeId === targetVolumeId ? Math.max(0, dstGroup.length - 1) : dstGroup.length;
    } else if (anchorChapterId) {
      const anchorIdxInDst = dstGroup.findIndex((c) => c.id === anchorChapterId);
      if (anchorIdxInDst < 0) return;
      toIndex = position === 'before' ? anchorIdxInDst : anchorIdxInDst + 1;
    }
    // 同组 splice 修正：先 remove 后再 insert 时，如果 toIndex 位于已移除元素之后，要减 1
    if (moving.volumeId === targetVolumeId && toIndex > fromIndex) {
      toIndex -= 1;
    }
    // 同组 after 自身：相当于没动
    if (moving.volumeId === targetVolumeId && fromIndex === toIndex) return;

    // 3) 从 srcGroup 拿出 moving，放到 dstGroup 的 toIndex
    const newSrc = srcGroup.slice();
    const [moved] = newSrc.splice(fromIndex, 1);
    const newDst =
      moving.volumeId === targetVolumeId ? newSrc : dstGroup.slice();
    newDst.splice(toIndex, 0, moved);

    // 4) 应用到 chapters：先把"原组+新组"以外的 chapters 保留，然后把新组替换进去，并重编号
    const touched = new Set<string | null>([moving.volumeId, targetVolumeId]);
    const untouched = snap.filter((c) => !touched.has(c.volumeId));
    // 重编号：untouched 保持 order 不动（分组内 order 自洽）
    // 对 touched 两个分组的新集合重新填 0..N-1 的连续 order
    const applied: NovelChapter[] = untouched.concat(
      newSrc.map((c, i) => ({ ...c, volumeId: moving.volumeId, order: i })),
    );
    // 注意：当 src==dst 时 newDst 就是最新的 newSrc，避免重复拼接
    if (moving.volumeId !== targetVolumeId) {
      for (const c of newDst) {
        // 已经移到 dst 了，先从 applied 里去掉旧版本（如果有）
      }
      // 拼接新 dst 组
      for (let i = 0; i < newDst.length; i++) {
        applied.push({ ...newDst[i], volumeId: targetVolumeId, order: i });
      }
    } else {
      // src === dst 情况下，newSrc 已经被 splice 过一次了，上面 applied 拼的是 newSrc+order 重编号，
      // 但要注意 applied 里不应重复包含 newDst（同一份 newSrc）；上面的 applied 已经是"新 newSrc 组 + untouched"
      // 直接跳过第二次拼接
    }

    // 防止重复：把 applied 里 chapterId 重复的项只保留最后一条（即我们刚写入的那条）
    const idMap = new Map<string, NovelChapter>();
    for (const c of applied) idMap.set(c.id, c);
    const finalChapters = Array.from(idMap.values());

    const optimistic: DraftNovel = { ...novel, chapters: finalChapters };
    setNovel(optimistic);
    setDraggingChapterId(null);
    setDropTarget(null);
    showToast('正在移动章节…');

    // 5) 持久化：按 touched volumeIds 的所有章节按新顺序串行 upsert，DB 端覆盖 order/volumeId
    try {
      const persistIds = new Set(
        finalChapters.filter((c) => touched.has(c.volumeId)).map((c) => c.id),
      );
      for (const c of finalChapters) {
        if (!persistIds.has(c.id)) continue;
        const res = await fetch(`/api/writer/novels/${novelId}/chapter`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...c, updatedAt: nowTs() }),
        });
        if (!res.ok) throw new Error('移动失败');
      }
      showToast('章节已移动');
    } catch (e) {
      setNovel(novel);
      setError((e as Error).message);
    }
  };

  /** 直接重命名章节（失焦/Enter 触发），落库 saveChapter */
  const renameChapter = async (id: string, title: string) => {
    if (!novel) return;
    const ch = novel.chapters.find((c) => c.id === id);
    if (!ch || ch.title === title) return;
    const payload: NovelChapter = { ...ch, title: title || '未命名章节', updatedAt: nowTs() };
    const res = await fetch(`/api/writer/novels/${novelId}/chapter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    setNovel((prev) =>
      prev ? { ...prev, chapters: prev.chapters.map((c) => (c.id === id ? payload : c)) } : prev,
    );
    if (selectedId === id) setDraftTitle(payload.title);
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
        <div className="max-w-5xl mx-auto glass-card p-16 text-center text-slate-400 text-sm">加载中...</div>
      </RequireAuth>
    );
  }

  if (!novel) {
    return (
      <RequireAuth>
        <div className="max-w-5xl mx-auto glass-card p-16 text-center">
          <p className="text-slate-500 mb-4">{error ?? '创作小说不存在'}</p>
          <button onClick={() => router.push('/writer')} className="glow-btn">
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
      {/* 全屏宽度三栏创作台：外层去掉 max-width，让编辑器在宽屏下可用。
          保留两侧 24px 安全边距，避免内容贴边。 */}
      <div className="w-full h-[calc(100vh-61px)] flex flex-col px-4 sm:px-6 py-3 gap-3">
        {/* 顶部工具条 */}
        <div className="flex items-center gap-3 flex-wrap glass-card px-4 py-2.5 shrink-0">
          <button
            onClick={() => router.push('/writer')}
            className="text-slate-400 hover:text-slate-600 text-sm flex items-center gap-1 transition-colors"
          >
            ← 创作台
          </button>
          <div className="h-4 w-px bg-slate-300/70" />
          <input
            value={metaDraft.title}
            onChange={(e) => setMetaDraft({ ...metaDraft, title: e.target.value })}
            className="text-base font-semibold bg-transparent focus:outline-none focus:ring-1 focus:ring-cyan-300 rounded px-1.5 py-0.5 w-48"
            placeholder="作品标题"
          />
          <input
            value={metaDraft.author}
            onChange={(e) => setMetaDraft({ ...metaDraft, author: e.target.value })}
            className="text-xs text-slate-400 bg-transparent focus:outline-none focus:ring-1 focus:ring-cyan-300 rounded px-1.5 py-0.5 w-24"
            placeholder="作者"
          />
          <button
            onClick={saveMeta}
            className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg hover:bg-white/70 text-slate-500 transition-colors"
          >
            保存信息
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-400">
              {novel.chapters.length} 章 · {novel.chapters.reduce((s, c) => s + c.wordCount, 0).toLocaleString()} 字
            </span>
            <div className="relative group">
              <button className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-white/70 text-slate-600 transition-colors">
                导出 ▾
              </button>
              <div className="absolute right-0 top-full mt-1 glass-card py-1 w-28 hidden group-hover:block z-20 shadow-xl">
                <button onClick={() => exportFile('md')} className="block w-full px-3 py-1.5 text-xs hover:bg-white/70 text-left text-slate-600">
                  Markdown
                </button>
                <button onClick={() => exportFile('txt')} className="block w-full px-3 py-1.5 text-xs hover:bg-white/70 text-left text-slate-600">
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
          <div className="bg-red-50/80 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-2 mt-3 flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* 主体三栏：左栏 280px（目录/人物/世界观）、中栏 flex-1（编辑器，主区域）、右栏 340px（AI 助手）。
             用 gap-4 分隔三栏，不再受 max-w 限制。 */}
        <div className="relative flex flex-1 min-h-0 gap-4">
          {/* 左栏：树/人物/世界观（移动端抽屉覆盖） */}
          <div className={`${mobilePanel === 'sidebar' ? 'flex' : 'hidden'} lg:flex absolute inset-y-0 left-0 z-20 w-72 lg:static lg:w-[280px] shrink-0 glass-card flex-col min-h-0 overflow-hidden shadow-2xl lg:shadow-none`}>
            <div className="flex border-b border-slate-200/70">
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
                    tab === key ? 'text-indigo-600 border-b-2 border-indigo-500 bg-indigo-50/50' : 'text-slate-400 hover:text-slate-600'
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
                    className="w-full py-1.5 text-xs rounded-lg border border-dashed border-slate-300 text-slate-500 hover:bg-white/70"
                  >
                    + 新建分卷
                  </button>
                  {novel.volumes
                    .sort((a, b) => a.order - b.order)
                    .map((vol) => {
                      const isCollapsed = collapsed.has(vol.id);
                      const isTargetVol =
                        dropTarget?.type === 'volume' && dropTarget.volumeId === vol.id;
                      return (
                        <div key={vol.id} className="pt-1">
                          {/* 卷头整行作为可投放区：拖拽章节拖到卷名上 → 放到卷末尾 */}
                          <div
                            className={`flex items-center gap-1 group rounded-md px-1 -mx-1 transition-colors ${
                              isTargetVol
                                ? 'ring-2 ring-indigo-400 bg-indigo-50/70 ring-offset-1'
                                : draggingChapterId
                                  ? 'hover:bg-indigo-50/50'
                                  : ''
                            }`}
                            onDragOver={(e) => {
                              if (!draggingChapterId) return;
                              e.preventDefault();
                              e.stopPropagation();
                              setDropTarget((prev) =>
                                prev?.type === 'volume' && prev.volumeId === vol.id
                                  ? prev
                                  : { type: 'volume', volumeId: vol.id },
                              );
                            }}
                            onDrop={(e) => {
                              if (!draggingChapterId) return;
                              // 如果内层章节行已经 preventDefault 处理过这次 drop，外层不要重复追加（Bug 3）
                              if (e.defaultPrevented) return;
                              e.preventDefault();
                              e.stopPropagation();
                              void moveChapter(draggingChapterId, vol.id, undefined, 'end');
                            }}
                          >
                            <button
                              onClick={() =>
                                setCollapsed((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(vol.id)) next.delete(vol.id);
                                  else next.add(vol.id);
                                  return next;
                                })
                              }
                              className="text-slate-400 hover:text-slate-600 text-xs w-4"
                            >
                              {isCollapsed ? '▸' : '▾'}
                            </button>
                            <input
                              defaultValue={vol.title}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              onBlur={(e) => {
                                if (e.target.value !== vol.title) renameVolume(vol.id, e.target.value || vol.title);
                              }}
                              className="flex-1 text-xs font-medium bg-transparent focus:outline-none rounded px-1 py-0.5"
                            />
                            <button
                              onClick={() => addChapter(vol.id)}
                              className="text-slate-300 hover:text-indigo-500 text-xs opacity-0 group-hover:opacity-100"
                              title="在本卷新建章节"
                            >
                              +
                            </button>
                          </div>
                          {/* 折叠时也接受投放（通过卷头 drop），展开时列出章节并允许章节间投放 */}
                          {!isCollapsed && (
                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-slate-200/70 pl-2">
                              {volumeChapters(vol.id).length === 0 && draggingChapterId && (
                                <div
                                  className="text-[10px] text-indigo-400 italic py-1 text-center border border-dashed rounded border-indigo-300/70"
                                  onDragOver={(e) => { e.preventDefault(); setDropTarget({ type: 'volume', volumeId: vol.id }); }}
                                  onDrop={(e) => {
                                    if (e.defaultPrevented) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (draggingChapterId) void moveChapter(draggingChapterId, vol.id, undefined, 'end');
                                  }}
                                >
                                  将章节拖到这里
                                </div>
                              )}
                              {volumeChapters(vol.id).map((ch) => (
                                <ChapterItem
                                  key={ch.id}
                                  chapter={ch}
                                  active={selectedId === ch.id}
                                  dragging={draggingChapterId === ch.id}
                                  dropBefore={dropTarget?.type === 'chapter-before' && dropTarget.chapterId === ch.id}
                                  dropAfter={dropTarget?.type === 'chapter-after' && dropTarget.chapterId === ch.id}
                                  onSelect={() => selectChapter(ch.id)}
                                  onDelete={() => deleteChapter(ch.id)}
                                  onRename={(title) => renameChapter(ch.id, title)}
                                  onDragStart={() => setDraggingChapterId(ch.id)}
                                  onDragEnd={() => {
                                    setDraggingChapterId(null);
                                    setDropTarget(null);
                                  }}
                                  onSetDropTarget={(pos) => {
                                    if (!draggingChapterId || draggingChapterId === ch.id) return;
                                    setDropTarget({
                                      type: pos === 'before' ? 'chapter-before' : 'chapter-after',
                                      chapterId: ch.id,
                                    });
                                  }}
                                  onDrop={(pos) => {
                                    if (!draggingChapterId || draggingChapterId === ch.id) return;
                                    void moveChapter(draggingChapterId, ch.volumeId, ch.id, pos);
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  {/* 未分卷章节区 */}
                  <div
                    className={`ml-3 mt-1 space-y-0.5 rounded-md transition-colors ${
                      dropTarget?.type === 'unassigned'
                        ? 'ring-2 ring-indigo-400 bg-indigo-50/50 p-1 -mx-1'
                        : draggingChapterId
                          ? 'hover:bg-indigo-50/40'
                          : ''
                    }`}
                    onDragOver={(e) => {
                      if (!draggingChapterId) return;
                      e.preventDefault();
                      setDropTarget((prev) =>
                        prev?.type === 'unassigned' ? prev : { type: 'unassigned' },
                      );
                    }}
                    onDrop={(e) => {
                      if (!draggingChapterId) return;
                      if (e.defaultPrevented) return;
                      e.preventDefault();
                      e.stopPropagation();
                      void moveChapter(draggingChapterId, null, undefined, 'end');
                    }}
                  >
                    {volumeChapters(null).length === 0 && draggingChapterId && (
                      <div className="text-[10px] text-indigo-400 italic py-1 text-center border border-dashed rounded border-indigo-300/70">
                        将章节拖到这里 → 放入未分卷
                      </div>
                    )}
                    {volumeChapters(null).map((ch) => (
                      <ChapterItem
                        key={ch.id}
                        chapter={ch}
                        active={selectedId === ch.id}
                        dragging={draggingChapterId === ch.id}
                        dropBefore={dropTarget?.type === 'chapter-before' && dropTarget.chapterId === ch.id}
                        dropAfter={dropTarget?.type === 'chapter-after' && dropTarget.chapterId === ch.id}
                        onSelect={() => selectChapter(ch.id)}
                        onDelete={() => deleteChapter(ch.id)}
                        onRename={(title) => renameChapter(ch.id, title)}
                        onDragStart={() => setDraggingChapterId(ch.id)}
                        onDragEnd={() => {
                          setDraggingChapterId(null);
                          setDropTarget(null);
                        }}
                        onSetDropTarget={(pos) => {
                          if (!draggingChapterId || draggingChapterId === ch.id) return;
                          setDropTarget({
                            type: pos === 'before' ? 'chapter-before' : 'chapter-after',
                            chapterId: ch.id,
                          });
                        }}
                        onDrop={(pos) => {
                          if (!draggingChapterId || draggingChapterId === ch.id) return;
                          void moveChapter(draggingChapterId, ch.volumeId, ch.id, pos);
                        }}
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
                      className="p-2 rounded-lg border border-slate-200/70 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer group transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">{c.name}</span>
                        <span className="text-[10px] text-slate-400">{c.role || '未定'}</span>
                      </div>
                      {c.traits && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{c.traits}</p>}
                    </div>
                  ))}
                  {novel.characters.length === 0 && (
                    <p className="text-xs text-slate-300 text-center py-4">还没有人物卡</p>
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
                      className="p-2 rounded-lg border border-slate-200/70 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer group transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">{w.name}</span>
                        <span className="text-[10px] text-slate-400">{w.category || '未分类'}</span>
                      </div>
                      {w.description && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{w.description}</p>}
                    </div>
                  ))}
                  {novel.worldItems.length === 0 && (
                    <p className="text-xs text-slate-300 text-center py-4">还没有世界观词条</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 中栏：编辑器 */}
          <div className="flex-1 min-w-0 glass-card flex flex-col min-h-0 overflow-hidden">
            {selectedChapter ? (
              <>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200/70">
                  <input
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="flex-1 font-medium text-sm bg-transparent focus:outline-none rounded px-1 text-slate-700"
                    placeholder="章节标题"
                  />
                  <span className="text-xs text-slate-400">{draftContent.replace(/\s/g, '').length} 字</span>
                  <button
                    onClick={saveChapter}
                    disabled={saving}
                    className="px-4 py-1.5 text-xs rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-500 text-white hover:opacity-90 shadow-md shadow-indigo-200/50 disabled:opacity-40 transition-all"
                  >
                    {saving ? '保存中...' : '保存章节'}
                  </button>
                </div>
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  placeholder="在此输入章节正文……"
                  className="flex-1 w-full p-4 text-sm leading-7 focus:outline-none resize-none min-h-0 bg-transparent text-slate-700 placeholder:text-slate-400"
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-300 text-sm">
                从左侧选择章节开始写作
              </div>
            )}
          </div>

          {/* 右栏：AI 助手（移动端抽屉覆盖）—— 桌面端加宽到 340px，输入指令更舒适 */}
          <div className={`${mobilePanel === 'ai' ? 'flex' : 'hidden'} lg:flex absolute inset-y-0 right-0 z-20 w-72 lg:static lg:w-[340px] shrink-0 glass-card flex-col min-h-0 overflow-hidden shadow-2xl lg:shadow-none`}>
            <div className="px-4 py-2.5 border-b border-slate-200/70 font-medium text-sm flex items-center gap-2">
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
                        ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white border-transparent shadow-md shadow-cyan-200/50'
                        : 'text-slate-500 hover:border-cyan-300 border-slate-300/70 hover:bg-white/70'
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
                className="w-full px-3 py-2 border border-slate-300/70 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-cyan-300/40 bg-white/60 text-slate-600 placeholder:text-slate-400"
              />

              <button
                onClick={runAi}
                disabled={aiLoading || !selectedChapter}
                className="glow-btn w-full !py-2 text-xs"
              >
                {aiLoading ? 'AI 生成中...' : `开始${AI_ACTION_LABEL[aiAction]}`}
              </button>

              {aiError && <p className="text-xs text-red-500 bg-red-50/80 border border-red-100 rounded-lg px-3 py-2">{aiError}</p>}

              {aiResult && (
                <div className="border border-slate-200/70 rounded-lg overflow-hidden bg-white/60">
                  <div className="flex items-center justify-between bg-slate-50/80 px-3 py-1.5 border-b border-slate-200/70">
                    <span className="text-[10px] text-slate-400">生成结果</span>
                    <button
                      onClick={applyAi}
                      className="text-[10px] text-cyan-600 hover:text-cyan-800 font-medium"
                    >
                      {aiAction === 'continue' ? '追加到正文' : '替换正文'}
                    </button>
                  </div>
                  <div className="p-3 text-xs leading-6 max-h-64 overflow-y-auto whitespace-pre-wrap text-slate-600">
                    {aiResult}
                  </div>
                </div>
              )}

              {!selectedChapter && (
                <p className="text-xs text-slate-300 text-center pt-4">选择章节后可用 AI 续写/扩写/改写/润色</p>
              )}
            </div>
          </div>
        </div>

        {/* 移动端抽屉遮罩 */}
        {mobilePanel !== 'none' && (
          <div
            className="fixed inset-0 z-10 bg-slate-900/30 backdrop-blur-[2px] md:hidden"
            onClick={() => setMobilePanel('none')}
          />
        )}

        {/* 移动端底部工具栏 */}
        <div className="fixed bottom-4 inset-x-4 z-30 md:hidden">
          <div className="glass-card rounded-2xl shadow-2xl px-3 py-2 flex items-center gap-2">
            <button
              onClick={() => setMobilePanel(mobilePanel === 'sidebar' ? 'none' : 'sidebar')}
              className={`flex-1 py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 border transition-all duration-300 ${
                mobilePanel === 'sidebar'
                  ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white border-transparent shadow-md shadow-indigo-300/40'
                  : 'border-slate-300 bg-white/60 text-slate-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h7" />
              </svg>
              目录
            </button>
            <button
              onClick={() => setMobilePanel(mobilePanel === 'ai' ? 'none' : 'ai')}
              className={`flex-1 py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 border transition-all duration-300 ${
                mobilePanel === 'ai'
                  ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white border-transparent shadow-md shadow-indigo-300/40'
                  : 'border-slate-300 bg-white/60 text-slate-600'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              AI 助手
            </button>
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
  dragging,
  dropBefore,
  dropAfter,
  onSelect,
  onDelete,
  onRename,
  onDragStart,
  onDragEnd,
  onSetDropTarget,
  onDrop,
}: {
  chapter: NovelChapter;
  active: boolean;
  dragging?: boolean;
  dropBefore?: boolean;
  dropAfter?: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onSetDropTarget: (pos: 'before' | 'after') => void;
  onDrop: (pos: 'before' | 'after') => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chapter.title);
  const [prevTitle, setPrevTitle] = useState(chapter.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // 外部重命名/重排后同步草稿：渲染期调整 state，避免 effect 内 setState 级联渲染
  if (prevTitle !== chapter.title) {
    setPrevTitle(chapter.title);
    setDraft(chapter.title);
  }
  useEffect(() => {
    if (editing) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [editing]);

  const commit = () => {
    if (!editing) return;
    setEditing(false);
    if (draft !== chapter.title) onRename(draft);
  };

  return (
    <div className="flex flex-col">
      {dropBefore && (
        <div className="h-0.5 bg-indigo-500 rounded-full mx-2 my-0.5 shadow-[0_0_0_2px_rgba(99,102,241,0.25)]" aria-hidden />
      )}
      <div
        ref={rowRef}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', chapter.id); } catch { /* ignore */ }
          onDragStart();
        }}
        onDragEnd={(e) => {
          e.stopPropagation();
          onDragEnd();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!rowRef.current) return;
          // 按"章节行在鼠标的上半 or 下半"区分 before/after
          const rect = rowRef.current.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          const pos: 'before' | 'after' = e.clientY < mid ? 'before' : 'after';
          onSetDropTarget(pos);
        }}
        onDragLeave={(e) => {
          // 当鼠标真的离开这一行（而不是进入子元素）时，父组件的 onSetDropTarget 会被下一个 dragover 覆盖，
          // 这里仅在真的离开章节行时清除自己贡献的 dropTarget
          const cur = rowRef.current;
          if (!cur) return;
          const r = cur.getBoundingClientRect();
          const { clientX: x, clientY: y } = e;
          if (x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) {
            // 不直接清空 state，避免抖动；交给下一个章节 onDragOver 覆盖即可
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const row = rowRef.current;
          const pos: 'before' | 'after' = (() => {
            if (!row) return 'after';
            const r = row.getBoundingClientRect();
            return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
          })();
          onDrop(pos);
        }}
        onClick={(e) => {
          if (editing) return;
          e.stopPropagation();
          onSelect();
        }}
        onDoubleClick={() => {
          if (!editing) setEditing(true);
        }}
        title={dragging ? '拖动移动章节；拖到章节上半=插之前，下半=插之后；双击可重命名' : '双击章节名可重命名；按住可拖拽到其他卷/章节'}
        className={`group relative flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer text-xs transition-all select-none ${
          active
            ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-sm'
            : 'text-slate-600 hover:bg-white/70'
        } ${dragging ? 'opacity-40 scale-[0.98]' : ''} ${dropBefore || dropAfter ? 'mt-0.5' : ''}`}
      >
        {/* 拖拽把手（仅 hover 显示） */}
        <span className="text-slate-300/0 group-hover:text-slate-400/70 transition-colors select-none cursor-grab">
          ⋮⋮
        </span>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(chapter.title);
                setEditing(false);
              }
            }}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className={`flex-1 min-w-0 text-xs rounded px-1 py-0.5 outline-none ${
              active ? 'bg-white/20 text-white placeholder-indigo-200' : 'bg-white text-slate-700 ring-1 ring-indigo-300'
            }`}
            placeholder="章节名"
          />
        ) : (
          <span className="flex-1 truncate">{chapter.title}</span>
        )}
        {chapter.wordCount > 0 && !editing && (
          <span className={`text-[9px] ${active ? 'text-indigo-200' : 'text-slate-300'}`}>{chapter.wordCount}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!editing) {
              setEditing(true);
            }
          }}
          className={`opacity-0 group-hover:opacity-100 text-[10px] ${active ? 'text-indigo-200 hover:text-white' : 'text-slate-300 hover:text-indigo-500'}`}
          title="重命名章节"
        >
          ✎
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className={`opacity-0 group-hover:opacity-100 text-[10px] ${active ? 'text-indigo-200 hover:text-white' : 'text-slate-300 hover:text-red-500'}`}
          title="删除章节"
        >
          ✕
        </button>
      </div>
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
      <div className="glass-card w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4 text-slate-800">{title}</h3>
        <div className="space-y-3">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500 border border-slate-300 rounded-lg hover:bg-white/70 transition-colors">
            取消
          </button>
          <button onClick={onSubmit} className="px-4 py-2 text-sm text-white bg-gradient-to-r from-indigo-600 to-cyan-500 rounded-lg hover:opacity-90 shadow-md shadow-indigo-200/50 transition-all">
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
    'w-full px-3 py-2 border border-slate-300/70 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300/40 bg-white/60 text-slate-700 placeholder:text-slate-400';
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className={`${cls} resize-none`} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
    </div>
  );
}
