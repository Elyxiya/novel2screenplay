'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { historyStore } from '@/lib/store/history-store';
import { RequireAuth } from '@/components/RequireAuth';

const PHASE_LABELS = ['', '分析中', '场景切割中', '转换中', '合并校验中'];

interface SSELog {
  level: string;
  message: string;
}

interface SSEInitData {
  jobId: string;
  status: string;
  currentPhase: number;
  progress: number;
  subProgress: { totalScenes: number; completedScenes: number } | null;
  scenesStatus: Array<{ sceneIndex: number; status: string }>;
  logs: SSELog[];
}

export default function ConvertPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState(0);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<SSELog[]>([]);
  const [subProgress, setSubProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  const connectSSE = useCallback((jobId: string) => {
    // 清理现有连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    console.log(`[ConvertPage] 连接 SSE: ${jobId}`);

    const eventSource = new EventSource(`/api/pipeline/stream/${jobId}`);
    eventSourceRef.current = eventSource;
    reconnectAttempts.current = 0;

    eventSource.onopen = () => {
      console.log(`[ConvertPage] SSE 连接已建立`);
      setError(null);
    };

    eventSource.onerror = () => {
      // 等待 onclose 后再决定是否重连
      setTimeout(() => {
        if (eventSourceRef.current?.readyState === EventSource.CLOSED) {
          if (reconnectAttempts.current < 5) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
            console.log(`[ConvertPage] ${delay}ms 后重连 (${reconnectAttempts.current + 1}/5)...`);
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectAttempts.current++;
              connectSSE(jobId);
            }, delay);
          } else {
            setError('连接断开，切换到轮询模式');
            startPolling(jobId);
          }
        }
      }, 100);
    };

    // 处理 init 事件
    eventSource.addEventListener('init', (e) => {
      try {
        const data = JSON.parse(e.data) as SSEInitData;
        console.log('[ConvertPage] 收到 init:', data.status);
        setStatus(data.status);
        setPhase(data.currentPhase || 0);
        setProgress(data.progress || 0);
        setLogs(data.logs?.slice(-30) || []);
        if (data.subProgress) {
          setSubProgress(`场景 ${data.subProgress.completedScenes}/${data.subProgress.totalScenes}`);
        }
      } catch (err) {
        console.error('[ConvertPage] 解析 init 失败:', err);
      }
    }, { once: true }); // 只处理一次

    // 处理 progress 事件
    eventSource.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('[ConvertPage] 收到 progress:', data.data.progress);
        setProgress(data.data.progress);
      } catch (err) {
        console.error('[ConvertPage] 解析 progress 失败:', err);
      }
    });

    // 处理 phase 事件
    eventSource.addEventListener('phase', (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('[ConvertPage] 收到 phase:', data.data.phase, data.data.status);
        setPhase(data.data.phase);
        setStatus(data.data.status);
      } catch (err) {
        console.error('[ConvertPage] 解析 phase 失败:', err);
      }
    });

    // 处理 log 事件
    eventSource.addEventListener('log', (e) => {
      try {
        const data = JSON.parse(e.data);
        const log = data.data as SSELog;
        console.log('[ConvertPage] 收到 log:', log.message);
        setLogs((prev) => [...prev.slice(-29), log]);
      } catch (err) {
        console.error('[ConvertPage] 解析 log 失败:', err);
      }
    });

    // 处理 complete 事件
    eventSource.addEventListener('complete', async (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('[ConvertPage] 收到 complete:', data.data);
        setStatus('completed');
        setProgress(100);

        // 保存到历史记录
        try {
          const r = await fetch(`/api/result/${jobId}`);
          const d = await r.json();
          if (d.screenplay?.metadata) {
            historyStore.add({
              jobId,
              title: d.screenplay.metadata.title,
              sourceNovel: d.screenplay.metadata.sourceNovel,
              totalScenes: d.screenplay.metadata.totalScenes,
              totalCharacters: d.screenplay.metadata.totalCharacters,
              totalLocations: d.screenplay.metadata.totalLocations,
              author: d.screenplay.metadata.author ?? '',
            });
          }
        } catch {
          // non-critical
        }

        eventSource.close();
        setTimeout(() => router.push(`/result/${jobId}`), 1000);
      } catch (err) {
        console.error('[ConvertPage] 解析 complete 失败:', err);
      }
    });

    // 处理 error 事件
    eventSource.addEventListener('error', (e: MessageEvent) => {
      console.error('[ConvertPage] SSE 任务错误:', e.data);
      // 不在这里切换到轮询，等待连接关闭
    });
  }, [router]);

  // 降级轮询函数
  const startPolling = useCallback((jobId: string) => {
    console.log('[ConvertPage] 启动降级轮询模式');

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/pipeline/status/${jobId}`);
        const data = await res.json();

        setStatus(data.status);
        setPhase(data.currentPhase || 0);
        setProgress(data.progress || 0);
        setLogs((data.logs || []).slice(-30));
        if (data.subProgress) {
          setSubProgress(`场景 ${data.subProgress.completedScenes}/${data.subProgress.totalScenes}`);
        }

        if (data.status === 'completed') {
          clearInterval(poll);
          setTimeout(() => router.push(`/result/${jobId}`), 1000);
        }
        if (data.status === 'failed') {
          setError(data.error);
          clearInterval(poll);
        }
      } catch {
        // ignore
      }
    }, 1500);

    return poll;
  }, [router]);

  useEffect(() => {
    const jid = typeof window !== 'undefined' ? sessionStorage.getItem('jobId') : null;
    console.log('[ConvertPage] 初始化, jobId:', jid);
    if (!jid) {
      console.log('[ConvertPage] 无 jobId, 跳转回上传页');
      router.push('/upload');
      return;
    }

    // 优先使用 SSE
    connectSSE(jid);

    return () => {
      console.log('[ConvertPage] 清理 SSE 连接');
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = async () => {
    const jid = typeof window !== 'undefined' ? sessionStorage.getItem('jobId') : null;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (jid) await fetch(`/api/pipeline/cancel/${jid}`, { method: 'POST' });
    sessionStorage.removeItem('jobId');
    sessionStorage.removeItem('novelData');
    router.push('/upload');
  };

  const phaseNames = ['分析角色与地点', '场景切割', '场景转换', '合并校验'];
  const phaseIcons = ['🔍', '✂️', '🎬', '✅'];

  return (
    <RequireAuth>
    <div className="space-y-6 animate-float-up">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/configure')} className="glow-btn-ghost !px-3 !py-1.5 text-xs">‹ 返回配置</button>
        <span className="tech-tag">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          第 3 步 · AI 转换中
        </span>
      </div>
      <h2 className="text-2xl font-bold text-slate-900">转换进度</h2>

      <div className="glass-card p-6 space-y-6">
        {/* Stepper */}
        <div className="relative flex justify-between">
          {phaseNames.map((name, i) => {
            const stepNum = i + 1;
            const isDone = phase > stepNum || (status === 'completed' && phase === 4);
            const isActive = phase === stepNum && !isDone;
            return (
              <div key={i} className="flex-1 flex items-center last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`step-badge ${
                      isDone
                        ? 'step-badge-done'
                        : isActive
                          ? 'step-badge-active'
                          : 'step-badge-idle'
                    }`}
                  >
                    {isDone ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : phaseIcons[i]}
                  </div>
                  <span className={`text-xs text-center leading-tight ${isActive ? 'text-indigo-600 font-semibold' : isDone ? 'text-slate-600' : 'text-slate-400'}`}>
                    {name}
                  </span>
                </div>
                {i < phaseNames.length - 1 && (
                  <span className={`step-connector ${isDone ? 'step-connector-done' : ''}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-slate-200/70 rounded-full h-2.5 overflow-hidden">
          <div className="progress-flow h-full rounded-full" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-sm text-slate-500 text-center flex items-center justify-center gap-2">
          {status === 'completed' ? (
            <span className="text-emerald-600 font-medium flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              转换完成，即将跳转结果页...
            </span>
          ) : (
            <>
              <svg className="w-4 h-4 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="font-medium text-slate-700">{PHASE_LABELS[phase] || '等待中...'}</span>
              {subProgress && <span className="text-cyan-600 font-mono">({subProgress})</span>}
            </>
          )}
          {error && <span className="text-red-500">⚠️ {error}</span>}
        </p>

        {/* Logs */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 rounded-full bg-red-400/80" />
            <span className="w-3 h-3 rounded-full bg-yellow-400/80" />
            <span className="w-3 h-3 rounded-full bg-emerald-400/80" />
            <span className="text-xs text-slate-400 ml-2 font-mono">pipeline.log</span>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-500 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {status === 'completed' ? 'completed' : 'streaming'}
            </span>
          </div>
          <div className="terminal-panel p-4 h-60 overflow-y-auto space-y-1">
            {logs.length === 0 && <p className="text-slate-500">等待任务开始...</p>}
            {logs.map((log, i) => (
              <div key={i} className={`${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-slate-300'}`}>
                <span className="text-slate-600 select-none mr-2">›</span>
                {log.message}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={cancel} className="glow-btn-ghost !text-red-500 !border-red-200 hover:!border-red-400 hover:!text-red-600">取消转换</button>
          {status === 'failed' && (
            <button onClick={async () => {
              const jid = typeof window !== 'undefined' ? sessionStorage.getItem('jobId') : null;
              if (jid) await fetch(`/api/pipeline/resume/${jid}`, { method: 'POST' });
            }} className="glow-btn">恢复任务</button>
          )}
        </div>
      </div>
    </div>
    </RequireAuth>
  );
}
