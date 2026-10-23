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
    <div className="glass-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-faint font-mono">{location.locationId}</span>
          {editing ? (
            <input
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              className="font-medium border-b border-[rgba(var(--accent-rgb),0.5)] focus:outline-none focus:ring-2 focus:ring-[rgba(var(--accent-rgb),0.4)] rounded px-1 bg-transparent text-ink-text"
            />
          ) : (
            <span className="font-medium text-ink-text">{location.name}</span>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            location.type === 'exterior' ? 'bg-emerald-500/15 text-emerald-300' :
            location.type === 'interior' ? 'bg-[rgba(var(--accent-rgb),0.15)] text-[var(--accent-soft)]' :
            'bg-white/10 text-ink-muted'
          }`}>
            {TYPE_LABELS[location.type] || location.type}
          </span>
        </div>
        <div className="flex gap-1 items-center">
          {onDelete && (
            <button
              onClick={async () => { if (confirm(`确定删除地点「${location.name}」？`)) await onDelete(location.locationId); }}
              className="text-xs text-red-400 border border-red-500/30 rounded px-2 py-1 hover:bg-red-500/10 transition-colors"
              title="删除地点"
            >
              删除
            </button>
          )}
          {!editing ? (
            <button onClick={() => setEditing(true)} className="text-xs border border-white/12 rounded px-2 py-1 hover:bg-white/5 text-ink-muted transition-colors">编辑</button>
          ) : (
            <div className="flex gap-1">
              <button onClick={save} disabled={saving} className="text-xs bg-gradient-to-r from-[#c8892f] to-[#e8b04a] text-white rounded px-2 py-1 disabled:opacity-50 shadow-sm shadow-[rgba(var(--accent-rgb),0.2)]">{saving ? '...' : '保存'}</button>
              <button onClick={cancel} className="text-xs border border-white/12 rounded px-2 py-1 hover:bg-white/5 text-ink-muted transition-colors">取消</button>
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-ink-muted block mb-1">场景类型</label>
            <select
              value={draft.type}
              onChange={e => setDraft({ ...draft, type: e.target.value as Location['type'] })}
              className="tech-input !py-1.5 text-sm"
            >
              <option value="interior">内景 (interior)</option>
              <option value="exterior">外景 (exterior)</option>
              <option value="abstract">抽象 (abstract)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-ink-muted block mb-1">场景描述</label>
            <textarea
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              className="tech-input !py-1.5 text-sm resize-y"
              placeholder="场景描述..."
            />
          </div>
        </div>
      ) : (
        location.description && (
          <p className="text-xs text-ink-muted">{location.description}</p>
        )
      )}
    </div>
  );
}
