/**
 * Agent Framework - Type Definitions
 *
 * Defines all core types for the Agent state machine, memory system, and
 * task model. These types are intentionally framework-agnostic and do not
 * depend on any external agent library.
 */

// ── State Machine ─────────────────────────────────────────────────────────────

/** Agent lifecycle states */
export type AgentState =
  | 'idle'           // Waiting for a task
  | 'planning'       // Analyzing task, selecting tools
  | 'executing'      // Running a tool
  | 'reasoning'      // Calling LLM to reason about next step
  | 'awaiting'       // Waiting for user input
  | 'done'           // Task completed
  | 'error';         // Unrecoverable error

/**
 * A valid state transition.
 * `reason` is optional metadata describing why this transition fires.
 * `null` means a synchronous reset (no LLM involvement).
 */
export interface StateTransition {
  from: AgentState;
  to: AgentState;
  trigger: {
    type: string;
    reason?: string;
  } | null;
}

// ── Memory ───────────────────────────────────────────────────────────────────

/**
 * The three-tier memory architecture:
 * - working: ephemeral per-turn context (this conversation)
 * - contextual: recent N turns (recency window)
 * - longTerm: persistent summaries, summaries are managed by LLM
 */
export interface AgentMemory {
  working: WorkingMemory;
  contextual: ContextualMemory;
  longTerm: LongTermMemory;
}

export interface WorkingMemory {
  currentTaskId: string | null;
  /** Messages from the current task session */
  messages: AgentMessage[];
  /** Tool call results collected so far this task */
  toolResults: ToolResult[];
  /** Token count of working memory (estimated) */
  tokenCount: number;
  MAX_TOKENS: number;
}

export interface ContextualMemory {
  /** Recent messages within the recency window */
  recentMessages: AgentMessage[];
  MAX_TURNS: number;
}

export interface LongTermMemory {
  /** Persistent summaries about the project / user preferences */
  projectSummaries: MemoryEntry[];
  /** Persistent summaries about the user's style / habits */
  userProfiles: MemoryEntry[];
  /** Last updated timestamp */
  updatedAt: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  importance: 'high' | 'medium' | 'low';
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
  /** Only set when role === 'tool' */
  toolResult?: ToolResult;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

/**
 * A tool that the Agent can invoke.
 * Tools are defined by the application layer, not the Agent itself.
 */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Estimated token cost per invocation (for budget tracking) */
  estimatedTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ── Task ─────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/** A unit of work submitted to the Agent */
export interface AgentTask {
  id: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  context: TaskContext;
  steps: AgentStep[];
  /** Number of reasoning/llm calls made */
  llmCallCount: number;
  /** Accumulated token usage */
  tokenUsage: TokenUsage;
  error: string | null;
}

export interface TaskContext {
  projectId: string | null;
  /** Additional key-value metadata passed by the caller */
  metadata: Record<string, string>;
}

export interface AgentStep {
  index: number;
  state: AgentState;
  timestamp: number;
  action: string;
  observation: string;
  toolCalls: ToolCall[];
  /** Snapshot of working memory token count after this step */
  memoryTokens: number;
}

// ── Token Usage ───────────────────────────────────────────────────────────────

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ── Agent Config ──────────────────────────────────────────────────────────────

export interface AgentConfig {
  /** Model identifier passed to the LLM provider */
  modelId: string;
  /** Maximum tokens in a single LLM response */
  maxTokens: number;
  /** Temperature for LLM sampling (0 = deterministic) */
  temperature: number;
  /** Maximum steps before the agent stops */
  maxSteps: number;
  /** Maximum token budget for the entire task */
  maxTotalTokens: number;
  /** Maximum concurrent tool calls per LLM turn */
  maxConcurrentTools: number;
  /** Whether to enable verbose step logging */
  verbose: boolean;
  /** System prompt injected before every task */
  systemPrompt: string;
  /** Tools available to this agent */
  tools: AgentTool[];
}

// ── LLM Request/Response ──────────────────────────────────────────────────────

/**
 * Minimal LLM response shape that the Agent framework operates on.
 * The actual HTTP/streaming logic lives in the LLM provider layer.
 */
export interface LLMResponse {
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  toolCalls: ToolCall[];
  usage: TokenUsage;
}

// ── Event ─────────────────────────────────────────────────────────────────────

/** Events emitted by the Agent for UI / logging consumption */
export type AgentCoreEvents =
  | { type: 'state_change'; from: AgentState; to: AgentState; taskId: string }
  | { type: 'step_complete'; taskId: string; step: AgentStep }
  | { type: 'task_start'; taskId: string }
  | { type: 'task_complete'; taskId: string; result: string }
  | { type: 'task_error'; taskId: string; error: string }
  | { type: 'token_warning'; taskId: string; remaining: number };
