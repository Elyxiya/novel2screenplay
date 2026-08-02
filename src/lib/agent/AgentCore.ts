/**
 * Agent Framework - Core Agent
 *
 * Orchestrates the Agent lifecycle: state transitions, memory management,
 * LLM calls, and tool execution. The class is event-driven and fully
 * testable without any external infrastructure.
 *
 * The actual LLM call is delegated to `llmProvider` so the framework
 * stays decoupled from any specific API.
 */

import type {
  AgentConfig,
  AgentCoreEvents,
  AgentMessage,
  AgentState,
  AgentStep,
  AgentTask,
  TaskContext,
  ToolCall,
  ToolResult,
  TokenUsage,
} from './types';
import type { AgentTool } from './tool-types';

import {
  addMemoryEntry,
  addTokenUsage,
  addToolResult,
  addWorkingMessage,
  buildContextualPrompt,
  buildLongTermPrompt,
  canTransition,
  createMemory,
  evictWorkingMemory,
  getNextStates,
  getTriggerDescription,
  isActiveState,
  isOverTokenBudget,
  isTerminalState,
  needsLlmCall,
  resetWorkingMemory,
  rollContextualMemory,
  setWorkingTaskId,
} from './index';

export type { AgentCoreEvents };

/** Handler for all Agent events. */
export type AgentEventHandler = (event: AgentCoreEvents) => void;

// ── LLM Provider Interface ──────────────────────────────────────────────────────

/**
 * Minimal interface the AgentCore requires from any LLM provider.
 * The framework does not depend on DeepSeekProvider / OpenAIProvider directly.
 */
export interface LLMProvider {
  chat(
    messages: Array<{ role: string; content: string }>,
    tools: AgentTool[],
    signal?: AbortSignal,
  ): Promise<LLMResponse>;
}

// ── LLM Response ────────────────────────────────────────────────────────────────

export interface LLMResponse {
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  toolCalls: ToolCall[];
  usage: TokenUsage;
}

// ── ToolExecutor ───────────────────────────────────────────────────────────────

/**
 * Minimal interface for executing tool calls.
 * Application layer provides an implementation that wires to actual tools
 * (e.g., the existing pipeline, filesystem, API routes, etc.).
 */
export interface ToolExecutor {
  execute(call: ToolCall, signal?: AbortSignal): Promise<unknown>;
  listTools(): AgentTool[];
}

// ── AgentCore ───────────────────────────────────────────────────────────────────

/**
 * Event emitter interface for Agent events.
 * The AgentCore itself is a minimal event target.
 */
export interface AgentEventListener {
  on<T extends AgentCoreEvents['type']>(
    event: T,
    handler: (payload: Extract<AgentCoreEvents, { type: T }>) => void,
  ): () => void;
  emit(event: AgentCoreEvents): void;
}

/**
 * Core Agent class.
 *
 * Usage:
 * ```ts
 * const agent = new AgentCore(config, llmProvider, toolExecutor);
 * agent.on('state_change', ({ to }) => console.log('State:', to));
 * const result = await agent.run('帮我润色第一章的对白');
 * ```
 */
export class AgentCore {
  private state: AgentState = 'idle';
  private memory = createMemory();
  private currentTask: AgentTask | null = null;
  private stepIndex = 0;
  private abortController: AbortController | null = null;
  private listeners = new Set<AgentEventHandler>();

