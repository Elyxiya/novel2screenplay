'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { historyStore } from '@/lib/store/history-store';

interface Chapter {
  index: number; title: string; paragraphCount: number; text: string;
}

type UploadTab = 'novel' | 'yaml';

export default function UploadPage() {
  const router = useRouter();
  const [tab, setTab] = useState<UploadTab>('novel');
  const [text, setText] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [projectTitle, setProjectTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  // YAML tab state
  const [yamlContent, setYamlContent] = useState('');
  const [yamlPreview, setYamlPreview] = useState<{ title: string; totalScenes: number; totalCharacters: number; totalLocations: number } | null>(null);
  const [yamlError, setYamlError] = useState('');

  /** Parse a Zod error details array into a human-readable string */
  const formatYamlError = (details: unknown): string => {
    if (!Array.isArray(details)) return String(details);
    return details.map((e: { path?: (string | number)[]; message?: string }, i: number) => {
      const loc = e.path ? `在 ${e.path.join(' → ')}` : `问题 ${i + 1}`;
      return `${loc}：${e.message ?? JSON.stringify(e)}`;
    }).join('\n');
  };

  const handleUpload = useCallback(async (content: string, rawFile?: File) => {
    setLoading(true); setError('');
    const formData = new FormData();
    if (rawFile) { formData.append('file', rawFile); }
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
    await handleUpload('', file);
  }, [handleUpload]);

  const handlePaste = useCallback(async () => {
    if (!text.trim()) { setError('请粘贴文本'); return; }
    await handleUpload(text);
  }, [text, handleUpload]);

  const startConversion = () => {
    sessionStorage.setItem('novelData', JSON.stringify({
      novelText: chapters.map(c => c.text).join('\n\n'),
      title: projectTitle,
      chapters,
    }));
    router.push('/configure');
  };

  // ── YAML upload handlers ──

  const handleYamlFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'yaml' && ext !== 'yml') {
      setYamlError('仅支持 .yaml 或 .yml 文件');
      setYamlPreview(null);
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setYamlError('文件超过 5MB');
      setYamlPreview(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      setYamlContent(content);
      setYamlError('');
      setYamlPreview(null);
      // Live validation: parse without saving
      const res = await fetch('/api/import/yaml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: content, dryRun: true }),
      });
      const data = await res.json();
      if (data.success) {
        setYamlPreview(data.preview);
      } else {
        setYamlError(data.error + (data.details ? '\n' + formatYamlError(data.details) : ''));
      }
    };
    reader.readAsText(file);
  }, []);

  const handleYamlDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleYamlFile(f);
  }, [handleYamlFile]);

  const handleYamlImport = async () => {
    if (!yamlContent || yamlError) return;
    setLoading(true);
    try {
      const res = await fetch('/api/import/yaml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: yamlContent }),
      });
      const data = await res.json();
      if (data.success) {
        historyStore.add({
          jobId: data.jobId,
          title: data.preview?.title ?? '剧本',
          sourceNovel: '',
          totalScenes: data.preview?.totalScenes ?? 0,
          totalCharacters: data.preview?.totalCharacters ?? 0,
          totalLocations: data.preview?.totalLocations ?? 0,
          author: '',
        });
        router.push(`/result/${data.jobId}`);
      } else {
        setYamlError(data.error + (data.details ? '\n' + formatYamlError(data.details) : ''));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-bold">上传小说</h2><p className="text-gray-500 mt-1"></p></div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => { setTab('novel'); setError(''); setYamlError(''); setYamlPreview(null); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'novel' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          上传小说
        </button>
        <button
          onClick={() => { setTab('yaml'); setError(''); setYamlError(''); setYamlPreview(null); }}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === 'yaml' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
        >
          上传 YAML
        </button>
      </div>

      {tab === 'novel' ? (
        <>
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
        </>
      ) : (
        <>
          {yamlError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
              <p className="font-medium">YAML 格式校验失败</p>
              <pre className="text-xs mt-2 whitespace-pre-wrap">{yamlError}</pre>
            </div>
          )}

          {yamlPreview && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded text-sm">
              <p className="font-medium">校验通过 ✓</p>
              <p className="text-sm mt-1">
                《{yamlPreview.title}》— {yamlPreview.totalScenes} 场景 / {yamlPreview.totalCharacters} 角色 / {yamlPreview.totalLocations} 地点
              </p>
            </div>
          )}

          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleYamlDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
          >
            <div className="text-4xl mb-3">📋</div>
            <p className="text-gray-600 font-medium">拖拽 .yaml 文件到此处</p>
            <input type="file" accept=".yaml,.yml" className="hidden" id="yamlFileInput"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleYamlFile(f); }} />
            <button onClick={() => document.getElementById('yamlFileInput')?.click()}
              className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              选择 YAML 文件
            </button>
            <p className="text-xs text-gray-400 mt-3">支持 .yaml 和 .yml 格式，文件需符合剧本 schema 规范</p>
          </div>

          {yamlContent && (
            <div className="flex flex-col gap-3">
              <div className="text-sm text-gray-500">
                已加载 {yamlContent.split('\n').length} 行
              </div>
              <textarea
                value={yamlContent}
                onChange={e => setYamlContent(e.target.value)}
                rows={10}
                className="w-full border rounded-xl p-4 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="或者在此粘贴 YAML 内容..."
              />
              <button
                onClick={handleYamlImport}
                disabled={loading || !!yamlError || !yamlPreview}
                className="w-full py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 font-medium"
              >
                {loading ? '导入中...' : '导入并查看'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
