'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type JobStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface JobProgress {
  id: string;
  status: JobStatus;
  progress: number;
  subProgress?: string;
  currentPhase?: {
    id: string;
    name: string;
    status: string;
  };
  error?: string;
  output?: unknown;
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface ProgressTrackerProps {
  jobId: string;
  onComplete?: (job: JobProgress) => void;
  onError?: (error: string) => void;
  showLogs?: boolean;
  className?: string;
}

interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/**
 * 实时进度追踪器组件
 * 支持 SSE 实时推送和轮询降级
 */
export function ProgressTracker({
  jobId,
  onComplete,
  onError,
  showLogs = true,
  className = '',
}: ProgressTrackerProps) {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((prev) => [...prev.slice(-49), { timestamp: Date.now(), level, message }]);
  }, []);

  // SSE 连接
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    addLog('info', `连接 SSE...`);
    const eventSource = new EventSource(`/api/jobs/${jobId}/events`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setConnected(true);
      reconnectAttempts.current = 0;
      addLog('info', `SSE 连接已建立`);
    };

    eventSource.onerror = () => {
      setConnected(false);
      eventSource.close();

      if (reconnectAttempts.current < 5) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        addLog('warn', `SSE 连接断开，${delay}ms 后重连...`);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttempts.current++;
          connectSSE();
        }, delay);
      } else {
        addLog('error', `SSE 重连失败，切换到轮询模式`);
        startPolling();
      }
    };

    // 处理消息
    eventSource.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data);
        setProgress(data);

        if (data.subProgress) {
          addLog('info', data.subProgress);
        }

        if (data.status === 'completed') {
          addLog('info', `任务完成！`);
          eventSource.close();
          onComplete?.(data);
        } else if (data.status === 'failed') {
          addLog('error', `任务失败: ${data.error}`);
          onError?.(data.error || 'Unknown error');
        }
      } catch {
        // 忽略解析错误
      }
    });
  }, [jobId, addLog, onComplete, onError]);

  // 轮询降级
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    addLog('info', `启动轮询模式`);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();

        if (data.job) {
          setProgress(data.job);

          if (data.job.status === 'completed') {
            clearInterval(pollIntervalRef.current!);
            addLog('info', `任务完成！`);
            onComplete?.(data.job);
          } else if (data.job.status === 'failed') {
            clearInterval(pollIntervalRef.current!);
            addLog('error', `任务失败: ${data.job.error}`);
            onError?.(data.job.error || 'Unknown error');
          }
        }
      } catch {
        // 忽略轮询错误
      }
    }, 1500);
  }, [jobId, addLog, onComplete, onError]);

  useEffect(() => {
    // 初始获取
    fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.job) {
          setProgress(d.job);
          if (d.job.status === 'completed') {
            onComplete?.(d.job);
            return;
          }
          if (d.job.status === 'failed') {
            onError?.(d.job.error || 'Unknown error');
            return;
          }
        }
        // 启动 SSE
        connectSSE();
      })
      .catch(() => {
        addLog('error', `无法获取任务状态`);
      });

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [jobId, connectSSE, addLog, onComplete, onError]);

  // 进度阶段
  const phases = [
    { id: 'segment', name: '分节', icon: '✂️' },
    { id: 'analyze', name: '分析', icon: '🔍' },
    { id: 'convert', name: '转换', icon: '🎬' },
    { id: 'validate', name: '验证', icon: '✅' },
  ];

  const currentPhaseIndex = progress?.currentPhase
    ? phases.findIndex((p) => p.id === progress.currentPhase?.id)
    : -1;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 连接状态 */}
      <div className="flex items-center gap-2 text-xs">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500'}`} />
        <span className="text-gray-500">{connected ? '实时连接' : '轮询模式'}</span>
        {progress?.tokenUsage && (
          <span className="ml-auto text-gray-400">
            {progress.tokenUsage.total.toLocaleString()} tokens
          </span>
        )}
      </div>

      {/* 阶段指示器 */}
      <div className="flex justify-between">
        {phases.map((phase, i) => (
          <div key={phase.id} className="flex flex-col items-center gap-1">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-sm transition-colors
                ${currentPhaseIndex > i ? 'bg-green-500 text-white' : ''}
                ${currentPhaseIndex === i ? 'bg-blue-600 text-white animate-pulse' : ''}
                ${currentPhaseIndex < i ? 'bg-gray-100 text-gray-400' : ''}
              `}
            >
              {currentPhaseIndex > i ? '✓' : phase.icon}
            </div>
            <span
              className={`text-[10px] text-center leading-tight ${
                currentPhaseIndex === i ? 'text-blue-600 font-medium' : 'text-gray-400'
              }`}
            >
              {phase.name}
            </span>
          </div>
        ))}
      </div>

      {/* 进度条 */}
      <div className="space-y-1">
        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div
            className="bg-blue-600 h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progress?.progress || 0}%` }}
          />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">
            {progress?.currentPhase?.name || '等待中...'}
            {progress?.subProgress && ` (${progress.subProgress})`}
          </span>
          <span className="text-gray-400">{progress?.progress || 0}%</span>
        </div>
      </div>

      {/* 错误提示 */}
      {progress?.status === 'failed' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          <p className="font-medium">转换失败</p>
          <p className="text-xs mt-1">{progress.error}</p>
        </div>
      )}

      {/* 日志 */}
      {showLogs && (
        <div className="bg-gray-900 text-gray-100 rounded-xl p-3 h-48 overflow-y-auto font-mono text-xs space-y-0.5">
          {logs.length === 0 && <p className="text-gray-500">等待任务开始...</p>}
          {logs.map((log, i) => (
            <div
              key={i}
              className={`${
                log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-gray-300'
              }`}
            >
              <span className="text-gray-500 mr-2">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              {log.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 简单的进度条组件
 */
export function ProgressBar({
  progress,
  showLabel = true,
  className = '',
}: {
  progress: number;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className="bg-blue-600 h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
      {showLabel && (
        <div className="text-xs text-gray-500 text-right">{progress.toFixed(0)}%</div>
      )}
    </div>
  );
}

/**
 * 阶段进度指示器
 */
export function PhaseIndicator({
  phases,
  currentPhase,
  className = '',
}: {
  phases: Array<{ id: string; name: string; icon: string }>;
  currentPhase?: { id: string; name: string };
  className?: string;
}) {
  const currentIndex = currentPhase
    ? phases.findIndex((p) => p.id === currentPhase.id)
    : -1;

  return (
    <div className={`flex justify-between ${className}`}>
      {phases.map((phase, i) => (
        <div key={phase.id} className="flex flex-col items-center gap-1">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs transition-colors
              ${currentIndex > i ? 'bg-green-500 text-white' : ''}
              ${currentIndex === i ? 'bg-blue-600 text-white' : ''}
              ${currentIndex < i ? 'bg-gray-100 text-gray-400' : ''}
            `}
          >
            {currentIndex > i ? '✓' : phase.icon}
          </div>
          <span
            className={`text-[10px] ${
              currentIndex === i ? 'text-blue-600 font-medium' : 'text-gray-400'
            }`}
          >
            {phase.name}
          </span>
        </div>
      ))}
    </div>
  );
}

export default ProgressTracker;
