// components/WorkbenchPanel.tsx
// 点 3 被动面板：从 apps/screenplay/src/components/agent/AgentChatPanel.tsx 端口化。
// 关键改造（restrained-rework-3-points §3.1/§3.2）：
//   - 去掉 useRouter：导航改走可选的 onNavigate 回调（宿主注入）；
//   - 去掉相对路径 fetch('/api/agent/*') 与 EventSource：所有真实业务调用由宿主执行，
//     面板只通过 host（WorkbenchHost）上报意图，并消费 host 回推的 agent 事件；
//   - 长日志列表改为有界虚拟化（DOM 节点上限 = visibleRows），标注为真实新增；
//   - 样式内联（本包不拉 Tailwind/Next，shadow DOM 内宿主 CSS 不污染面板）。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentChatState,
  AgentChatEvent,
  initialState,
  agentChatReducer,
  PhaseState,
} from '../state/chat-state';

/**
 * 面板唯一的外部依赖：把"意图"转发给宿主、并允许宿主(通过 bridge)回推事件。
 * 由宿主（web / iframe 面板宿主）用 HostBridge 的实现注入。
 */
export interface WorkbenchHost {
  start(payload: { novelText: string; title: string; author: string; instruction: string }): void;
  review(payload: { phaseId: string; action: 'approve' | 'retry' | 'discard' }): void;
  revise(payload: { phaseId: string; instruction: string }): void;
  /** 宿主在桥收到 agent 事件后回调此订阅者（一订阅者，面板流局域）。 */
  on: (fn: (evt: AgentChatEvent) => void) => () => void;
}

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

/** 虚拟化配置：日志区可视行数上限，保证 DOM 节点有界。 */
const LOG_ROW_HEIGHT = 20;
const LOG_MAX_ROWS = 120; // 虚拟列表可见行的上界（超出则折叠为"只显示最近 N 条摘要"）

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
  const cardStyle: React.CSSProperties =
    phase.status === 'completed' ? { borderColor: '#10b981', background: '#ecfdf5', color: '#047857' }
    : phase.status === 'running' ? { borderColor: '#6366f1', background: '#eef2ff', color: '#4338ca' }
    : phase.status === 'failed' ? { borderColor: '#f87171', background: '#fef2f2', color: '#b91c1c' }
    : phase.status === 'awaiting' ? { borderColor: '#fbbf24', background: '#fffbeb', color: '#b45309' }
    : { borderColor: '#e2e8f0', background: '#f8fafc', color: '#94a3b8' };

  const statusText =
    phase.status === 'completed' ? '✓ 已完成'
    : phase.status === 'running' ? '进行中…'
    : phase.status === 'failed' ? '✕ 失败'
    : phase.status === 'awaiting' ? '⏸ 待人工介入'
    : '待执行';

  return (
    <div style={{ borderRadius: 8, border: '1px solid', padding: 12, ...cardStyle }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{PHASE_LABELS[phase.name] ?? phase.name}</span>
        <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{statusText}</span>
      </div>
      {phase.status === 'running' && (
        <div style={{ marginTop: 8, height: 4, borderRadius: 999, background: '#c7d2fe', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: '50%', background: '#6366f1', borderRadius: 999, animation: 'awb-pulse 1.2s infinite' }} />
        </div>
      )}
      {phase.gate && (
        <div style={{ marginTop: 8, fontSize: 12, color: phase.gate.decision === 'pass' ? '#059669' : (phase.gate.decision === 'manual_review' || phase.gate.decision === 'review' ? '#d97706' : '#dc2626') }}>
          质量关卡：{phase.gate.decision === 'pass' ? '通过' : '待人工复核'} — {phase.gate.reason}
        </div>
      )}
      {phase.status === 'awaiting' && phase.outputSummary && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#475569', background: '#ffffff', borderRadius: 8, padding: 8, border: '1px solid #fde68a', wordBreak: 'break-word' }}>
          阶段输出摘要：{phase.outputSummary}
        </div>
      )}
      {phase.status === 'awaiting' && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button onClick={() => onReview?.('approve')} style={actBtn('#059669')}>批准继续</button>
            <button onClick={() => onReview?.('retry')} style={actBtn('#4f46e5')}>重新生成</button>
            <button onClick={() => onReview?.('discard')} style={actBtn('#ef4444')}>放弃</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && feedback.trim()) onRevise?.(feedback.trim()); }}
              placeholder="输入修改建议，如：对白更口语化…"
              style={{ flex: 1, minWidth: 0, fontSize: 12, borderRadius: 8, border: '1px solid #fcd34d', padding: '6px 10px', outline: 'none' }}
            />
            <button onClick={() => feedback.trim() && onRevise?.(feedback.trim())} disabled={!feedback.trim()} style={{ ...actBtn('#f59e0b'), opacity: feedback.trim() ? 1 : 0.4 }}>
              按建议重新生成
            </button>
          </div>
        </div>
      )}
      {phase.error && phase.status !== 'awaiting' && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626', wordBreak: 'break-word' }}>错误：{phase.error}</div>
      )}
    </div>
  );
}

