'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Chapter {
  index: number;
  title: string;
  paragraphCount: number;
  text: string;
}

export default function ConfigurePage() {
  const router = useRouter();
  const initialized = useRef(false);
  const [data, setData] = useState<{ novelText: string; title: string; chapters: Chapter[] } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [model, setModel] = useState('deepseek-chat');
  const [models, setModels] = useState<string[]>(['deepseek-chat', 'gpt-4o']);
  const [cost, setCost] = useState('');
  const [costLoading, setCostLoading] = useState(false);
  const costTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCost = useCallback((chars: number) => {
    if (costTimerRef.current) clearTimeout(costTimerRef.current);
    setCostLoading(true);
    costTimerRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/cost-estimate?chars=${chars}`);
        const d = await r.json();
        setCost(`约 ¥${d.estimatedCostCNY}，${d.estimatedTokens?.toLocaleString()} tokens`);
      } catch {
        setCost('计算失败');
      } finally {
        setCostLoading(false);
      }
    }, 500);
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const raw = sessionStorage.getItem('novelData');
    if (!raw) { router.push('/'); return; }
    try {
      const d = JSON.parse(raw);
      setData(d);

      const chapters: Chapter[] = d.chapters ?? [];
      const allIndices = new Set(chapters.map((_: unknown, i: number) => i));
      setSelected(allIndices);

      fetchModels(d, setModels);
      fetchCost(d.novelText.length);
    } catch {
      router.push('/');
    }

    return () => {
      if (costTimerRef.current) clearTimeout(costTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [router, fetchCost]);

  const fetchModels = (_d: { novelText: string; title: string; chapters: Chapter[] }, setter: (m: string[]) => void) => {
    fetch('/api/models').then(r => r.json()).then(r => {
      if (r.models?.length) setter(r.models.map((m: { id: string }) => m.id));
    }).catch(() => {});
  };

  const toggleChapter = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelected(next);
    if (data) fetchCost(selectedTextLength(data.chapters, next));
  };

  const selectAll = () => {
    if (!data) return;
    const all = new Set(data.chapters.map((_: unknown, i: number) => i));
    setSelected(all);
    fetchCost(selectedTextLength(data.chapters, all));
  };

  const selectNone = () => {
    setSelected(new Set());
    fetchCost(0);
  };

  const selectRange = (from: number, to: number) => {
    const [a, b] = from < to ? [from, to] : [to, from];
    const next = new Set(selected);
    for (let i = a; i <= b; i++) next.add(i);
    setSelected(next);
    if (data) fetchCost(selectedTextLength(data.chapters, next));
  };

  const invert = () => {
    if (!data) return;
    const all = new Set(data.chapters.map((_: unknown, i: number) => i));
    const next = new Set([...all].filter(i => !selected.has(i)));
    setSelected(next);
    fetchCost(selectedTextLength(data.chapters, next));
  };

  const selectedTextLength = (chapters: Chapter[], sel: Set<number>) => {
    if (sel.size === 0) return 0;
    if (sel.size === chapters.length) return data?.novelText.length ?? 0;
    return [...sel].reduce((sum, i) => sum + (chapters[i]?.text.length ?? 0), 0);
  };

  const startConversion = async () => {
    if (!data || selected.size === 0) return;
    sessionStorage.setItem('config', JSON.stringify({ model, selectedChapters: [...selected] }));
    const res = await fetch('/api/pipeline/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelText: data.novelText, title: data.title, modelId: model, selectedChapters: [...selected] }),
    });
    const d = await res.json();
    if (d.jobId) { sessionStorage.setItem('jobId', d.jobId); router.push('/convert'); }
  };

  if (!data) return null;

  const chapters: Chapter[] = data.chapters ?? [];
  const totalChars = selected.size === chapters.length
    ? data.novelText.length
    : [...selected].reduce((sum, i) => sum + (chapters[i]?.text.length ?? 0), 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-600 transition-colors text-sm">‹ 返回上传</button>
      </div>
      <div><h2 className="text-2xl font-bold">转换配置</h2><p className="text-gray-500 mt-1">
        {data.title}（{chapters.length} 章，已选 {selected.size} 章，约 {totalChars.toLocaleString()} 字）
      </p></div>

      {/* Chapter selection */}
      <div className="bg-white rounded-xl border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">选择章节</h3>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs border rounded px-2 py-1 hover:bg-gray-50">全选</button>
            <button onClick={selectNone} className="text-xs border rounded px-2 py-1 hover:bg-gray-50">清空</button>
            <button onClick={invert} className="text-xs border rounded px-2 py-1 hover:bg-gray-50">反选</button>
          </div>
        </div>

        <p className="text-xs text-gray-400">点击选中章节，按住 Shift 点击可选择范围</p>

        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5 max-h-80 overflow-y-auto pr-1">
          {chapters.map((ch, i) => (
            <ChapterChip
              key={i}
              index={i}
              title={ch.title}
              selected={selected.has(i)}
              onToggle={toggleChapter}
              onRange={selectRange}
            />
          ))}
        </div>
      </div>

      {/* Model & cost */}
      <div className="bg-white rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold">LLM 模型</h3>
        <select value={model} onChange={e => setModel(e.target.value)} className="w-full border rounded-lg p-2.5 text-sm">
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <h3 className="font-semibold">预估费用</h3>
        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600 min-h-[42px] flex items-center">
          {costLoading ? <span className="text-gray-400">重新计算中...</span> : <span>{cost || '计算中...'}</span>}
        </div>
        <p className="text-xs text-gray-400">实际费用取决于场景数量与转换质量，通常不超过 0.1 元</p>
      </div>

      {selected.size === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-3 rounded-xl text-center">
          请至少选择 1 章章节进行转换
        </div>
      )}

      <button
        onClick={startConversion}
        disabled={selected.size === 0}
        className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {selected.size === 0 ? '请先选择章节' : `开始转换 ${selected.size} 章`}
      </button>
    </div>
  );
}

// ── Chapter chip component ──

interface ChipProps {
  index: number;
  title: string;
  selected: boolean;
  onToggle: (i: number) => void;
  onRange: (from: number, to: number) => void;
}

function ChapterChip({ index, title, selected, onToggle, onRange }: ChipProps) {
  const lastRef = useRef<HTMLButtonElement | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey && lastRef.current !== null) {
      const prev = parseInt(lastRef.current.dataset.index ?? '0', 10);
      onRange(prev, index);
    } else {
      onToggle(index);
    }
    lastRef.current = e.currentTarget as HTMLButtonElement;
  };

  const shortTitle = title.length > 6 ? title.slice(0, 6) + '…' : title;

  return (
    <button
      data-index={index}
      onClick={handleClick}
      title={`第 ${index + 1} 章：${title}`}
      className={`flex flex-col items-center justify-center rounded-lg py-2 px-1 text-xs transition-colors select-none min-w-0 ${
        selected
          ? 'bg-blue-600 text-white shadow-sm'
          : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200'
      }`}
    >
      <span className="font-medium">{index + 1}</span>
      <span className="text-[10px] truncate w-full text-center leading-tight opacity-80">{shortTitle}</span>
    </button>
  );
}
