'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface SceneData {
  sceneNumber: number;
  slugline: string;
  summary: string;
  content: Array<{
    type: 'action' | 'dialogue';
    description?: string;
    characterId?: string;
    line?: string;
    direction?: string;
  }>;
  confidence?: number;
}

interface Screenplay {
  metadata: { title: string; totalScenes: number; totalCharacters: number; totalLocations: number };
  characters: Array<{ characterId: string; name: string }>;
  scenes: SceneData[];
  analytics?: { dialoguePercentage: number; actionPercentage: number; totalWords: number; avgSceneLength: number };
}

export default function ResultPage() {
  const params = useParams();
  const jobId = params.id as string;
  const [screenplay, setScreenplay] = useState<Screenplay | null>(null);
  const [yaml, setYaml] = useState('');
  const [activeScene, setActiveScene] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editYaml, setEditYaml] = useState('');

  useEffect(() => {
    if (!jobId) return;
    fetch(`/api/result/${jobId}`).then(r => r.json()).then(data => {
      if (data.screenplay) { setScreenplay(data.screenplay); setYaml(data.yaml); setEditYaml(data.yaml); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [jobId]);

  const validateYaml = async () => {
    const res = await fetch(`/api/result/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: editYaml }),
    });
    const data = await res.json();
    if (data.success) { setYaml(editYaml); setEditing(false); }
    else { alert('YAML 校验失败: ' + data.error); }
  };

  const downloadYaml = () => {
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${screenplay?.metadata?.title || '剧本'}.yaml`; a.click();
  };

  const copyYaml = () => navigator.clipboard.writeText(yaml);

  if (loading) return <div className="text-center py-20 text-gray-400">加载中...</div>;
  if (!screenplay) return <div className="text-center py-20 text-gray-400">未找到剧本数据</div>;

  const scene = screenplay.scenes[activeScene];
  const chars = new Map(screenplay.characters.map(c => [c.characterId, c.name]));
  const a = screenplay.analytics;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div><h2 className="text-2xl font-bold">{screenplay.metadata.title}</h2>
          <p className="text-sm text-gray-500">{screenplay.metadata.totalScenes} 场景 · {screenplay.metadata.totalCharacters} 角色 · {screenplay.metadata.totalLocations} 地点</p>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadYaml} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">下载 YAML</button>
          <button onClick={copyYaml} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">复制</button>
        </div>
      </div>

      {/* Dashboard */}
      {a && <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4"><div className="text-2xl font-bold text-blue-600">{a.dialoguePercentage}%</div><div className="text-xs text-gray-500">对白密度</div></div>
        <div className="bg-white rounded-xl border p-4"><div className="text-2xl font-bold text-green-600">{a.actionPercentage}%</div><div className="text-xs text-gray-500">动作比例</div></div>
        <div className="bg-white rounded-xl border p-4"><div className="text-2xl font-bold">{screenplay.metadata.totalScenes}</div><div className="text-xs text-gray-500">总场景数</div></div>
        <div className="bg-white rounded-xl border p-4"><div className="text-2xl font-bold">{(a.totalWords / 10000).toFixed(1)}万</div><div className="text-xs text-gray-500">总字数</div></div>
      </div>}

      {/* Main content: sidebar + scene view */}
      <div className="flex gap-4">
        {/* Scene Navigator */}
        <div className="w-56 shrink-0 space-y-1">
          {screenplay.scenes.map((s, i) => (
            <button key={i} onClick={() => setActiveScene(i)}
              className={`w-full text-left p-2.5 rounded-lg text-sm transition-colors ${i === activeScene ? 'bg-blue-50 border border-blue-200 text-blue-700' : 'hover:bg-gray-50 border border-transparent'}`}>
              <span className="text-gray-400 text-xs">{s.sceneNumber}.</span>
              <span className="ml-1">{s.summary || s.slugline}</span>
            </button>
          ))}
        </div>

        {/* Scene Content */}
        <div className="flex-1 bg-white rounded-xl border p-6 space-y-4">
          <div className="flex items-baseline gap-3">
            <span className="text-sm font-bold text-blue-600">#{scene.sceneNumber}</span>
            <span className="font-medium">{scene.slugline}</span>
            {scene.confidence !== undefined && (
              <span className={`text-xs px-2 py-0.5 rounded ${scene.confidence > 0.7 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {Math.round(scene.confidence * 100)}%
              </span>
            )}
          </div>

          <div className="space-y-3">
            {scene.content.map((block, bi) => (
              <div key={bi}>
                {block.type === 'action' ? (
                  <p className="text-sm text-gray-600 italic leading-relaxed">{block.description}</p>
                ) : (
                  <div>
                    <p className="text-sm font-bold">{chars.get(block.characterId || '') || block.characterId}</p>
                    {block.direction && <p className="text-xs text-gray-400 ml-2">({block.direction})</p>}
                    <p className="text-sm mt-0.5">{block.line}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* YAML Editor */}
      <div className="bg-white rounded-xl border">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-sm">YAML 输出</h3>
          {editing ? (
            <div className="flex gap-2">
              <button onClick={validateYaml} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs">校验并保存</button>
              <button onClick={() => { setEditing(false); setEditYaml(yaml); }} className="px-3 py-1.5 border rounded text-xs">取消</button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="px-3 py-1.5 border rounded text-xs hover:bg-gray-50">编辑</button>
          )}
        </div>
        <textarea
          value={editing ? editYaml : yaml}
          onChange={e => setEditYaml(e.target.value)}
          readOnly={!editing}
          rows={20}
          className="w-full p-4 text-xs font-mono resize-y focus:outline-none"
        />
      </div>
    </div>
  );
}