const actBtn = (bg: string): React.CSSProperties => ({
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 8,
  background: bg,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
});

/** 有界虚拟日志：始终只渲染最近 LOG_MAX_ROWS 条（旧日志折叠计数），DOM 节点有界。 */
function VirtualLogList({ logs }: { logs: { level: string; message: string }[] }) {
  const total = logs.length;
  const shown = logs.slice(Math.max(0, total - LOG_MAX_ROWS));
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 224, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.4 }}>
      {total > LOG_MAX_ROWS && (
        <div style={{ color: '#64748b', padding: '2px 4px' }}>… 已折叠 {total - LOG_MAX_ROWS} 条（DOM 虚拟化，节点上限 {LOG_MAX_ROWS}）</div>
      )}
      {shown.map((log, i) => (
        <div key={total - shown.length + i} style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: '#94a3b8', flexShrink: 0 }}>[{log.level ?? 'info'}]</span>
          <span style={{ wordBreak: 'break-word' }}>{log.message}</span>
        </div>
      ))}
    </div>
  );
}

export function WorkbenchPanel({ host, onNavigate }: { host: WorkbenchHost; onNavigate?: (to: string) => void }) {
  const [novelText, setNovelText] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [instruction, setInstruction] = useState('');

  const [state, setState] = useState<AgentChatState>(initialState);
  const [userMessage, setUserMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taskIdRef = useRef<string | null>(null);

  const dispatch = useCallback((evt: AgentChatEvent) => {
    setState((s) => agentChatReducer(s, evt));
  }, []);

  // 订阅宿主回推事件（桥 on 订阅者）。host.on 返回取消函数。
  useEffect(() => {
    const taskIdBefore = taskIdRef.current;
    void taskIdBefore;
    const unsubscribe = host.on((evt) => {
      if (evt.event === 'task_start') taskIdRef.current = evt.taskId;
      dispatch(evt);
    });
    return unsubscribe;
  }, [host, dispatch]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.phases, state.logs.length, state.summary]);

  const startAgent = useCallback(() => {
    if (!novelText.trim()) {
      setError('请先输入小说内容');
      return;
    }
    setError(null);
    setUserMessage(instruction.trim() || '开始 Agent 四阶段转换');
    setState(initialState);
    taskIdRef.current = null;
    host.start({
      novelText: novelText.trim(),
      title: title.trim(),
      author: author.trim(),
      instruction: instruction.trim(),
    });
  }, [novelText, title, author, instruction, host]);

  const submitReview = useCallback(
    (phaseId: string, action: 'approve' | 'retry' | 'discard' | 'revise', instruction?: string) => {
      if (!taskIdRef.current) return;
      if (action === 'revise') {
        host.revise({ phaseId, instruction: instruction ?? '' });
      } else {
        host.review({ phaseId, action });
      }
      // 宿主处理期间为防重复点击，仅轻量置位；真实运行状态由回推事件驱动。
      setState((s) => ({ ...s, running: true }));
    },
    [host],
  );

  const totalLogs = state.logs.length;

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'ui-sans-serif, system-ui, sans-serif', color: '#0f172a', background: '#ffffff' }}>
      {/* 左：输入区 */}
      <div style={{ width: 380, flexShrink: 0, borderRight: '1px solid #e2e8f0', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', background: 'rgba(248,250,252,0.5)' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', margin: 0 }}>Agent 对话工作台</h2>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>输入小说，用自然语言指导 Agent 完成转换（宿主承载真实调用）</p>
        </div>

        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>小说标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="可选"
            style={{ marginTop: 4, width: '100%', borderRadius: 8, border: '1px solid #e2e8f0', padding: '8px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </label>

        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>作者</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="可选"
            style={{ marginTop: 4, width: '100%', borderRadius: 8, border: '1px solid #e2e8f0', padding: '8px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </label>

        <label style={{ display: 'block', flex: 1, minHeight: 160 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>小说正文（文本粘贴）</span>
          <textarea value={novelText} onChange={(e) => setNovelText(e.target.value)} placeholder="在此粘贴小说正文…"
            style={{ marginTop: 4, width: '100%', height: '100%', minHeight: 160, borderRadius: 8, border: '1px solid #e2e8f0', padding: '8px 12px', fontSize: 14, lineHeight: 1.6, outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
        </label>

        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>自然语言指令（可选）</span>
          <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="例如：对白改得更口语化…"
            rows={2} style={{ marginTop: 4, width: '100%', borderRadius: 8, border: '1px solid #e2e8f0', padding: '8px 12px', fontSize: 14, lineHeight: 1.6, outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {QUICK_SUGGESTIONS.map((s) => (
            <button key={s.label} onClick={() => setInstruction(s.value)}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer' }}>{s.label}</button>
          ))}
        </div>

        {error && <div style={{ fontSize: 12, color: '#dc2626', background: '#fef2f2', borderRadius: 8, padding: '8px 12px' }}>{error}</div>}

        <button onClick={startAgent} disabled={state.running || !novelText.trim()}
          style={{ width: '100%', borderRadius: 12, background: 'linear-gradient(to right,#4f46e5,#06b6d4)', color: '#fff', fontSize: 14, fontWeight: 600, padding: '10px 0', border: 'none', cursor: 'pointer', opacity: state.running || !novelText.trim() ? 0.4 : 1 }}>
          {state.running ? 'Agent 执行中…' : '让 Agent 开始转换'}
        </button>
      </div>

      {/* 右：对话/轨迹流 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!state.started && !userMessage && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
              <div style={{ fontSize: 40, opacity: 0.3, marginBottom: 16 }}>🤖</div>
              <p style={{ color: '#94a3b8', fontSize: 14 }}>输入左侧内容，让 Agent 开始四阶段转换</p>
              <p style={{ color: '#cbd5e1', fontSize: 12, marginTop: 8 }}>你会实时看到：分析 → 场景切割 → 场景转换 → 合并去重</p>
            </div>
          )}

          {userMessage && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ maxWidth: '70%', borderRadius: 16, borderTopRightRadius: 4, background: '#4f46e5', color: '#fff', padding: '10px 16px', fontSize: 14, whiteSpace: 'pre-wrap' }}>{userMessage}</div>
            </div>
          )}

          {state.started && state.phases.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>四阶段执行轨迹</p>
              {state.phases.map((p) => (
                <PhaseCard key={p.id} phase={p}
                  onReview={p.status === 'awaiting' ? (a) => submitReview(p.id, a) : undefined}
                  onRevise={p.status === 'awaiting' ? (i) => submitReview(p.id, 'revise', i) : undefined} />
              ))}
            </div>
          )}

          {state.logs.length > 0 && (
            <div style={{ borderRadius: 8, border: '1px solid #e2e8f0', background: '#0f172a', color: '#e2e8f0', padding: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8' }}>Agent 日志</span>
                <span style={{ fontSize: 10, color: '#64748b' }}>{totalLogs} 条</span>
              </div>
              <VirtualLogList logs={state.logs} />
            </div>
          )}

          {state.summary && (
            <div style={{ borderRadius: 12, border: '1px solid', padding: 16, marginTop: 12, ...(state.summary.success ? { borderColor: '#a7f3d0', background: '#ecfdf5' } : { borderColor: '#fecaca', background: '#fef2f2' }) }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{state.summary.success ? '🎉 转换完成' : '转换未成功'}</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>耗时 {(state.summary.durationMs / 1000).toFixed(1)}s</span>
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {state.summary.phases.map((p) => (
                  <span key={p.id} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 999, ...(p.status === 'completed' ? { background: '#d1fae5', color: '#047857' } : p.status === 'failed' ? { background: '#fee2e2', color: '#b91c1c' } : { background: '#f1f5f9', color: '#64748b' }) }}>
                    {PHASE_LABELS[p.name] ?? p.name}: {p.status === 'completed' ? '通过' : p.status}
                  </span>
                ))}
              </div>
              {state.summary.success && (
                <button onClick={() => onNavigate?.('/convert')}
                  style={{ marginTop: 12, fontSize: 12, padding: '6px 12px', borderRadius: 8, background: '#059669', color: '#fff', border: 'none', cursor: 'pointer' }}>
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