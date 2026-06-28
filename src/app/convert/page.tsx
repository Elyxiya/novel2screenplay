'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { historyStore } from '@/lib/store/history-store';

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
    // 关闭现有连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    console.log(`[ConvertPage] 连接 SSE: ${jobId}`);

    const eventSource = new EventSource(`/api/pipeline/stream/${jobId}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log(`[ConvertPage] SSE 连接已建立`);
      reconnectAttempts.current = 0;
      setError(null);
    };

    eventSource.onerror = () => {
      console.log(`[ConvertPage] SSE 连接错误`);
      eventSource.close();

      // 自动重连逻辑
      if (reconnectAttempts.current < 5) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        console.log(`[ConvertPage] ${delay}ms 后重连...`);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttempts.current++;
          connectSSE(jobId);
        }, delay);
      } else {
        setError('SSE 连接断开，切换到轮询模式');
        // 降级到轮询
        startPolling(jobId);
      }
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
    });

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
    eventSource.addEventListener('error', () => {
      console.error('[ConvertPage] SSE 连接错误');
      // 切换到轮询模式
      startPolling(jobId);
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
      console.log('[ConvertPage] 无 jobId, 跳转回首页');
      router.push('/');
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
    router.push('/');
  };

  const phaseNames = ['分析角色与地点', '场景切割', '场景转换', '合并校验'];
  const phaseIcons = ['🔍', '✂️', '🎬', '✅'];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/configure')} className="text-gray-400 hover:text-gray-600 transition-colors text-sm">‹ 返回配置</button>
      </div>
      <h2 className="text-2xl font-bold">转换进度</h2>

      <div className="bg-white rounded-xl border p-6 space-y-6">
        {/* Stepper */}
        <div className="flex justify-between">
          {phaseNames.map((name, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-colors shrink-0
                ${phase > i + 1 ? 'bg-green-500 text-white' : phase === i + 1 ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                {phase > i + 1 ? '✓' : phaseIcons[i]}
              </div>
              <span className={`text-xs text-center leading-tight ${phase === i + 1 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{name}</span>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div className="bg-blue-600 h-full rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-sm text-gray-500 text-center">
          {PHASE_LABELS[phase] || '等待中...'}
          {subProgress && `(${subProgress})`}
          {error && <span className="text-red-500 ml-2">⚠️ {error}</span>}
        </p>

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
