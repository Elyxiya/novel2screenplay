'use client';

import { useState } from 'react';
import type { Location } from '@novel/contracts/screenplay';

const TYPE_LABELS: Record<string, string> = {
  interior: '内景',
  exterior: '外景',
  abstract: '抽象',
};

interface Props {
  location: Location;
  onSave: (l: Location) => Promise<void>;
  onDelete?: (locationId: string) => Promise<void>;
}

export function LocationEditor({ location, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Location>(location);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(location);
    setEditing(false);
  };

  return (
    <div className="bg-white rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{location.locationId}</span>
          {editing ? (
            <input
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              className="font-medium border-b border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 rounded px-1"
            />
          ) : (
            <span className="font-medium">{location.name}</span>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            location.type === 'exterior' ? 'bg-green-100 text-green-700' :
            location.type === 'interior' ? 'bg-blue-100 text-blue-700' :
            'bg-gray-100 text-gray-600'
          }`}>
            {TYPE_LABELS[location.type] || location.type}
          </span>
        </div>
        <div className="flex gap-1 items-center">
          {onDelete && (
            <button
              onClick={async () => { if (confirm(`确定删除地点「${location.name}」？`)) await onDelete(location.locationId); }}
              className="text-xs text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
              title="删除地点"
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
            <label className="text-xs text-gray-500 block mb-1">场景类型</label>
            <select
              value={draft.type}
              onChange={e => setDraft({ ...draft, type: e.target.value as Location['type'] })}
              className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="interior">内景 (interior)</option>
              <option value="exterior">外景 (exterior)</option>
              <option value="abstract">抽象 (abstract)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">场景描述</label>
            <textarea
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              className="w-full border rounded px-2 py-1 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="场景描述..."
            />
          </div>
        </div>
      ) : (
        location.description && (
          <p className="text-xs text-gray-500">{location.description}</p>
        )
      )}
    </div>
  );
}
