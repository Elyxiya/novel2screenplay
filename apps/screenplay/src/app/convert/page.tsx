'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RequireAuth } from '@/components/RequireAuth';

const PHASE_LABELS = ['', '分析中', '场景切割中', '转换中', '合并校验中'];

const PHASES = [
  { no: 1, name: '分析角色与地点', desc: '抽取人物关系与故事场景', icon: 'M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z' },
  { no: 2, name: '场景切割', desc: '按时空事件拆分叙事单元', icon: 'M11 3h10M11 9h7M11 15h10M11 21h5M3 4l4 4-4 4M6 7h1' },
  { no: 3, name: '场景转换', desc: 'AI 逐场景重构为剧本', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
  { no: 4, name: '合并校验', desc: '合并全本并校验剧本结构', icon: 'M5 13l4 4L19 7' },
];

interface SSELog { level: string; message: string; }

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
  const [showLogs, setShowLogs] = useState(false);
  // 小说上下文：从 sessionStorage 读取，让转换页不再是孤立的进度条（惰性初始化，仅在客户端可用）
  const [novelCtx] = useState<{ title: string; chapterCount: number }>(() => {
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('novelData') : null;
      if (raw) {
        const d = JSON.parse(raw) as { title?: string; chapters?: unknown[] };
        return { title: d.title ?? '未命名小说', chapterCount: (d.chapters ?? []).length };
      }
    } catch { /* ignore */ }
    return { title: '', chapterCount: 0 };
  });
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  // 降级轮询函数
  const startPolling = useCallback((jobId: string) => {
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
          setTimeout(() => router.push(`/result/${jobId}`), 1200);
        }
        if (data.status === 'failed') {
          setError(data.error);
          clearInterval(poll);
        }
      } catch { /* ignore */ }
    }, 1500);
    return poll;
  }, [router]);

  const connectSSE = useCallback((jobId: string) => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

    const eventSource = new EventSource(`/api/pipeline/stream/${jobId}`);
    eventSourceRef.current = eventSource;
    reconnectAttempts.current = 0;

    eventSource.onopen = () => { setError(null); };
    eventSource.onerror = () => {
      setTimeout(() => {
        if (eventSourceRef.current?.readyState === EventSource.CLOSED) {
          if (reconnectAttempts.current < 5) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
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

    eventSource.addEventListener('init', (e) => {
      try {
        const data = JSON.parse(e.data) as SSEInitData;
        setStatus(data.status);
        setPhase(data.currentPhase || 0);
        setProgress(data.progress || 0);
        setLogs(data.logs?.slice(-30) || []);
        if (data.subProgress) {
          setSubProgress(`场景 ${data.subProgress.completedScenes}/${data.subProgress.totalScenes}`);
        }
      } catch { /* ignore */ }
    }, { once: true });

    eventSource.addEventListener('progress', (e) => {
      try { setProgress(JSON.parse(e.data).data.progress); } catch { /* ignore */ }
    });

    eventSource.addEventListener('phase', (e) => {
      try {
        const data = JSON.parse(e.data).data;
        setPhase(data.phase);
        setStatus(data.status);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener('log', (e) => {
      try {
        const log = JSON.parse(e.data).data as SSELog;
        setLogs((prev) => [...prev.slice(-29), log]);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener('complete', async () => {
      try {
        setStatus('completed');
        setProgress(100);
        eventSource.close();
        setTimeout(() => router.push(`/result/${jobId}`), 1200);
      } catch { /* ignore */ }
    });

    eventSource.addEventListener('error', () => { /* 连接关闭时处理 */ });
  }, [router, startPolling]);

  useEffect(() => {
    const jid = typeof window !== 'undefined' ? sessionStorage.getItem('jobId') : null;
    if (!jid) {
      router.push('/upload');
      return;
    }
    connectSSE(jid);
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancel = async () => {
    const jid = typeof window !== 'undefined' ? sessionStorage.getItem('jobId') : null;
    if (eventSourceRef.current) eventSourceRef.current.close();
    if (jid) await fetch(`/api/pipeline/cancel/${jid}`, { method: 'POST' });
    sessionStorage.removeItem('jobId');
    sessionStorage.removeItem('novelData');
    router.push('/upload');
  };

  // ── SVG 进度环 ──
  const R = 62;
  const CIRC = 2 * Math.PI * R;
  const offset = CIRC * (1 - Math.min(progress, 100) / 100);
  const pct = Math.round(progress);
  const isCompleted = status === 'completed';

  // ── 当前阶段的视觉状态 ──
  const currentPhase = PHASES.find((p) => p.no === phase)?.name ?? '准备中...';
  const currentPhaseDesc = PHASES.find((p) => p.no === phase)?.desc ?? '正在初始化转换任务';

  return (
    <RequireAuth>
    <div className="max-w-5xl mx-auto space-y-6 animate-float-up px-1">
      {/* 顶栏：标题上下文 + 返回 */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.push('/configure')} className="glow-btn-ghost !px-3 !py-1.5 text-xs">‹ 返回配置</button>
        <span className="tech-tag">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          第 3 步 · AI 转换中
        </span>
        {novelCtx.title && (
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span className="hidden sm:inline text-ink-faint text-xs">当前作品</span>
            <span className="text-sm font-semibold text-ink-text truncate max-w-[200px]">{novelCtx.title}</span>
            {novelCtx.chapterCount > 0 && (
              <span className="text-xs text-[var(--accent)] font-mono shrink-0">{novelCtx.chapterCount} 章</span>
            )}
          </span>
        )}
      </div>

      {/* 主卡片：进度环 + 当前阶段 + 四阶段时间线 */}
      <div className="glass-card overflow-hidden">
        <div className="relative px-6 sm:px-10 py-8 sm:py-10">
          <div className="absolute inset-0 bg-tech-grid opacity-60 pointer-events-none" />
          <div className="relative flex flex-col sm:flex-row items-center gap-8 sm:gap-12">
            {/* 进度环 */}
            <div className="relative w-40 h-40 shrink-0">
              <svg className="w-40 h-40 -rotate-90" viewBox="0 0 160 160">
                <circle cx="80" cy="80" r={R} fill="none" strokeWidth="10" className="text-white/10" stroke="currentColor" />
                <circle
                  cx="80" cy="80" r={R} fill="none" strokeWidth="10"
                  strokeLinecap="round" stroke="url(#ringGrad)"
                  strokeDasharray={CIRC} strokeDashoffset={offset}
                  className="transition-all duration-700 ease-out"
                />
                <defs>
                  <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#c8892f" />
                    <stop offset="100%" stopColor="#e8b04a" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`font-mono text-4xl font-extrabold ${isCompleted ? 'text-emerald-400' : 'neon-text'}`}>{pct}%</span>
                <span className="text-[11px] text-ink-faint mt-1">{isCompleted ? '已完成' : '整体进度'}</span>
              </div>
            </div>

            {/* 当前阶段信息 */}
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2 mb-2">
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                  isCompleted
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : error
                      ? 'bg-red-500/10 text-red-300 border border-red-500/30'
                      : 'bg-[rgba(var(--accent-rgb),0.1)] text-[var(--accent-soft)] border border-[rgba(var(--accent-rgb),0.3)]'
                }`}>
                  {isCompleted ? (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {isCompleted ? '转换完成' : error ? '任务出错' : currentPhase}
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white display-font">
                {isCompleted ? '剧本生成完毕，即将跳转结果页...' : PHASE_LABELS[phase] || '正在初始化转换任务'}
              </h2>
              <p className="text-sm text-ink-muted mt-2 leading-relaxed">
                {error ? error : currentPhaseDesc}
                {subProgress && !error && (
                  <span className="ml-2 inline-flex items-center gap-1.5 text-[var(--accent)] font-mono">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                    </svg>
                    {subProgress}
                  </span>
                )}
              </p>

              {/* 主操作按钮 */}
              <div className="mt-6 flex flex-wrap gap-3 justify-center sm:justify-start">
                {status === 'failed' ? (
                  <button onClick={async () => {
                    const jid = typeof window !== 'undefined' ? sessionStorage.getItem('jobId') : null;
                    if (jid) await fetch(`/api/pipeline/resume/${jid}`, { method: 'POST' });
                  }} className="glow-btn">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115.364-3.364L20 9M20 15a9 9 0 01-15.364 3.364L4 15" />
                    </svg>
                    恢复任务
                  </button>
                ) : (
                  <button onClick={cancel} className="glow-btn-ghost !text-red-400 !border-red-500/40 hover:!border-red-400/70 hover:!text-red-300">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    取消转换
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 四阶段时间线 */}
        <div className="border-t border-white/8 px-6 sm:px-10 py-6 bg-[#121216]">
          <div className="flex items-start justify-between gap-2">
            {PHASES.map((p, i) => {
              const isDone = phase > p.no || isCompleted;
              const isNow = phase === p.no && !isCompleted;
              return (
                <div key={p.no} className="flex-1 flex items-start last:flex-none group">
                  <div className="flex flex-col items-center w-12 shrink-0">
                    <span className={`step-badge ${isDone ? 'step-badge-done' : isNow ? 'step-badge-active' : 'step-badge-idle'}`}>
                      {isDone ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={p.icon} />
                        </svg>
                      )}
                    </span>
                  </div>
                  {i < PHASES.length - 1 && (
                    <span className={`step-connector mt-4 ${isDone ? 'step-connector-done' : ''}`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between gap-2 mt-2">
            {PHASES.map((p) => {
              const isDone = phase > p.no || isCompleted;
              const isNow = phase === p.no && !isCompleted;
              return (
                <div key={p.no} className="flex-1 text-center px-0.5">
                  <p className={`text-xs sm:text-sm font-semibold leading-tight ${isNow ? 'text-[var(--accent)]' : isDone ? 'text-ink-text' : 'text-ink-faint'}`}>
                    {p.name}
                  </p>
                  <p className="hidden sm:block text-[11px] text-ink-faint mt-0.5 leading-tight">{p.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 实时日志：折叠的次要卡片 */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => setShowLogs(v => !v)}
          className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/5"
        >
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400/80" />
            <span className="w-2 h-2 rounded-full bg-yellow-400/80" />
            <span className="w-2 h-2 rounded-full bg-emerald-400/80" />
          </span>
          <span className="font-mono text-xs text-ink-faint">pipeline.log</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs font-mono">
            {status !== 'completed' && status !== 'failed' && (
              <span className="flex items-center gap-1 text-[var(--accent)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                streaming
              </span>
            )}
            <svg className={`w-4 h-4 text-ink-faint transition-transform duration-300 ${showLogs ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>
        {showLogs && (
          <div className="border-t border-white/8 p-4 animate-float-up">
            <div className="terminal-panel p-4 h-48 overflow-y-auto space-y-1">
              {logs.length === 0 && <p className="text-ink-faint">等待任务开始...</p>}
              {logs.map((log, i) => (
                <div key={i} className={`${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-300' : 'text-ink-muted'}`}>
                  <span className="text-ink-faint select-none mr-2">›</span>
                  {log.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </RequireAuth>
  );
}