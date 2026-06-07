'use client';

import { useState, useMemo } from 'react';
import type { Scene, Character } from '@/lib/schema/screenplay.schema';

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
      <div className="shrink-0 z-10 sticky top-0 bg-white border-b border-gray-100">
        <div className="flex justify-end px-4 py-2">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
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
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
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
            <div className="flex-1 p-4 border-r border-gray-200 min-w-0">
              <div className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">剧本内容</div>
              <div className="space-y-4">
                {scene.content.map((block, bi) => (
                  <div
                    key={bi}
                    className={`p-3 rounded-lg text-sm leading-relaxed ${
                      block.type === 'action'
                        ? 'bg-gray-50 border border-gray-200 text-gray-600 italic'
                        : 'bg-blue-50 border border-blue-100'
                    }`}
                  >
                    {block.type === 'action' ? (
                      <p>{block.description}</p>
                    ) : (
                      <div>
                        <p className="font-bold text-blue-800 mb-0.5">{characterName(block.characterId)}</p>
                        {block.direction && <p className="text-xs text-gray-400 mb-1">({block.direction})</p>}
                        <p>{block.line}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: original excerpts */}
            <div className="flex-1 p-4 min-w-0">
              <div className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">对应原文</div>
              <div className="space-y-4">
                {blockExceprts.map(({ blockIndex, type, excerpts }) => {
                  if (excerpts.length === 0) {
                    return (
                      <div key={blockIndex} className={`p-3 rounded-lg text-sm ${
                        type === 'action' ? 'bg-gray-50 border border-gray-200' : 'bg-blue-50 border border-blue-100'
                      }`}>
                        <p className="text-gray-400 italic text-xs mb-1">#block-{blockIndex + 1} — 无对应原文引用</p>
                        <p className="text-gray-600 italic">
                          {type === 'action'
                            ? scene.content[blockIndex].description
                            : scene.content[blockIndex].line}
                        </p>
                      </div>
                    );
                  }
                  return excerpts.map((exc, ei) => (
                    <div key={`${blockIndex}-${ei}`} className={`p-3 rounded-lg text-sm ${
                      type === 'action' ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'
                    }`}>
                      <p className="text-xs font-semibold mb-1.5 text-gray-500">
                        {type === 'action' ? '动作' : '对白'} #{blockIndex + 1}
                        {excerpts.length > 1 && <span className="font-normal"> (摘录 {ei + 1}/{excerpts.length})</span>}
                      </p>
                      <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{exc}</p>
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
            <div className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">剧本内容</div>
            <div className="space-y-4">
              {scene.content.map((block, bi) => (
                <div
                  key={bi}
                  className={`p-4 rounded-lg text-sm leading-relaxed ${
                    block.type === 'action'
                      ? 'bg-gray-50 border border-gray-200 text-gray-600 italic'
                      : 'bg-blue-50 border border-blue-100'
                  }`}
                >
                  {block.type === 'action' ? (
                    <p>{block.description}</p>
                  ) : (
                    <div>
                      <p className="font-bold text-blue-800 mb-0.5">{characterName(block.characterId)}</p>
                      {block.direction && <p className="text-xs text-gray-400 mb-1">({block.direction})</p>}
                      <p>{block.line}</p>
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
            <div className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">场景原文</div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {originalText || '（无原文数据）'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
