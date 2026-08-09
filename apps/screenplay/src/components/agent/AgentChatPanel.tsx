'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AgentChatState,
  AgentChatEvent,
  initialState,
  agentChatReducer,
  PhaseState,
} from '@/lib/agent-chat/chat-state';

/** 快捷指令建议 */
const QUICK_SUGGESTIONS = [
  { label: '完整四阶段转换', value: '按标准流程完整转换全部内容' },
  { label: '对白更口语化', value: '对白改得更口语化、贴近人物性格' },
  { label: '突出动作描写', value: '强化动作与场面描写，减少心理独白' },
  { label: '检查节奏感', value: '检查并优化场景节奏，避免拖沓' },
];

const PHASE_LABELS: Record<string, string> = {
  analyze: '角色/地点分析',
  segment: '场景切割',
  convert: '场景转换',
  merge: '合并去重',
};

function PhaseCard({
  phase,
  onReview,
  onRevise,
}: {
  phase: PhaseState;
  onReview?: (action: 'approve' | 'retry' | 'discard') => void;
  onRevise?: (instruction: string) => void;
}) {
  const [feedback, setFeedback] = useState('');
  const statusColor =
    phase.status === 'completed' ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
    : phase.status === 'running' ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
    : phase.status === 'failed' ? 'border-red-300 bg-red-50 text-red-700'
    : phase.status === 'awaiting' ? 'border-amber-300 bg-amber-50 text-amber-700'
    : 'border-slate-200 bg-slate-50 text-slate-400';

  const statusText =
    phase.status === 'completed' ? '✓ 已完成'
    : phase.status === 'running' ? '进行中…'
    : phase.status === 'failed' ? '✕ 失败'
    : phase.status === 'awaiting' ? '⏸ 待人工介入'
    : '待执行';

  return (
    <div className={`rounded-lg border p-3 ${statusColor}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{PHASE_LABELS[phase.name] ?? phase.name}</span>
        <span className="text-xs whitespace-nowrap">{statusText}</span>
      </div>
      {phase.status === 'running' && (
        <div className="mt-2 h-1 rounded-full bg-indigo-200 overflow-hidden">
          <div className="h-full w-1/2 bg-indigo-500 rounded-full animate-pulse" />
        </div>
      )}
      {phase.gate && (
        <div
          className={`mt-2 text-xs ${
            phase.gate.decision === 'pass'
              ? 'text-emerald-600'
              : phase.gate.decision === 'manual_review' || phase.gate.decision === 'review'
                ? 'text-amber-600'
                : 'text-red-500'
          }`}
        >
          质量关卡：
          {phase.gate.decision === 'pass' ? '通过' : '待人工复核'} — {phase.gate.reason}
        </div>
      )}
      {phase.status === 'awaiting' && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onReview?.('approve')}
              className="text-xs px-2.5 py-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              批准继续
            </button>
            <button
              onClick={() => onReview?.('retry')}
              className="text-xs px-2.5 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              重新生成
            </button>
            <button
              onClick={() => onReview?.('discard')}
              className="text-xs px-2.5 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              放弃
            </button>
          </div>
          <div className="flex gap-1.5">
            <input
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && feedback.trim()) onRevise?.(feedback.trim());
              }}
              placeholder="输入修改建议，如：对白更口语化…"
              className="flex-1 min-w-0 text-xs rounded-lg border border-amber-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
            <button
              onClick={() => feedback.trim() && onRevise?.(feedback.trim())}
              disabled={!feedback.trim()}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              按建议重新生成
            </button>
          </div>
        </div>
      )}
      {phase.error && phase.status !== 'awaiting' && (
        <div className="mt-2 text-xs text-red-500 break-words">错误：{phase.error}</div>
      )}
    </div>
  );
}

export function AgentChatPanel() {
  const router = useRouter();

  // 输入区
  const [novelText, setNovelText] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [instruction, setInstruction] = useState('');

  // Agent 状态
  const [state, setState] = useState<AgentChatState>(initialState);
  const [userMessage, setUserMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const dispatch = useCallback((evt: AgentChatEvent) => {
    setState((s) => agentChatReducer(s, evt));
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.phases, state.logs, state.summary]);

  // 组件卸载时断开 SSE
  useEffect(() => () => eventSourceRef.current?.close(), []);

  const pollTaskRef = useRef<((taskId: string) => Promise<void>) | null>(null);
  const pollTask = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/agent/start?taskId=${encodeURIComponent(taskId)}`);
      const data = await res.json();
      if (!res.ok || data.failed) {
        setState((s) => ({ ...s, running: false, error: data.error ?? '任务中断' }));
        eventSourceRef.current?.close();
        return;
      }
      if (data.awaiting) {
        // 挂起等待人工介入：停止轮询，等待用户操作
        setState((s) => ({ ...s, running: false }));
        return;
      }
      if (data.completed) {
        setState((s) => ({ ...s, running: false }));
        eventSourceRef.current?.close();
        return;
      }
      setTimeout(() => void pollTaskRef.current?.(taskId), 2000);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    pollTaskRef.current = pollTask;
  }, [pollTask]);

  const startAgent = useCallback(async () => {
    if (!novelText.trim()) {
      setError('请先输入小说内容');
      return;
    }
    setError(null);
    setUserMessage(instruction.trim() || '开始 Agent 四阶段转换');
    setState(initialState);

    try {
      const res = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          novelText: novelText.trim(),
          title: title.trim() || undefined,
          author: author.trim() || undefined,
          instruction: instruction.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '启动失败');
        return;
      }

      const { taskId } = data as { taskId: string };
      dispatch({ event: 'task_start', taskId });

      const es = new EventSource(`/api/agent/stream/${taskId}`);
      eventSourceRef.current = es;

      es.addEventListener('complete', (e) => {
        try {
          const msg = JSON.parse((e as MessageEvent).data);
          const evt = msg?.data ?? msg;
          if (evt?.event === 'task_complete') {
            dispatch(evt as AgentChatEvent);
            es.close();
            eventSourceRef.current = null;
          } else if (evt?.event === 'task_start') {
            dispatch(evt as AgentChatEvent);
          } else if (evt?.event === 'task_awaiting') {
            // 挂起等待人工介入：保持 SSE 连接，等待用户操作后事件继续推送
            dispatch(evt as AgentChatEvent);
          }
        } catch { /* ignore malformed */ }
      });
      es.addEventListener('phase', (e) => {
        try {
          const msg = JSON.parse((e as MessageEvent).data);
          const evt = msg?.data ?? msg;
          if (evt?.event === 'phase_start' || evt?.event === 'phase_complete') {
            dispatch(evt as AgentChatEvent);
          }
        } catch { /* ignore */ }
      });
      es.addEventListener('progress', (e) => {
        try {
          const msg = JSON.parse((e as MessageEvent).data);
          const evt = msg?.data ?? msg;
          if (
            evt?.event === 'gate_result' ||
            evt?.event === 'phase_failed' ||
            evt?.event === 'phase_awaiting_manual'
          ) {
            dispatch(evt as AgentChatEvent);
          }
        } catch { /* ignore */ }
      });
      es.addEventListener('log', (e) => {
        try {
          const msg = JSON.parse((e as MessageEvent).data);
          const evt = msg?.data ?? msg;
          if (evt?.event === 'log') dispatch(evt as AgentChatEvent);
        } catch { /* ignore */ }
      });
      es.addEventListener('error', () => {
        // 连接中断：轮询兜底
        void pollTask(taskId);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [novelText, title, author, instruction, dispatch, pollTask]);

  const submitReview = useCallback(
    async (phaseId: string, action: 'approve' | 'retry' | 'discard' | 'revise', instruction?: string) => {
      if (!state.taskId) return;
      try {
        const res = await fetch('/api/agent/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: state.taskId, phaseId, action, instruction }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? '人工介入处理失败');
          return;
        }
        setError(null);
        // 任务恢复执行：重新进入 running，等待 SSE 事件继续
        setState((s) => ({ ...s, running: true }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [state.taskId],
  );

  const totalLogs = state.logs.length;

  return (
    <div className="flex h-full">
      {/* 左：输入区 */}
      <div className="w-[380px] shrink-0 border-r border-slate-200/70 p-4 flex flex-col gap-3 overflow-y-auto bg-slate-50/50">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Agent 对话工作台</h2>
          <p className="text-xs text-slate-400 mt-0.5">输入小说，用自然语言指导 Agent 完成转换</p>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-slate-500">小说标题</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="可选"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-500">作者</span>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="可选"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </label>

        <label className="block flex-1 min-h-[160px]">
          <span className="text-xs font-medium text-slate-500">小说正文（文本粘贴）</span>
          <textarea
            value={novelText}
            onChange={(e) => setNovelText(e.target.value)}
            placeholder="在此粘贴小说正文…"
            className="mt-1 w-full h-full min-h-[160px] rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-500">自然语言指令（可选）</span>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如：对白改得更口语化、强化动作描写…"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
            rows={2}
          />
        </label>

        <div className="flex flex-wrap gap-1.5">
          {QUICK_SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => setInstruction(s.value)}
              className="text-xs px-2.5 py-1 rounded-full border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</div>
        )}

        <button
          onClick={() => void startAgent()}
          disabled={state.running || !novelText.trim()}
          className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 text-white text-sm font-semibold py-2.5 shadow-lg shadow-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-indigo-300"
        >
          {state.running ? 'Agent 执行中…' : '让 Agent 开始转换'}
        </button>
      </div>

      {/* 右：对话/轨迹流 */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
          {!state.started && !userMessage && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-5xl mb-4 opacity-30">🤖</div>
              <p className="text-slate-400 text-sm">输入左侧内容，让 Agent 开始四阶段转换</p>
              <p className="text-slate-300 text-xs mt-2">
                你会实时看到：分析 → 场景切割 → 场景转换 → 合并去重
              </p>
            </div>
          )}

          {userMessage && (
            <div className="flex justify-end">
              <div className="max-w-[70%] rounded-2xl rounded-tr-sm bg-indigo-600 text-white px-4 py-2.5 text-sm whitespace-pre-wrap">
                {userMessage}
              </div>
            </div>
          )}

          {state.started && state.phases.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">四阶段执行轨迹</p>
              {state.phases.map((p) => (
                <PhaseCard
                  key={p.id}
                  phase={p}
                  onReview={p.status === 'awaiting' ? (a) => void submitReview(p.id, a) : undefined}
                  onRevise={p.status === 'awaiting' ? (i) => void submitReview(p.id, 'revise', i) : undefined}
                />
              ))}
            </div>
          )}

          {state.logs.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-900 text-slate-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-400">Agent 日志</span>
                <span className="text-[10px] text-slate-500">{totalLogs} 条</span>
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto font-mono text-[11px] leading-relaxed">
                {state.logs.map((log, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-slate-500 shrink-0">[{log.level ?? 'info'}]</span>
                    <span className="break-words">{log.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.summary && (
            <div className={`rounded-xl border p-4 ${state.summary.success ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">
                  {state.summary.success ? '🎉 转换完成' : '转换未成功'}
                </span>
                <span className="text-xs text-slate-400">
                  耗时 {(state.summary.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {state.summary.phases.map((p) => (
                  <span
                    key={p.id}
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700'
                        : p.status === 'failed'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {PHASE_LABELS[p.name] ?? p.name}: {p.status === 'completed' ? '通过' : p.status}
                  </span>
                ))}
              </div>
              {state.summary.success && (
                <button
                  onClick={() => router.push('/convert')}
                  className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                  前往可视化精修 →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
