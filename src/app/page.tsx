'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Chapter {
  index: number; title: string; paragraphCount: number; text: string;
}

export default function UploadPage() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [projectTitle, setProjectTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleUpload = useCallback(async (content: string, name?: string) => {
    setLoading(true); setError('');
    const formData = new FormData();
    if (name) { formData.append('file', new Blob([content], { type: 'text/plain' }), name); }
    else { formData.append('text', content); }
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setChapters(data.chapters); setProjectTitle(data.title);
    } catch { setError('上传失败'); }
    finally { setLoading(false); }
  }, []);

  const handleFileDrop = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['txt', 'md'].includes(ext || '')) { setError('仅支持 .txt 文件'); return; }
    if (file.size > 2 * 1024 * 1024) { setError('文件超过 2MB'); return; }
    setText(await file.text());
    await handleUpload(await file.text(), file.name);
  }, [handleUpload]);

  const handlePaste = useCallback(async () => {
    if (!text.trim()) { setError('请粘贴文本'); return; }
    await handleUpload(text);
  }, [text, handleUpload]);

  const startConversion = () => {
    sessionStorage.setItem('novelData', JSON.stringify({
      novelText: chapters.map(c => c.text).join('\n\n'),
      title: projectTitle,
    }));
    router.push('/configure');
  };

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-bold">上传小说</h2><p className="text-gray-500 mt-1">上传 .txt 文件或粘贴文本，至少 3 章</p></div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>}
      {chapters.length === 0 ? (<>
        <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileDrop(f); }}
          className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}>
          <div className="text-4xl mb-3">📄</div>
          <p className="text-gray-600 font-medium">拖拽 .txt 文件到此处</p>
          <input type="file" accept=".txt,.md" className="hidden" id="fileInput" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileDrop(f); }} />
          <button onClick={() => document.getElementById('fileInput')?.click()} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40" disabled={loading}>
            {loading ? '处理中...' : '选择文件'}</button>
        </div>
        <div className="relative"><div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div><div className="relative flex justify-center"><span className="bg-gray-50 px-3 text-sm text-gray-400">或直接粘贴</span></div></div>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="在此粘贴小说文本..." rows={10}
          className="w-full border rounded-xl p-4 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={handlePaste} disabled={loading || !text.trim()}
          className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 font-medium">
          {loading ? '处理中...' : '解析章节'}</button>
      </>) : (
        <div className="bg-white rounded-xl border p-6 space-y-4">
          <h3 className="font-bold text-lg">{projectTitle}</h3>
          <p className="text-sm text-gray-500">检测到 {chapters.length} 个章节</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {chapters.map((ch, i) => (
              <div key={i} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg text-sm">
                <span className="text-gray-400 w-6 text-right">{i + 1}</span>
                <span className="font-medium">{ch.title}</span>
                <span className="text-gray-400 text-xs ml-auto">{ch.paragraphCount} 段</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setChapters([]); setText(''); }} className="px-6 py-2.5 border rounded-xl hover:bg-gray-50">重新选择</button>
            <button onClick={startConversion} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium">开始转换</button>
          </div>
        </div>
      )}
    </div>
  );
}
