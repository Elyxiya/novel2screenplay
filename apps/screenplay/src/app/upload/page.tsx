'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { historyStore } from '@/lib/store/history-store';
import { QuickStats } from '@/components/QuickStats';
import { RequireAuth } from '@/components/RequireAuth';

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
  const [novelId, setNovelId] = useState<string | null>(null);
  const [convertedChapters, setConvertedChapters] = useState<number[]>([]);
  const [appendedCount, setAppendedCount] = useState(0);
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
      if (res.status === 401) {
        setError('请先登录后再上传');
        setTimeout(() => router.push('/auth/login?next=/upload'), 1200);
        return;
      }
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setChapters(data.chapters); setProjectTitle(data.title);
      if (data.novelId) setNovelId(data.novelId);
      setConvertedChapters(data.convertedChapters ?? []);
      setAppendedCount(data.appended ?? 0);
    } catch { setError('上传失败'); }
    finally { setLoading(false); }
  }, [router]);

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
      novelId: novelId || undefined,
      convertedChapters: convertedChapters.length ? convertedChapters : undefined,
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
    <RequireAuth>
    <div className="space-y-6 animate-float-up">
      {/* Hero 引导区 */}
      <div className="relative rounded-2xl overflow-hidden glass-card p-8 sm:p-10">
        <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="tech-tag">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              AI 驱动
            </span>
            <span className="tech-tag tech-tag-cyan">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              自动章节识别
            </span>
            <span className="tech-tag">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              场景化重构
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            上传小说，生成<span className="neon-text">专业剧本</span>
          </h2>
          <p className="text-slate-500 mt-3 max-w-xl text-sm sm:text-base leading-relaxed">
            三步完成：上传小说 → 选择章节与模型 → AI 转换。自动完成角色/地点识别、场景切割与剧本格式重构，全流程可视化。
          </p>
        </div>
      </div>

      {/* Tab 切换器 */}
      <div className="flex gap-1 bg-white/70 backdrop-blur border border-slate-200/70 rounded-xl p-1 w-fit shadow-sm">
        <button
          onClick={() => { setTab('novel'); setError(''); setYamlError(''); setYamlPreview(null); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 flex items-center gap-1.5 ${tab === 'novel' ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-300/40' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          上传小说
        </button>
        <button
          onClick={() => { setTab('yaml'); setError(''); setYamlError(''); setYamlPreview(null); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 flex items-center gap-1.5 ${tab === 'yaml' ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-300/40' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h6" />
          </svg>
          上传 YAML
        </button>
      </div>

      {/* Quick stats */}
      <QuickStats />

      {tab === 'novel' ? (
        <>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">{error}</div>}
          {chapters.length === 0 ? (<>
            <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileDrop(f); }}
              className={`dropzone-tech p-12 text-center cursor-pointer ${dragOver ? 'dropzone-tech-active' : ''}`}>
              {/* 光晕装饰 */}
              <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-72 h-24 rounded-full bg-cyan-400/20 blur-3xl" />
              <div className="relative mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600/10 to-cyan-400/10 border border-indigo-200/60 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-slate-600 font-medium">拖拽 .txt / .md 文件到此处</p>
              <p className="text-xs text-slate-400 mt-1">支持最大 2MB · 自动识别章节结构</p>
              <input type="file" accept=".txt,.md" className="hidden" id="fileInput" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileDrop(f); }} />
              <button onClick={() => document.getElementById('fileInput')?.click()} className="glow-btn mt-5" disabled={loading}>
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    解析中...
                  </>
                ) : '选择文件'}
              </button>
            </div>
            <div className="relative"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div><div className="relative flex justify-center"><span className="bg-transparent px-3 text-sm text-slate-400">或直接粘贴</span></div></div>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder="在此粘贴小说文本..." rows={10}
              className="tech-input resize-y" />
            <button onClick={handlePaste} disabled={loading || !text.trim()} className="glow-btn w-full py-3">
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  解析中...
                </>
              ) : '解析章节'}
            </button>
          </>) : (
            <div className="glass-card p-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-400 text-white shadow-lg shadow-emerald-200/60">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <div>
                  <h3 className="font-bold text-lg text-slate-900">{projectTitle}</h3>
                  <p className="text-sm text-slate-500">检测到 <span className="font-mono font-semibold text-cyan-600">{chapters.length}</span> 个章节</p>
                </div>
              </div>
              {novelId && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200/70 text-indigo-700">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    已并入工作台资产
                  </span>
                  {convertedChapters.length > 0 && (
                    <span className="text-slate-500">已转换 <span className="font-mono font-semibold text-emerald-600">{convertedChapters.length}</span>/{chapters.length} 章，续转默认选未转换章节</span>
                  )}
                  {appendedCount > 0 && (
                    <span className="text-cyan-700">本次新增 <span className="font-mono font-semibold">{appendedCount}</span> 章</span>
                  )}
                </div>
              )}
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {chapters.map((ch, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 bg-white/70 border border-slate-100 rounded-lg text-sm hover:border-cyan-300/50 transition-colors">
                    <span className="font-mono text-slate-400 w-6 text-right">{String(i + 1).padStart(2, '0')}</span>
                    <span className="font-medium text-slate-700">{ch.title}</span>
                    <span className="text-slate-400 text-xs ml-auto">{ch.paragraphCount} 段</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setChapters([]); setText(''); setNovelId(null); setConvertedChapters([]); setAppendedCount(0); }} className="glow-btn-ghost">重新选择</button>
                <button onClick={startConversion} className="glow-btn flex-1 py-3">
                  开始转换
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {yamlError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              <p className="font-medium">YAML 格式校验失败</p>
              <pre className="text-xs mt-2 whitespace-pre-wrap">{yamlError}</pre>
            </div>
          )}

          {yamlPreview && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-sm">
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
            className={`dropzone-tech p-12 text-center cursor-pointer ${dragOver ? 'dropzone-tech-active' : ''}`}
          >
            <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 w-72 h-24 rounded-full bg-indigo-400/20 blur-3xl" />
            <div className="relative mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600/10 to-cyan-400/10 border border-indigo-200/60 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
              </svg>
            </div>
            <p className="text-slate-600 font-medium">拖拽 .yaml 文件到此处</p>
            <input type="file" accept=".yaml,.yml" className="hidden" id="yamlFileInput"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleYamlFile(f); }} />
            <button onClick={() => document.getElementById('yamlFileInput')?.click()}
              className="glow-btn-ghost mt-5">
              选择 YAML 文件
            </button>
            <p className="text-xs text-slate-400 mt-3">支持 .yaml 和 .yml 格式，文件需符合剧本 schema 规范</p>
          </div>

          {yamlContent && (
            <div className="flex flex-col gap-3">
              <div className="text-sm text-slate-500">
                已加载 <span className="font-mono font-semibold text-cyan-600">{yamlContent.split('\n').length}</span> 行
              </div>
              <textarea
                value={yamlContent}
                onChange={e => setYamlContent(e.target.value)}
                rows={10}
                className="tech-input font-mono resize-y"
                placeholder="或者在此粘贴 YAML 内容..."
              />
              <button
                onClick={handleYamlImport}
                disabled={loading || !!yamlError || !yamlPreview}
                className="glow-btn w-full py-3"
              >
                {loading ? '导入中...' : '导入并查看'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
    </RequireAuth>
  );
}
