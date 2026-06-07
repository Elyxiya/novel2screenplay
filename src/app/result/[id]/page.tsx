'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import type { Screenplay, Scene, Character, Location } from '@/lib/schema/screenplay.schema';
import { SceneEditor } from '@/components/editors/SceneEditor';
import { CharacterEditor } from '@/components/editors/CharacterEditor';
import { LocationEditor } from '@/components/editors/LocationEditor';
import { SceneCompare } from '@/components/compare/SceneCompare';

type Tab = 'scenes' | 'characters' | 'locations' | 'yaml';
type SceneViewMode = 'editor' | 'compare';

export default function ResultPage() {
  const params = useParams();
  const jobId = params.id as string;

  const [screenplay, setScreenplay] = useState<Screenplay | null>(null);
  const [yaml, setYaml] = useState('');
  const [editYaml, setEditYaml] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('scenes');
  const [activeScene, setActiveScene] = useState(0);
  const [editingYaml, setEditingYaml] = useState(false);
  const [savingYaml, setSavingYaml] = useState(false);
  const [chapterTexts, setChapterTexts] = useState<string[]>([]);
  const [sceneViewMode, setSceneViewMode] = useState<SceneViewMode>('editor');

  const fetchScreenplay = useCallback(async () => {
    const res = await fetch(`/api/result/${jobId}`);
    const data = await res.json();
    if (data.screenplay) {
      setScreenplay(data.screenplay);
      setYaml(data.yaml);
      setEditYaml(data.yaml);
      if (data.chapterTexts) setChapterTexts(data.chapterTexts);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => { fetchScreenplay(); }, [fetchScreenplay]);

  const saveYaml = async () => {
    setSavingYaml(true);
    try {
      const res = await fetch(`/api/result/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: editYaml }),
      });
      const data = await res.json();
      if (data.success) {
        setYaml(editYaml);
        setEditingYaml(false);
        await fetchScreenplay();
      } else {
        alert('保存失败: ' + (data.error || data.details?.message || '未知错误'));
      }
    } finally {
      setSavingYaml(false);
    }
  };

  const saveScene = async (scene: Scene) => {
    const res = await fetch(`/api/result/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchScreenplay();
    } else {
      alert('保存失败: ' + (data.error || '未知错误'));
    }
  };

  const saveCharacter = async (character: Character) => {
    const res = await fetch(`/api/result/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchScreenplay();
    } else {
      alert('保存失败: ' + (data.error || '未知错误'));
    }
  };

  const saveLocation = async (location: Location) => {
    const res = await fetch(`/api/result/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location }),
    });
    const data = await res.json();
    if (data.success) {
      await fetchScreenplay();
    } else {
      alert('保存失败: ' + (data.error || '未知错误'));
    }
  };

  const downloadYaml = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${screenplay?.metadata?.title || '剧本'}.yaml`;
    a.click();
  };

  const currentSceneOriginalText = useMemo(() => {
    if (!screenplay || !chapterTexts.length) return '';
    const scene = screenplay.scenes[activeScene];
    if (!scene) return '';
    if (scene.sourceChapterRange) {
      const [start, end] = scene.sourceChapterRange;
      return chapterTexts.slice(start, end + 1).join('\n\n─── 章节分隔 ───\n\n');
    }
    const allRefs = scene.content.flatMap(b => b.sourceRefs ?? []);
    const chapterIndices = [...new Set(allRefs.map(r => r.chapterIndex))].sort((a, b) => a - b);
    if (!chapterIndices.length) return '';
    return chapterIndices
      .map(ci => chapterTexts[ci] ?? '')
      .filter(Boolean)
      .join('\n\n─── 章节分隔 ───\n\n');
  }, [screenplay, activeScene, chapterTexts]);

  if (loading) return <div className="text-center py-20 text-gray-400">加载中...</div>;
  if (!screenplay) return <div className="text-center py-20 text-gray-400">未找到剧本数据</div>;

  const sp = screenplay;
  const currentScene = sp.scenes[activeScene];

  const a = sp.analytics;
  const chars = new Map(sp.characters.map(c => [c.characterId, c.name]));

  return (
    <div className="space-y-4 max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{sp.metadata.title}</h2>
          <p className="text-sm text-gray-500">
            {sp.metadata.totalScenes} 场景 · {sp.metadata.totalCharacters} 角色 · {sp.metadata.totalLocations} 地点
          </p>
        </div>
        <button onClick={downloadYaml} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          下载 YAML
        </button>
      </div>

      {/* Analytics */}
      {a && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border p-4"><div className="text-2xl font-bold text-blue-600">{a.dialoguePercentage}%</div><div className="text-xs text-gray-500">对白密度</div></div>
          <div className="bg-white rounded-xl border p-4"><div className="text-2xl font-bold text-green-600">{a.actionPercentage}%</div><div className="text-xs text-gray-500">动作比例</div></div>
          <div className="bg-white rounded-xl border p-4"><div className="text-2xl font-bold">{sp.metadata.totalScenes}</div><div className="text-xs text-gray-500">总场景数</div></div>
          <div className="bg-white rounded-xl border p-4"><div className="text-2xl font-bold">{(a.totalWords / 10000).toFixed(1)}万</div><div className="text-xs text-gray-500">总字数</div></div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-white rounded-xl border p-1">
        {([
          { key: 'scenes', label: '场景', count: sp.scenes.length },
          { key: 'characters', label: '角色', count: sp.characters.length },
          { key: 'locations', label: '地点', count: sp.locations.length },
          { key: 'yaml', label: 'YAML', count: null },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {t.label}
            {t.count !== null && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === t.key ? 'bg-blue-100' : 'bg-gray-100'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Scenes Tab ── */}
      {tab === 'scenes' && (
        <div className="flex gap-4" style={{ height: 'calc(100vh - 300px)', minHeight: '400px' }}>
          {/* Scene navigator */}
          <div className="w-56 shrink-0 space-y-1 overflow-y-auto pr-1">
            {sp.scenes.map((s, i) => (
              <button
                key={s.sceneNumber}
                onClick={() => setActiveScene(i)}
                className={`w-full text-left p-2.5 rounded-lg text-sm transition-colors ${
                  i === activeScene ? 'bg-blue-50 border border-blue-200 text-blue-700' : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <span className="text-gray-400 text-xs">#{s.sceneNumber}.</span>
                <span className="ml-1">{s.summary || s.slugline}</span>
              </button>
            ))}
          </div>

          {/* Scene detail panel */}
          <div className="flex-1 bg-white rounded-xl border overflow-hidden flex flex-col">
            {/* View mode toggle */}
            <div className="shrink-0 px-4 pt-3 pb-2 border-b border-gray-100 flex justify-end">
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                {([
                  { key: 'editor', label: '编辑' },
                  { key: 'compare', label: '原文对照' },
                ] as const).map(m => (
                  <button
                    key={m.key}
                    onClick={() => setSceneViewMode(m.key)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      sceneViewMode === m.key
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {sceneViewMode === 'editor' ? (
                <SceneEditor
                  scene={currentScene}
                  locations={sp.locations}
                  characters={sp.characters}
                  onChange={() => {}}
                  onSave={saveScene}
                />
              ) : (
                <SceneCompare
                  scene={currentScene}
                  originalText={currentSceneOriginalText}
                  characters={sp.characters}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Characters Tab ── */}
      {tab === 'characters' && (
        <div className="overflow-y-auto" style={{ height: 'calc(100vh - 300px)', minHeight: '300px' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sp.characters.map(c => (
              <CharacterEditor key={c.characterId} character={c} onSave={saveCharacter} />
            ))}
          </div>
        </div>
      )}

      {/* ── Locations Tab ── */}
      {tab === 'locations' && (
        <div className="overflow-y-auto" style={{ height: 'calc(100vh - 300px)', minHeight: '300px' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sp.locations.map(l => (
              <LocationEditor key={l.locationId} location={l} onSave={saveLocation} />
            ))}
          </div>
        </div>
      )}

      {/* ── YAML Tab ── */}
      {tab === 'yaml' && (
        <div className="bg-white rounded-xl border">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-semibold text-sm">YAML 输出</h3>
            <div className="flex gap-2">
              {!editingYaml ? (
                <>
                  <button onClick={() => { setEditingYaml(true); setEditYaml(yaml); }} className="px-3 py-1.5 border rounded text-xs hover:bg-gray-50">编辑</button>
                  <button onClick={() => navigator.clipboard.writeText(yaml)} className="px-3 py-1.5 border rounded text-xs hover:bg-gray-50">复制</button>
                </>
              ) : (
                <>
                  <button onClick={saveYaml} disabled={savingYaml} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50">
                    {savingYaml ? '保存中...' : '校验并保存'}
                  </button>
                  <button onClick={() => { setEditingYaml(false); setEditYaml(yaml); }} className="px-3 py-1.5 border rounded text-xs hover:bg-gray-50">取消</button>
                </>
              )}
            </div>
          </div>
          <textarea
            value={editingYaml ? editYaml : yaml}
            onChange={e => editingYaml && setEditYaml(e.target.value)}
            readOnly={!editingYaml}
            rows={30}
            className={`w-full p-4 text-xs font-mono resize-y focus:outline-none overflow-y-auto ${editingYaml ? 'bg-blue-50' : ''}`}
            style={{ height: 'calc(100vh - 360px)', minHeight: '300px' }}
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}
