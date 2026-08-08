// @/lib/agent-chat/chat-state.ts
/**
 * Agent 对话面板的状态模型与 reducer。
 * 将 SSE 事件（/api/agent/stream 推送的 data.event）映射为 UI 状态，
 * 保持纯函数，便于单元测试。
 */

export type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface GateResult {
  decision: 'pass' | 'fail';
  reason: string;
}

export interface PhaseState {
  id: string;
  name: string;
  status: PhaseStatus;
  gate?: GateResult;
  error?: string;
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

/** SSE 推送的事件载荷（data 字段），data.event 区分类型 */
export type AgentChatEvent =
  | { event: 'task_start'; taskId: string }
  | { event: 'phase_start'; taskId: string; phaseId: string; name: string }
  | { event: 'phase_complete'; taskId: string; phaseId: string; name: string }
  | { event: 'phase_failed'; taskId: string; phaseId: string; name?: string; error: string }
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
