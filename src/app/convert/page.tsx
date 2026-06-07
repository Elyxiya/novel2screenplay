'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { historyStore } from '@/lib/store/history-store';

const PHASE_LABELS = ['', '分析中', '场景切割中', '转换中', '合并校验中'];

export default function ConvertPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<Array<{ level: string; message: string }>>([]);
  const [subProgress, setSubProgress] = useState('');

  useEffect(() => {
    // Read jobId from sessionStorage inside the effect (not in useState initializer)
    // so it survives React 18 StrictMode mount→unmount→remount cycle.
    const jid = typeof window !== 'undefined' ? sessionStorage.getItem('jobId') : null;
    console.log('[ConvertPage] 初始化, jobId:', jid);
    if (!jid) { console.log('[ConvertPage] 无 jobId, 跳转回首页'); router.push('/'); return; }

    const poll = setInterval(async () => {
      try {
        const t0 = performance.now();
        const res = await fetch(`/api/pipeline/status/${jid}`);
        const data = await res.json();
        const elapsed = Math.round(performance.now() - t0);
        console.log(`[ConvertPage] 轮询 ${jid}: status=${data.status} phase=${data.currentPhase} progress=${data.progress} logs=${data.logs?.length ?? 0} (${elapsed}ms)`);
        if (!res.ok) { console.log('[ConvertPage] 状态 API 返回错误:', res.status, data); clearInterval(poll); return; }

        setStatus(data.status);
        setPhase(data.currentPhase || 0);
        setProgress(data.progress || 0);
        setLogs((data.logs || []).slice(-30));
        if (data.subProgress) setSubProgress(`场景 ${data.subProgress.completedScenes}/${data.subProgress.totalScenes}`);

        if (data.status === 'completed') {
          console.log('[ConvertPage] 任务完成!');
          clearInterval(poll);
          // Save to history before redirecting
          try {
            const r = await fetch(`/api/result/${jid}`);
            const d = await r.json();
            if (d.screenplay?.metadata) {
              historyStore.add({
                jobId: jid,
                title: d.screenplay.metadata.title,
                sourceNovel: d.screenplay.metadata.sourceNovel,
                totalScenes: d.screenplay.metadata.totalScenes,
                totalCharacters: d.screenplay.metadata.totalCharacters,
                totalLocations: d.screenplay.metadata.totalLocations,
                author: d.screenplay.metadata.author ?? '',
              });
            }
          } catch {
            // non-critical, don't block redirect
          }
          setTimeout(() => router.push(`/result/${jid}`), 1000);
        }
        if (data.status === 'failed') { console.log('[ConvertPage] 任务失败:', data.error); clearInterval(poll); }
      } catch (err) { console.log('[ConvertPage] 轮询错误:', err); /* ignore poll errors */ }
    }, 1500);

    return () => { console.log('[ConvertPage] 停止轮询'); clearInterval(poll); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = async () => {
    const jid = typeof window !== 'undefined' ? sessionStorage.getItem('jobId') : null;
    if (jid) await fetch(`/api/pipeline/cancel/${jid}`, { method: 'POST' });
    sessionStorage.removeItem('jobId');
    sessionStorage.removeItem('novelData');
    router.push('/');
  };

  const phaseNames = ['分析角色与地点', '场景切割', '场景转换', '合并校验'];
  const phaseIcons = ['🔍', '✂️', '🎬', '✅'];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/configure')} className="text-gray-400 hover:text-gray-600 transition-colors text-sm">‹ 返回配置</button>
      </div>
      <h2 className="text-2xl font-bold">转换进度</h2>

      <div className="bg-white rounded-xl border p-6 space-y-6">
        {/* Stepper */}
        <div className="flex justify-between">
          {phaseNames.map((name, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors
                ${phase > i + 1 ? 'bg-green-500 text-white' : phase === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                {phase > i + 1 ? '✓' : phaseIcons[i]}
              </div>
              <span className={`text-xs ${phase === i + 1 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{name}</span>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div className="bg-blue-600 h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-sm text-gray-500 text-center">{PHASE_LABELS[phase] || '等待中...'} {subProgress && `(${subProgress})`}</p>

        {/* Logs */}
        <div className="bg-gray-900 text-gray-100 rounded-xl p-4 h-60 overflow-y-auto font-mono text-xs space-y-1">
          {logs.length === 0 && <p className="text-gray-500">等待任务开始...</p>}
          {logs.map((log, i) => (
            <div key={i} className={`${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-gray-300'}`}>
              {log.message}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={cancel} className="px-6 py-2.5 border border-red-200 text-red-600 rounded-xl hover:bg-red-50 text-sm">取消转换</button>
          {status === 'failed' && (
            <button onClick={async () => {
              const jid = typeof window !== 'undefined' ? sessionStorage.getItem('jobId') : null;
              if (jid) await fetch(`/api/pipeline/resume/${jid}`, { method: 'POST' });
            }} className="px-6 py-2.5 bg-yellow-500 text-white rounded-xl hover:bg-yellow-600 text-sm">恢复任务</button>
          )}
        </div>
      </div>
    </div>
  );
}
