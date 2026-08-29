// state/chat-state.ts
// 点 3：从 apps/screenplay 原位置（src/lib/agent-chat/chat-state.ts）端口化的状态模型 + reducer。
// 改动：仅去掉 '@/' 路径别名（本包作为独立 ESM 包构建，无 Next 别名），逻辑保持逐行一致。
// 该 reducer 供「被动面板」消费宿主通过桥回推的 agent 事件（workbench:event 的 data）。
export type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'awaiting';

export interface GateResult {
  decision: 'pass' | 'fail' | 'review' | 'manual_review';
  reason: string;
}

export interface PhaseState {
  id: string;
  name: string;
  status: PhaseStatus;
  gate?: GateResult;
  error?: string;
  /** 挂起（awaiting）阶段的输出摘要，供人工介入参考 */
  outputSummary?: string;
}

export interface LogEntry {
  level: string;
  message: string;
  timestamp: number;
}

export interface TaskSummary {
  success: boolean;
  durationMs: number;
  phases: { id: string; name: string; status: string }[];
}

export interface AgentChatState {
  taskId: string | null;
  running: boolean;
  started: boolean;
  phases: PhaseState[];
  logs: LogEntry[];
  summary: TaskSummary | null;
  error: string | null;
}

/** 宿主通过桥回推的 agent 事件（原 SSE data.event 载荷）。 */
export type AgentChatEvent =
  | { event: 'task_start'; taskId: string }
  | { event: 'phase_start'; taskId: string; phaseId: string; name: string }
  | { event: 'phase_complete'; taskId: string; phaseId: string; name: string }
  | { event: 'phase_failed'; taskId: string; phaseId: string; name?: string; error: string }
  | {
      event: 'phase_awaiting_manual';
      taskId: string;
      phaseId: string;
      name?: string;
      reason: string;
      gate?: GateResult;
      outputSummary?: string;
    }
  | { event: 'task_awaiting'; taskId: string; phaseId: string; name?: string; reason: string }
  | { event: 'gate_result'; taskId: string; phaseId: string; gate: GateResult }
  | { event: 'log'; taskId: string; level?: string; message: string }
  | { event: 'task_complete'; taskId: string; success: boolean; durationMs: number; phases: { id: string; name: string; status: string }[] };

export const initialState: AgentChatState = {
  taskId: null,
  running: false,
  started: false,
  phases: [],
  logs: [],
  summary: null,
  error: null,
};

function upsertPhase(state: AgentChatState, phaseId: string, patch: Partial<PhaseState>): PhaseState[] {
  const idx = state.phases.findIndex((p) => p.id === phaseId);
  if (idx === -1) {
    return [...state.phases, { id: phaseId, name: patch.name ?? phaseId, status: 'pending', ...patch }];
  }
  return state.phases.map((p) => (p.id === phaseId ? { ...p, ...patch } : p));
}

export function agentChatReducer(state: AgentChatState, evt: AgentChatEvent): AgentChatState {
  switch (evt.event) {
    case 'task_start':
      return { ...state, taskId: evt.taskId, running: true, started: true, summary: null, error: null };

    case 'phase_start':
      return {
        ...state,
        phases: upsertPhase(state, evt.phaseId, { name: evt.name, status: 'running' }),
      };

    case 'phase_complete':
      return {
        ...state,
        phases: upsertPhase(state, evt.phaseId, { name: evt.name, status: 'completed' }),
      };

    case 'phase_failed':
      return {
        ...state,
        phases: upsertPhase(state, evt.phaseId, { name: evt.name, status: 'failed', error: evt.error }),
      };

    case 'phase_awaiting_manual':
      return {
        ...state,
        running: false,
        phases: upsertPhase(state, evt.phaseId, {
          name: evt.name,
          status: 'awaiting',
          error: evt.reason,
          gate: evt.gate ?? { decision: 'manual_review', reason: evt.reason },
          outputSummary: evt.outputSummary,
        }),
      };

    case 'task_awaiting':
      return { ...state, running: false };

    case 'gate_result':
      return {
        ...state,
        phases: upsertPhase(state, evt.phaseId, { gate: evt.gate }),
      };

    case 'log':
      return {
        ...state,
        logs: [
          ...state.logs,
          { level: evt.level ?? 'info', message: evt.message, timestamp: Date.now() },
        ],
      };

    case 'task_complete':
      return {
        ...state,
        running: false,
        summary: {
          success: evt.success,
          durationMs: evt.durationMs,
          phases: evt.phases.length > 0
            ? evt.phases
            : state.phases.map((p) => ({ id: p.id, name: p.name, status: p.status })),
        },
        error: evt.success ? null : state.error ?? '任务未成功完成',
      };

    default:
      return state;
  }
}