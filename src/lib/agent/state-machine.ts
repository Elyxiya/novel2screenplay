/**
 * Agent Framework - State Machine
 *
 * Defines the valid state transitions for the Agent lifecycle.
 * The machine is stateless — it only validates whether a transition is legal
 * and returns the next state / required action.
 */

import type { AgentState, StateTransition } from './types';

/**
 * All valid transitions for the Agent state machine.
 * Each entry describes one legal (from → to) move.
 */
const TRANSITIONS: StateTransition[] = [
  // ── Task arrival ───────────────────────────────────────────────────────────
  {
    from: 'idle',
    to: 'planning',
    trigger: { type: 'llm', reason: 'New task received, analyzing intent' },
  },

  // ── Planning → Execution ────────────────────────────────────────────────────
  {
    from: 'planning',
    to: 'executing',
    trigger: { type: 'llm', reason: 'Tool selected, beginning execution' },
  },
  {
    from: 'planning',
    to: 'done',
    trigger: { type: 'llm', reason: 'No tools needed, task complete' },
  },
  {
    from: 'planning',
    to: 'awaiting',
    trigger: { type: 'user_input', reason: 'Ambiguous intent, requesting clarification' },
  },

  // ── Executing → Reasoning (tool returned) ────────────────────────────────
  {
    from: 'executing',
    to: 'reasoning',
    trigger: { type: 'tool_result', reason: 'Tool completed, analyzing result' },
  },
  {
    from: 'executing',
    to: 'error',
    trigger: { type: 'tool_error', reason: 'Tool failed with an error' },
  },

  // ── Reasoning → Execution (next tool) ─────────────────────────────────────
  {
    from: 'reasoning',
    to: 'executing',
    trigger: { type: 'llm', reason: 'Next tool selected' },
  },
  {
    from: 'reasoning',
    to: 'done',
    trigger: { type: 'llm', reason: 'All tools executed, task complete' },
  },
  {
    from: 'reasoning',
    to: 'awaiting',
    trigger: { type: 'user_input', reason: 'Ambiguous result, requesting clarification' },
  },
  {
    from: 'reasoning',
    to: 'error',
    trigger: { type: 'error', reason: 'Max steps reached or budget exhausted' },
  },

  // ── Awaiting ───────────────────────────────────────────────────────────────
  {
    from: 'awaiting',
    to: 'planning',
    trigger: { type: 'user_input', reason: 'User provided clarification' },
  },
  {
    from: 'awaiting',
    to: 'done',
    trigger: { type: 'user_input', reason: 'User confirmed task can be closed' },
  },

  // ── Error → idle (reset) ───────────────────────────────────────────────────
  {
    from: 'error',
    to: 'idle',
    trigger: null,
  },

  // ── Done → idle (reset) ────────────────────────────────────────────────────
  {
    from: 'done',
    to: 'idle',
    trigger: null,
  },
];

/**
 * Builds a fast O(1) lookup table: state → set of valid next states.
 */
function buildTransitionMap(): ReadonlyMap<AgentState, ReadonlySet<AgentState>> {
  const map = new Map<AgentState, Set<AgentState>>();
  for (const t of TRANSITIONS) {
    if (!map.has(t.from)) map.set(t.from, new Set());
    map.get(t.from)!.add(t.to);
  }
  return map;
}

const TRANSITION_MAP = buildTransitionMap();

/**
 * Returns all states that can be reached directly from `current`.
 */
export function getNextStates(current: AgentState): AgentState[] {
  return [...(TRANSITION_MAP.get(current) ?? [])];
}

/**
 * Returns all valid target states for a given current state.
 */
export function canTransition(from: AgentState, to: AgentState): boolean {
  return TRANSITION_MAP.get(from)?.has(to) ?? false;
}

/**
 * Returns the transition metadata for (from → to), or null if invalid.
 */
export function getTransition(
  from: AgentState,
  to: AgentState,
): StateTransition | null {
  return TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

/**
 * Returns the trigger description for a transition, or null if invalid.
 */
export function getTriggerDescription(from: AgentState, to: AgentState): string | null {
  const t = getTransition(from, to);
  if (!t) return null;
  if (!t.trigger) return 'reset';
  if (t.trigger.type === 'llm') return t.trigger.reason ?? null;
  return t.trigger.type;
}

/**
 * Validates that a state value is a known AgentState.
 * Useful for parsing untrusted input (e.g. from localStorage).
 */
export function isValidAgentState(value: unknown): value is AgentState {
  return (
    typeof value === 'string' &&
    ['idle', 'planning', 'executing', 'reasoning', 'awaiting', 'done', 'error'].includes(value)
  );
}

/**
 * Returns human-readable labels for UI display.
 */
export const STATE_LABELS: Record<AgentState, string> = {
  idle: '空闲',
  planning: '规划中',
  executing: '执行中',
  reasoning: '推理中',
  awaiting: '等待输入',
  done: '已完成',
  error: '错误',
};

/**
 * Returns whether a state is terminal (no further transitions without reset).
 */
export function isTerminalState(state: AgentState): boolean {
  return state === 'done' || state === 'error';
}

/**
 * Returns whether the agent needs an LLM call to make progress from this state.
 */
export function needsLlmCall(state: AgentState): boolean {
  return state === 'planning' || state === 'reasoning';
}

/**
 * Returns whether the agent is actively working (not idle, not terminal).
 */
export function isActiveState(state: AgentState): boolean {
  return (
    state === 'planning' ||
    state === 'executing' ||
    state === 'reasoning' ||
    state === 'awaiting'
  );
}
