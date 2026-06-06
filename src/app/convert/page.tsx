'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const PHASE_LABELS = ['', '分析中', '场景切割中', '转换中', '合并校验中'];
const PHASE_PCT = [0, 10, 30, 50, 80];

export default function ConvertPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<Array<{ level: string; message: string }>>([]);
  const [subProgress, setSubProgress] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    const jid = sessionStorage.getItem('jobId');
    if (!jid) { router.push('/'); return; }
    setJobId(jid);

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/pipeline/status/${jid}`);
        const data = await res.json();
        if (!res.ok) { clearInterval(poll); return; }

        setStatus(data.status);
        setPhase(data.currentPhase || 0);
        setProgress(data.progress || 0);
        setLogs((data.logs || []).slice(-30));
        if (data.subProgress) setSubProgress(`场景 ${data.subProgress.completedScenes}/${data.subProgress.totalScenes}`);

        if (data.status === 'completed') { clearInterval(poll); setTimeout(() => router.push(`/result/${jid}`), 1000); }
        if (data.status === 'failed') { clearInterval(poll); }
      } catch {}
    }, 1500);

    return () => clearInterval(poll);
  }, [router]);

  const cancel = async () => {
    if (!jobId) return;
    await fetch(`/api/pipeline/cancel/${jobId}`, { method: 'POST' });
    router.push('/');
  };

  const phaseNames = ['分析角色与地点', '场景切割', '场景转换', '合并校验'];
  const phaseIcons = ['🔍', '✂️', '🎬', '✅'];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
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
          {status === 'failed' && jobId && (
            <button onClick={async () => { await fetch(`/api/pipeline/resume/${jobId}`, { method: 'POST' }); }} className="px-6 py-2.5 bg-yellow-500 text-white rounded-xl hover:bg-yellow-600 text-sm">恢复任务</button>
          )}
        </div>
      </div>
    </div>
  );
}
