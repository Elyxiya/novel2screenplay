'use client';

import { useState, useMemo } from 'react';
import type { Scene, Character } from '@novel/contracts/screenplay';

interface SceneCompareProps {
  scene: Scene;
  originalText: string;
  characters: Character[];
}

type ViewMode = 'split' | 'original' | 'screenplay';

export function SceneCompare({ scene, originalText, characters }: SceneCompareProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split');

  const blockExceprts = useMemo(() => {
    return scene.content.map((block, i) => {
      const refs = block.sourceRefs ?? [];
      if (refs.length === 0) {
        return { blockIndex: i, type: block.type, excerpts: [] };
      }
      const excerpts = refs.map(r => r.excerpt).filter(Boolean);
      return { blockIndex: i, type: block.type, excerpts };
    });
  }, [scene.content]);

  const characterName = (id: string) =>
    characters.find(c => c.characterId === id)?.name || id;

  return (
    <div className="flex flex-col h-full">
      {/* View mode toggle — sticky below the outer panel header */}
      <div className="shrink-0 z-10 sticky top-0 bg-[#121216] border-b border-white/8">
        <div className="flex justify-end px-4 py-2">
          <div className="flex gap-1 bg-white/8 rounded-lg p-1">
            {([
              { key: 'split', label: '对照' },
              { key: 'screenplay', label: '剧本' },
              { key: 'original', label: '原文' },
            ] as const).map(m => (
              <button
                key={m.key}
                onClick={() => setViewMode(m.key)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  viewMode === m.key
                    ? 'bg-[rgba(var(--accent-rgb),0.2)] text-[var(--accent-soft)] shadow-sm'
                    : 'text-ink-faint hover:text-ink-text'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto">
        {/* Split view */}
        {viewMode === 'split' && (
          <div className="flex" style={{ minHeight: '100%' }}>
            {/* Left: screenplay */}
            <div className="flex-1 p-4 border-r border-white/8 min-w-0">
              <div className="text-xs font-semibold text-ink-faint mb-3 uppercase tracking-wider">剧本内容</div>
              <div className="space-y-4">
                {scene.content.map((block, bi) => (
                  <div
                    key={bi}
                    className={`p-3 rounded-lg text-sm leading-relaxed ${
                      block.type === 'action'
                        ? 'bg-white/5 border border-white/10 text-ink-muted italic'
                        : 'bg-[rgba(var(--accent-rgb),0.05)] border border-[rgba(var(--accent-rgb),0.25)]'
                    }`}
                  >
                    {block.type === 'action' ? (
                      <p>{block.description}</p>
                    ) : (
                      <div>
                        <p className="font-bold text-[var(--accent-soft)] mb-0.5">{characterName(block.characterId)}</p>
                        {block.direction && <p className="text-xs text-ink-faint mb-1">({block.direction})</p>}
                        <p className="text-ink-text">{block.line}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: original excerpts */}
            <div className="flex-1 p-4 min-w-0">
              <div className="text-xs font-semibold text-ink-faint mb-3 uppercase tracking-wider">对应原文</div>
              <div className="space-y-4">
                {blockExceprts.map(({ blockIndex, type, excerpts }) => {
                  if (excerpts.length === 0) {
                    const block = scene.content[blockIndex];
                    return (
                      <div key={blockIndex} className={`p-3 rounded-lg text-sm ${
                        type === 'action' ? 'bg-white/5 border border-white/10' : 'bg-[rgba(var(--accent-rgb),0.05)] border border-[rgba(var(--accent-rgb),0.25)]'
                      }`}>
                        <p className="text-ink-faint italic text-xs mb-1">#block-{blockIndex + 1} — 无对应原文引用</p>
                        <p className="text-ink-muted italic">
                          {'description' in block ? block.description : block.line}
                        </p>
                      </div>
                    );
                  }
                  return excerpts.map((exc, ei) => (
                    <div key={`${blockIndex}-${ei}`} className={`p-3 rounded-lg text-sm ${
                      type === 'action' ? 'bg-[rgba(var(--accent-rgb),0.05)] border border-[rgba(var(--accent-rgb),0.25)]' : 'bg-emerald-500/5 border border-emerald-500/25'
                    }`}>
                      <p className="text-xs font-semibold mb-1.5 text-ink-muted">
                        {type === 'action' ? '动作' : '对白'} #{blockIndex + 1}
                        {excerpts.length > 1 && <span className="font-normal"> (摘录 {ei + 1}/{excerpts.length})</span>}
                      </p>
                      <p className="text-ink-text leading-relaxed whitespace-pre-wrap">{exc}</p>
                    </div>
                  ));
                })}
              </div>
            </div>
          </div>
        )}

        {/* Screenplay only */}
        {viewMode === 'screenplay' && (
          <div className="p-4">
            <div className="text-xs font-semibold text-ink-faint mb-3 uppercase tracking-wider">剧本内容</div>
            <div className="space-y-4">
              {scene.content.map((block, bi) => (
                <div
                  key={bi}
                  className={`p-4 rounded-lg text-sm leading-relaxed ${
                    block.type === 'action'
                      ? 'bg-white/5 border border-white/10 text-ink-muted italic'
                      : 'bg-[rgba(var(--accent-rgb),0.05)] border border-[rgba(var(--accent-rgb),0.25)]'
                  }`}
                >
                  {block.type === 'action' ? (
                    <p>{block.description}</p>
                  ) : (
                    <div>
                      <p className="font-bold text-[var(--accent-soft)] mb-0.5">{characterName(block.characterId)}</p>
                      {block.direction && <p className="text-xs text-ink-faint mb-1">({block.direction})</p>}
                      <p className="text-ink-text">{block.line}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Original only */}
        {viewMode === 'original' && (
          <div className="p-4">
            <div className="text-xs font-semibold text-ink-faint mb-3 uppercase tracking-wider">场景原文</div>
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <p className="text-sm text-ink-text leading-relaxed whitespace-pre-wrap">
                {originalText || '（无原文数据）'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}