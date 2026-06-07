'use client';

import { useState, useEffect } from 'react';
import type { Scene, Character } from '@/lib/schema/screenplay.schema';
import type { Location } from '@/lib/schema/screenplay.schema';

const TIME_OPTIONS: { value: Scene['timeOfDay']; label: string }[] = [
  { value: 'dawn', label: '黎明' },
  { value: 'morning', label: '早晨' },
  { value: 'afternoon', label: '下午' },
  { value: 'dusk', label: '黄昏' },
  { value: 'night', label: '夜晚' },
  { value: 'late-night', label: '深夜' },
  { value: 'unknown', label: '未知' },
];

interface Props {
  scene: Scene;
  locations: Location[];
  characters: Character[];
  onChange: (scene: Scene) => void;
  onSave: (scene: Scene) => Promise<void>;
}

export function SceneEditor({ scene, locations, characters, onChange, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Scene>(scene);

  useEffect(() => {
    setDraft(scene);
    setEditing(false);
  }, [scene.sceneNumber]);

  const cancel = () => {
    setDraft(scene);
    setEditing(false);
  };

  const save = async () => {
    // Guard: don't save if scene has changed since editing started
    if (draft.sceneNumber !== scene.sceneNumber) return;

    // Guard: content must have at least one block
    if (draft.content.length === 0) {
      alert('场景内容不能为空');
      return;
    }

    // Filter out blocks with empty content before saving
    const validContent = draft.content.filter(b => {
      if (b.type === 'action') return b.description.trim().length > 0;
      if (b.type === 'dialogue') return b.line.trim().length > 0 && b.characterId.trim().length > 0;
      return true;
    });
    if (validContent.length === 0) {
      alert('场景内容不能为空');
      return;
    }

    if (!draft.slugline.trim()) {
      alert('场景标题 (Slugline) 不能为空');
      return;
    }

    // Auto-derive characterIds from dialogue blocks
    const characterIds = [
      ...new Set(
        validContent
          .filter(b => b.type === 'dialogue')
          .map(b => (b as { characterId: string }).characterId)
          .filter(Boolean),
      ),
    ];
    const toSave = { ...draft, content: validContent, characterIds };
    setSaving(true);
    try {
      await onSave(toSave);
      onChange(toSave);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const updateBlock = (bi: number, block: Scene['content'][0]) => {
    const next = [...draft.content];
    next[bi] = block;
    setDraft({ ...draft, content: next });
  };

  const deleteBlock = (bi: number) => {
    setDraft({ ...draft, content: draft.content.filter((_, i) => i !== bi) });
  };

  const addBlock = (type: 'action' | 'dialogue') => {
    const block = type === 'action'
      ? { type: 'action' as const, description: '', sourceRefs: [] }
      : { type: 'dialogue' as const, characterId: '', line: '', direction: '', sourceRefs: [] };
    setDraft({ ...draft, content: [...draft.content, block] });
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Scrollable Body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {/* Edit control bar */}
          <div className="flex justify-end">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">编辑</button>
            ) : (
              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                  {saving ? '保存中...' : '保存'}
                </button>
                <button onClick={cancel} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">取消</button>
              </div>
            )}
          </div>

          {/* Metadata row */}
          {editing && (
            <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
              <div>
                <label className="text-xs text-gray-500 block mb-1">场景标题 (Slugline)</label>
                <input
                  value={draft.slugline}
                  onChange={e => setDraft({ ...draft, slugline: e.target.value })}
                  className="w-full border rounded px-2 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="外景. 地点 - 时间"
                />
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">时间段</label>
                  <select
                    value={draft.timeOfDay}
                    onChange={e => setDraft({ ...draft, timeOfDay: e.target.value as Scene['timeOfDay'] })}
                    className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {TIME_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">地点</label>
                  <select
                    value={draft.locationId}
                    onChange={e => setDraft({ ...draft, locationId: e.target.value })}
                    className="border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {locations.map(l => <option key={l.locationId} value={l.locationId}>{l.name}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-500 block mb-1">摘要</label>
                  <input
                    value={draft.summary}
                    onChange={e => setDraft({ ...draft, summary: e.target.value })}
                    className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    placeholder="场景摘要..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* Content blocks */}
          <div className="space-y-3">
            {draft.content.map((block, bi) => (
              <div key={bi} className={`group relative ${block.type === 'action' ? 'bg-gray-50' : 'bg-blue-50/50'} rounded-lg p-4 border ${block.type === 'action' ? 'border-gray-200' : 'border-blue-100'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold ${block.type === 'action' ? 'text-gray-500' : 'text-blue-500'}`}>
                    {block.type === 'action' ? '动作' : '对白'}
                  </span>
                  {editing && (
                    <button
                      onClick={() => deleteBlock(bi)}
                      className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      disabled={draft.content.length <= 1}
                    >
                      删除
                    </button>
                  )}
                </div>

                {block.type === 'action' ? (
                  editing ? (
                    <textarea
                      value={block.description}
                      onChange={e => updateBlock(bi, { ...block, description: e.target.value })}
                      rows={3}
                      className="w-full text-sm text-gray-700 italic bg-transparent border border-gray-200 rounded px-2 py-1 resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
                      placeholder="描述动作..."
                    />
                  ) : (
                    <p className="text-sm text-gray-600 italic leading-relaxed">{block.description}</p>
                  )
                ) : (
                  <div className="space-y-1">
                    {editing ? (
                      <>
                        <select
                          value={block.characterId}
                          onChange={e => updateBlock(bi, { ...block, characterId: e.target.value })}
                          className="w-full border border-blue-200 rounded px-2 py-0.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-400"
                        >
                          <option value="">请选择角色</option>
                          {characters.map(c => (
                            <option key={c.characterId} value={c.characterId}>{c.name}</option>
                          ))}
                        </select>
                        <input
                          value={block.direction ?? ''}
                          onChange={e => updateBlock(bi, { ...block, direction: e.target.value })}
                          className="w-full border border-gray-200 rounded px-2 py-0.5 text-xs text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                          placeholder="方向提示 (微笑、叹息...)"
                        />
                        <textarea
                          value={block.line}
                          onChange={e => updateBlock(bi, { ...block, line: e.target.value })}
                          rows={2}
                          className="w-full text-sm bg-transparent border border-blue-200 rounded px-2 py-1 resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
                          placeholder="对白内容..."
                        />
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-bold">{characters.find(c => c.characterId === block.characterId)?.name || block.characterId}</p>
                        {block.direction && <p className="text-xs text-gray-400">({block.direction})</p>}
                        <p className="text-sm">{block.line}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add block buttons */}
          {editing && (
            <div className="flex gap-2">
              <button onClick={() => addBlock('action')} className="px-3 py-1.5 border border-dashed rounded text-xs text-gray-500 hover:border-gray-400 hover:text-gray-700">
                + 动作段落
              </button>
              <button onClick={() => addBlock('dialogue')} className="px-3 py-1.5 border border-dashed rounded text-xs text-blue-500 hover:border-blue-400 hover:text-blue-700">
                + 对白段落
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
