'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ModelSelector } from '@/components/ModelSelector';

interface Chapter {
  index: number;
  title: string;
  paragraphCount: number;
  text: string;
}

export default function ConfigurePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const novelParam = searchParams.get('novel');

  // 数据源：优先服务端小说资产（工作台续转），否则 sessionStorage（本地上传）
  const [data, setData] = useState<{ novelText: string; title: string; chapters: Chapter[]; novelId?: string; convertedChapters?: number[] } | null>(() => {
    try {
      const raw = sessionStorage.getItem('novelData');
      return raw ? (JSON.parse(raw) as { novelText: string; title: string; chapters: Chapter[]; novelId?: string; convertedChapters?: number[] }) : null;
    } catch {
      return null;
    }
  });
  const [loadingNovel, setLoadingNovel] = useState(!!novelParam);
  // 惰性初始化：本地上传首次进入默认全选
  const [selected, setSelected] = useState<Set<number>>(() => {
    try {
      const raw = sessionStorage.getItem('novelData');
      if (raw) {
        const d = JSON.parse(raw) as { chapters: Chapter[]; novelId?: string; convertedChapters?: number[] };
        if (d.chapters?.length) {
          const converted = new Set(d.convertedChapters ?? []);
          if (d.novelId) {
            // 续转：默认选未转换章节
            return new Set(d.chapters.map((_: unknown, i: number) => i).filter((i) => !converted.has(i)));
          }
          return new Set(d.chapters.map((_: unknown, i: number) => i));
        }
      }
    } catch {
      // ignore
    }
    return new Set<number>();
  });
  const [model, setModel] = useState('deepseek-chat');
  const [, setModels] = useState<string[]>(['deepseek-chat', 'gpt-4o']);
  const [cost, setCost] = useState('');
  const [costLoading, setCostLoading] = useState(false);
  const costTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchModels = useCallback((_d: { novelText: string; title: string; chapters: Chapter[] }, setter: (m: string[]) => void) => {
    fetch('/api/models').then(r => r.json()).then(r => {
      const ids = (r.adapters ?? []).flatMap((a: { models: Array<{ modelId: string }> }) =>
        (a.models ?? []).map((m) => m.modelId),
      );
      if (ids.length) setter(ids);
    }).catch(() => {});
  }, []);

  const fetchCost = useCallback((chars: number) => {
    if (costTimerRef.current) clearTimeout(costTimerRef.current);
    costTimerRef.current = setTimeout(async () => {
      setCostLoading(true);
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

  // 工作台续转：从服务端加载小说资产
  useEffect(() => {
    if (!novelParam) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/novels/${novelParam}`);
        const d = await res.json();
        if (cancelled || !d.novel) return;
        const n = d.novel;
        const chapters: Chapter[] = (n.chapters as Array<{ index: number; title: string; paragraphCount: number }>).map((c, i) => ({
          index: c.index,
          title: c.title,
          paragraphCount: c.paragraphCount,
          text: n.chapterTexts?.[i] ?? '',
        }));
        const converted = (n.convertedChapters ?? []) as number[];
        setData({
          novelText: chapters.map((c) => c.text).join('\n\n'),
          title: n.title,
          chapters,
          novelId: n.id,
          convertedChapters: converted,
        });
        // 默认只选未转换章节
        setSelected(new Set(chapters.map((_, i) => i).filter((i) => !converted.includes(i))));
        fetchCost(chapters.filter((_, i) => !converted.includes(i)).reduce((s, c) => s + c.text.length, 0));
      } catch {
        router.push('/workbench');
      } finally {
        if (!cancelled) setLoadingNovel(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelParam]);

  useEffect(() => {
    if (!data) {
      if (!loadingNovel) router.push('/upload');
      return;
    }
    fetchModels(data, setModels);
    if (!novelParam) {
      // 首次进入（无 novel 参数）：全量成本预估
      fetchCost(data.novelText.length);
    }

    return () => {
      if (costTimerRef.current) clearTimeout(costTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, router, fetchModels, fetchCost]);

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
    // Pass full novel text + selected indices (NOT filtered text)
    const res = await fetch('/api/pipeline/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelText: data.novelText,
        title: data.title,
        modelId: model,
        selectedChapters: [...selected],
        novelId: data.novelId,
      }),
    });
    const d = await res.json();
    if (d.jobId) { sessionStorage.setItem('jobId', d.jobId); router.push('/convert'); }
  };

  if (!data) return null;

  const chapters: Chapter[] = data.chapters ?? [];
  const convertedSet = new Set(data.convertedChapters ?? []);
  const totalChars = selected.size === chapters.length
    ? data.novelText.length
    : [...selected].reduce((sum, i) => sum + (chapters[i]?.text.length ?? 0), 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-float-up">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(data.novelId ? '/workbench' : '/')} className="glow-btn-ghost !px-3 !py-1.5 text-xs">
          ‹ {data.novelId ? '返回工作台' : '返回上传'}
        </button>
        <span className="tech-tag tech-tag-cyan">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          第 2 步 · 转换配置
        </span>
        {data.novelId && (
          <span className="tech-tag">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            追加转换 · 已转换 {convertedSet.size}/{chapters.length} 章
          </span>
        )}
      </div>
      <div>
        <h2 className="text-2xl font-bold text-slate-900">转换配置</h2>
        <p className="text-slate-500 mt-1">
          《{data.title}》 · <span className="font-mono font-semibold text-cyan-600">{chapters.length}</span> 章 · 已选 <span className="font-mono font-semibold text-indigo-600">{selected.size}</span> 章 · 约 {totalChars.toLocaleString()} 字
        </p>
      </div>

      {/* Chapter selection */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h6" />
            </svg>
            选择章节
            <span className="text-xs font-normal text-slate-400 ml-1">{selected.size}/{chapters.length}</span>
          </h3>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 hover:border-cyan-400/60 hover:text-cyan-700 transition-colors bg-white/60">全选</button>
            <button onClick={selectNone} className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 hover:border-cyan-400/60 hover:text-cyan-700 transition-colors bg-white/60">清空</button>
            <button onClick={invert} className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 hover:border-cyan-400/60 hover:text-cyan-700 transition-colors bg-white/60">反选</button>
          </div>
        </div>

        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          点击选中章节，按住 Shift 点击可连续选择范围
        </p>

        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5 max-h-80 overflow-y-auto pr-1">
          {chapters.map((ch, i) => (
            <ChapterChip
              key={i}
              index={i}
              title={ch.title}
              selected={selected.has(i)}
              converted={convertedSet.has(i)}
              onToggle={toggleChapter}
              onRange={selectRange}
            />
          ))}
        </div>
      </div>

      {/* Model & cost */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          LLM 模型
        </h3>
        <ModelSelector value={model} onChange={setModel} />

        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          预估费用
        </h3>
        <div className="relative rounded-xl border border-slate-200/70 bg-white/70 p-4 min-h-[54px] flex items-center overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-cyan-400/5" />
          {costLoading ? (
            <span className="relative text-slate-400 flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              重新计算中...
            </span>
          ) : (
            <span className="relative text-sm">
              {cost ? (
                <>
                  <span className="text-lg font-bold neon-text font-mono">{cost.split('，')[0]}</span>
                  <span className="text-slate-500 ml-2">{cost.split('，').slice(1).join('，')}</span>
                </>
              ) : '计算中...'}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400">实际费用取决于场景数量与转换质量，通常不超过 0.1 元</p>
      </div>

      {selected.size === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-3 rounded-xl text-center">
          ⚠️ 请至少选择 1 章章节进行转换
        </div>
      )}

      <button
        onClick={startConversion}
        disabled={selected.size === 0}
        className="glow-btn w-full py-3.5 text-base"
      >
        {selected.size === 0 ? '请先选择章节' : `开始转换 ${selected.size} 章`}
        {selected.size > 0 && (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Chapter chip component ──

interface ChipProps {
  index: number;
  title: string;
  selected: boolean;
  converted?: boolean;
  onToggle: (i: number) => void;
  onRange: (from: number, to: number) => void;
}

function ChapterChip({ index, title, selected, converted = false, onToggle, onRange }: ChipProps) {
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
      title={`第 ${index + 1} 章：${title}${converted ? '（已转换）' : ''}`}
      className={`relative flex flex-col items-center justify-center rounded-lg py-2 px-1 text-xs transition-all duration-200 select-none min-w-0 ${
        selected
          ? 'bg-gradient-to-br from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-300/50 scale-[1.03]'
          : converted
            ? 'bg-emerald-50/80 text-emerald-600 border border-emerald-300/60'
            : 'bg-white/70 text-slate-500 hover:bg-white hover:border-cyan-300/50 border border-slate-200'
      }`}
    >
      <span className="font-medium">{index + 1}</span>
      <span className="text-[10px] truncate w-full text-center leading-tight opacity-80">{shortTitle}</span>
      {converted && (
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 text-white flex items-center justify-center">
          <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={4}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
    </button>
  );
}