  constructor(
    private config: AgentConfig,
    private llmProvider: LLMProvider,
    private toolExecutor: ToolExecutor,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Submits a new task and runs the agent until completion or a terminal state.
   * Returns the final task result string.
   */
  async run(description: string, context: TaskContext = { projectId: null, metadata: {} }): Promise<string> {
    this.abortController = new AbortController();

    const task: AgentTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      description,
      priority: 'normal',
      status: 'running',
      createdAt: Date.now(),
      startedAt: Date.now(),
      completedAt: null,
      context,
      steps: [],
      llmCallCount: 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      error: null,
    };
    this.currentTask = task;
    this.stepIndex = 0;
    setWorkingTaskId(this.memory.working, task.id);
    resetWorkingMemory(this.memory.working);

    this.emit({ type: 'task_start', taskId: task.id });
    this.emit({ type: 'state_change', from: 'idle', to: 'planning', taskId: task.id });
    this.state = 'planning';

    try {
      await this.injectSystemPrompt();
      await this.injectContextualMemory();
      await this.injectLongTermMemory();

      const userMsg = this.makeMessage('user', description);
      addWorkingMessage(this.memory.working, userMsg);

      let result = '';
      let st: AgentState = 'planning';

      while (!isTerminalState(st)) {
        if (this.abortController.signal.aborted) break;
        if (this.stepIndex >= this.config.maxSteps) {
          this.state = 'error';
          this.emit({ type: 'state_change', from: st, to: 'error', taskId: task.id });
          task.error = 'Max steps reached';
          break;
        }
        if (isOverTokenBudget(task.tokenUsage, this.config.maxTotalTokens)) {
          this.state = 'error';
          this.emit({ type: 'state_change', from: st, to: 'error', taskId: task.id });
          task.error = 'Token budget exhausted';
          this.emit({ type: 'token_warning', taskId: task.id, remaining: 0 });
          break;
        }

        if (st === 'planning' || st === 'reasoning') {
          const llmResult = await this.callLLM();
          task.llmCallCount++;
          task.tokenUsage = addTokenUsage(task.tokenUsage, llmResult.usage);
          this.checkTokenWarning(task);

          const fr = llmResult.finishReason;
          const hasToolCalls = fr === 'tool_calls' || llmResult.toolCalls.length > 0;

          if (hasToolCalls) {
            st = 'executing';
            this.state = 'executing';
            this.emit({ type: 'state_change', from: st === 'executing' ? 'planning' : 'reasoning', to: 'executing', taskId: task.id });
            for (const tc of llmResult.toolCalls) {
              await this.executeTool(tc);
            }
            st = 'reasoning';
            this.state = 'reasoning';
            this.emit({ type: 'state_change', from: 'executing', to: 'reasoning', taskId: task.id });
          } else if (fr === 'error') {
            this.state = 'error';
            this.emit({ type: 'state_change', from: st, to: 'error', taskId: task.id });
            task.error = llmResult.content || 'LLM call failed';
            break;
          } else {
            const assistantMsg = this.makeMessage('assistant', llmResult.content);
            addWorkingMessage(this.memory.working, assistantMsg);
            result = llmResult.content;
            this.state = 'done';
            this.emit({ type: 'state_change', from: st, to: 'done', taskId: task.id });
            st = 'done';
            break;
          }
        } else if (st === 'executing') {
          st = 'reasoning';
          this.state = 'reasoning';
          this.emit({ type: 'state_change', from: 'executing', to: 'reasoning', taskId: task.id });
        } else if (st === 'awaiting') {
          break;
        }

        this.stepIndex++;
      }

      if (st === 'done') {
        task.status = 'completed';
        task.completedAt = Date.now();
        rollContextualMemory(this.memory.contextual, this.memory.working.messages);
        this.emit({ type: 'task_complete', taskId: task.id, result });
        return result;
      }
      // st is non-terminal here (awaiting/aborted or implicitly handled)
      const finalSt = st as AgentState;
      task.status = finalSt === 'error' ? 'failed' : 'waiting_user';
      task.completedAt = Date.now();
      if (finalSt === 'error') {
        this.emit({ type: 'task_error', taskId: task.id, error: task.error ?? 'Unknown error' });
        throw new AgentError(task.error ?? 'Agent failed', task.id);
      }
      return '';
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Resumes a task that was waiting for user input.
   */
  async resume(userInput: string): Promise<string> {
    if (this.state !== 'awaiting') {
      throw new Error(`Cannot resume: agent is in "${this.state}" state, expected "awaiting"`);
    }
    const userMsg = this.makeMessage('user', userInput);
    addWorkingMessage(this.memory.working, userMsg);
    this.transition('planning');
    return this.run(this.currentTask!.description, this.currentTask!.context);
  }

  /** Cancels the current task. */
  cancel(): void {
    this.abortController?.abort();
  }

  /** Returns the current agent state. */
  getState(): AgentState {
    return this.state;
  }

  /** Returns the current task or null. */
  getCurrentTask(): AgentTask | null {
    return this.currentTask;
  }

  /** Returns the memory instance (for debugging / persistence). */
  getMemory() {
    return this.memory;
  }

  // ── Event Subscription ──────────────────────────────────────────────────

  /**
   * Subscribes to all Agent events (state_change, task_start, step_complete, ...).
   * Returns an unsubscribe function.
   */
  on(handler: AgentEventHandler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** Removes a previously subscribed event handler. */
  off(handler: AgentEventHandler): void {
    this.listeners.delete(handler);
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private transition(to: AgentState): void {
    const from = this.state;
    if (!canTransition(from, to)) {
      throw new Error(
        `Invalid transition: ${from} → ${to}. Valid next states: ${getNextStates(from).join(', ') || 'none'}`,
      );
    }
    this.state = to;
    this.emit({ type: 'state_change', from, to, taskId: this.currentTask?.id ?? '' });
  }

  private async callLLM(): Promise<LLMResponse> {
    evictWorkingMemory(this.memory.working);

    const messages = this.memory.working.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    return this.llmProvider.chat(
      messages,
      this.config.tools,
      this.abortController?.signal,
    );
  }

  private async executeTool(call: ToolCall): Promise<void> {
    const step = this.beginStep();

    let toolResult: ToolResult;
    try {
      const raw = await this.toolExecutor.execute(call, this.abortController?.signal);
      toolResult = {
        toolCallId: call.id,
        toolName: call.name,
        success: true,
        output: typeof raw === 'string' ? raw : JSON.stringify(raw),
        durationMs: 0,
      };
      this.transition('reasoning');
    } catch (err) {
      toolResult = {
        toolCallId: call.id,
        toolName: call.name,
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      };
      this.transition('error');
    }

    const toolMsg = this.makeMessage('tool', toolResult.output, {
      toolCallId: call.id,
      toolName: call.name,
      toolResult,
    });
    addToolResult(this.memory.working, toolMsg);
    step.toolCalls.push(call);
    step.observation = toolResult.success
      ? `Tool "${call.name}" returned successfully`
      : `Tool "${call.name}" failed: ${toolResult.error}`;
    this.endStep(step);
  }

  private beginStep(): AgentStep {
    const step: AgentStep = {
      index: this.stepIndex,
      state: this.state,
      timestamp: Date.now(),
      action: getTriggerDescription(this.state, 'executing') ?? 'begin',
      observation: '',
      toolCalls: [],
      memoryTokens: this.memory.working.tokenCount,
    };
    this.currentTask?.steps.push(step);
    return step;
  }

  private endStep(step: AgentStep): void {
    step.memoryTokens = this.memory.working.tokenCount;
    this.emit({
      type: 'step_complete',
      taskId: this.currentTask?.id ?? '',
      step,
    });
  }

  private async injectSystemPrompt(): Promise<void> {
    const msg = this.makeMessage('system', this.config.systemPrompt);
    addWorkingMessage(this.memory.working, msg);
  }

  private async injectContextualMemory(): Promise<void> {
    const prompt = buildContextualPrompt(this.memory.contextual);
    if (prompt) {
      const msg = this.makeMessage('system', prompt);
      addWorkingMessage(this.memory.working, msg);
    }
  }

  private async injectLongTermMemory(): Promise<void> {
    const prompt = buildLongTermPrompt(this.memory.longTerm);
    if (prompt) {
      const msg = this.makeMessage('system', prompt);
      addWorkingMessage(this.memory.working, msg);
    }
  }

  private makeMessage(
    role: AgentMessage['role'],
    content: string,
    extra: Partial<AgentMessage> = {},
  ): AgentMessage {
    return {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role,
      content,
      timestamp: Date.now(),
      ...extra,
    };
  }

  private checkTokenWarning(task: AgentTask): void {
    const remaining = this.config.maxTotalTokens - task.tokenUsage.totalTokens;
    const fraction = remaining / this.config.maxTotalTokens;
    if (fraction < 0.2) {
      this.emit({ type: 'token_warning', taskId: task.id, remaining });
    }
  }

  private emit(event: AgentCoreEvents): void {
    // 分发给订阅者（调试日志、外部监听等）
    for (const handler of this.listeners) {
      try {
        handler(event);
      } catch (err) {
        console.error('[Agent] 事件处理器异常:', err);
      }
    }
    if (!this.config.verbose) return;
    const label = `[Agent] ${event.type}`;
    const payload = { ...event };
    delete (payload as Partial<typeof payload>).type;
    console.debug(label, payload);
  }
}

// ── ToolExecutor Interface ──────────────────────────────────────────────────────

/**
 * Minimal interface for executing tool calls.
 * Application layer provides an implementation that wires to actual tools
 * (e.g., the existing pipeline, filesystem, API routes, etc.).
 */
export interface ToolExecutor {
  execute(call: ToolCall, signal?: AbortSignal): Promise<unknown>;
  /** Returns metadata about all available tools */
  listTools(): AgentTool[];
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly taskId: string,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}
