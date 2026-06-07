'use client';

import { useState } from 'react';
import type { Character } from '@/lib/schema/screenplay.schema';

interface Props {
  character: Character;
  onSave: (c: Character) => Promise<void>;
  onDelete?: (characterId: string) => Promise<void>;
}

export function CharacterEditor({ character, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Character>(character);
  const [aliasInput, setAliasInput] = useState(character.aliases.join('、'));
  const [tagInput, setTagInput] = useState(character.personalityTags.join('、'));

  const commit = () => {
    const aliases = aliasInput.split('、').map(s => s.trim()).filter(Boolean);
    const tags = tagInput.split('、').map(s => s.trim()).filter(Boolean);
    setDraft({ ...draft, aliases, personalityTags: tags });
  };

  const save = async () => {
    commit();
    setSaving(true);
    try {
      await onSave({ ...draft, aliases: aliasInput.split('、').map(s => s.trim()).filter(Boolean), personalityTags: tagInput.split('、').map(s => s.trim()).filter(Boolean) });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(character);
    setAliasInput(character.aliases.join('、'));
    setTagInput(character.personalityTags.join('、'));
    setEditing(false);
  };

  return (
    <div className="bg-white rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{character.characterId}</span>
          {editing ? (
            <input
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              className="font-bold border-b border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 rounded px-1"
            />
          ) : (
            <span className="font-bold">{character.name}</span>
          )}
          {character.isMajor && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">主角</span>}
        </div>
        <div className="flex gap-1 items-center">
          {onDelete && (
            <button
              onClick={async () => { if (confirm(`确定删除角色「${character.name}」？`)) await onDelete(character.characterId); }}
              className="text-xs text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
              title="删除角色"
            >
              删除
            </button>
          )}
          {!editing ? (
            <button onClick={() => setEditing(true)} className="text-xs border rounded px-2 py-1 hover:bg-gray-50">编辑</button>
          ) : (
            <div className="flex gap-1">
              <button onClick={save} disabled={saving} className="text-xs bg-blue-600 text-white rounded px-2 py-1 disabled:opacity-50">{saving ? '...' : '保存'}</button>
              <button onClick={cancel} className="text-xs border rounded px-2 py-1 hover:bg-gray-50">取消</button>
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-gray-500">别名（用顿号分隔）</label>
            <input value={aliasInput} onChange={e => setAliasInput(e.target.value)} className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="炎儿、三少爷" />
          </div>
          <div>
            <label className="text-xs text-gray-500">性格标签（用顿号分隔）</label>
            <input value={tagInput} onChange={e => setTagInput(e.target.value)} className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" placeholder="坚韧、自尊" />
          </div>
          <div>
            <label className="text-xs text-gray-500">角色描述</label>
            <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} rows={3} className="w-full border rounded px-2 py-1 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id={`major-${character.characterId}`} checked={draft.isMajor} onChange={e => setDraft({ ...draft, isMajor: e.target.checked })} className="accent-blue-600" />
            <label htmlFor={`major-${character.characterId}`} className="text-sm">主要角色</label>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {character.aliases.length > 0 && (
            <p className="text-xs text-gray-500">别名: {character.aliases.join('、')}</p>
          )}
          {character.personalityTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {character.personalityTags.map(tag => (
                <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{tag}</span>
              ))}
            </div>
          )}
          {character.description && (
            <p className="text-xs text-gray-500 leading-relaxed">{character.description}</p>
          )}
        </div>
      )}
    </div>
  );
}
