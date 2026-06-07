'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export default function ConfigurePage() {
  const router = useRouter();
  const initialized = useRef(false);
  const [data, setData] = useState<{ novelText: string; title: string } | null>(null);
  const [model, setModel] = useState('deepseek-chat');
  const [models, setModels] = useState<string[]>(['deepseek-chat', 'gpt-4o']);
  const [cost, setCost] = useState('');
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const raw = sessionStorage.getItem('novelData');
    if (!raw) { router.push('/'); return; }
    try {
      const d = JSON.parse(raw);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentionally initializing state from sessionStorage on mount
      setData(d);
      setCharCount(d.novelText.length);

      fetch('/api/models').then(r => r.json()).then(r => {
        if (r.models?.length) setModels(r.models.map((m: { id: string }) => m.id));
      }).catch(() => {});

      fetch(`/api/cost-estimate?chars=${d.novelText.length}`).then(r => r.json()).then(r => {
        setCost(`约 ¥${r.estimatedCostCNY}，${r.estimatedTokens?.toLocaleString()} tokens`);
      }).catch(() => {});
    } catch {
      router.push('/');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startConversion = async () => {
    if (!data) return;
    sessionStorage.setItem('config', JSON.stringify({ model }));
    const res = await fetch('/api/pipeline/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelText: data.novelText, title: data.title, modelId: model }),
    });
    const d = await res.json();
    if (d.jobId) { sessionStorage.setItem('jobId', d.jobId); router.push(`/convert`); }
  };

  if (!data) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-600 transition-colors text-sm">‹ 返回上传</button>
      </div>
      <div><h2 className="text-2xl font-bold">转换配置</h2><p className="text-gray-500 mt-1">{data.title}（约 {charCount.toLocaleString()} 字）</p></div>

      <div className="bg-white rounded-xl border p-6 space-y-4">
        <h3 className="font-semibold">LLM 模型</h3>
        <select value={model} onChange={e => setModel(e.target.value)} className="w-full border rounded-lg p-2.5 text-sm">
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <h3 className="font-semibold">预估费用</h3>
        <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">{cost || '计算中...'}</div>
        <p className="text-xs text-gray-400">实际费用取决于场景数量与转换质量，通常不超过 0.1 元</p>
      </div>

      <button onClick={startConversion} className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium">开始转换</button>
    </div>
  );
}
