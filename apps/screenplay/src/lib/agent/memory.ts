/**
 * Agent Framework - Memory Layer
 *
 * Implements the three-tier memory architecture:
 *   working  — ephemeral per-task context (resets on each task)
 *   contextual — sliding window of recent turns (kept between tasks)
 *   longTerm  — persistent summaries (survives restarts, stored in localStorage)
 *
 * Memory management is decoupled from the Agent so the same memory can be
 * reused across multiple agent instances (e.g. different tool sets).
 */

import type {
  AgentMemory,
  AgentMessage,
  ContextualMemory,
  LongTermMemory,
  MemoryEntry,
  TokenUsage,
  WorkingMemory,
} from './types';

const STORAGE_KEY = 'novel2screenplay_agent_memory';

/** Default maximum tokens allocated to working memory */
export const DEFAULT_WORKING_MEMORY_TOKENS = 60_000;
/** Default number of recent turns to keep in contextual memory */
export const DEFAULT_CONTEXTUAL_MAX_TURNS = 20;
/** Default token estimate per message character (Chinese chars are ~2 bytes in UTF-8) */
export const TOKENS_PER_CHAR = 0.25;

// ── Memory Factory ─────────────────────────────────────────────────────────────

/**
 * Creates a fresh memory instance.
 * longTerm is loaded from localStorage if available.
 */
export function createMemory(
  maxWorkingTokens = DEFAULT_WORKING_MEMORY_TOKENS,
  maxContextualTurns = DEFAULT_CONTEXTUAL_MAX_TURNS,
): AgentMemory {
  return {
    working: createWorkingMemory(maxWorkingTokens),
    contextual: createContextualMemory(maxContextualTurns),
    longTerm: loadLongTermFromStorage(),
  };
}

// ── Working Memory ─────────────────────────────────────────────────────────────

export function createWorkingMemory(maxTokens: number): WorkingMemory {
  return {
    currentTaskId: null,
    messages: [],
    toolResults: [],
    tokenCount: 0,
    MAX_TOKENS: maxTokens,
  };
}

/**
 * Appends a message to working memory.
 * Returns the updated token count (estimated).
 */
export function addWorkingMessage(
  wm: WorkingMemory,
  message: AgentMessage,
): number {
  wm.messages.push(message);
  wm.tokenCount += estimateTokens(message.content);
  return wm.tokenCount;
}

/**
 * Appends a tool result to working memory.
 */
export function addToolResult(wm: WorkingMemory, result: AgentMessage): void {
  wm.messages.push(result);
  wm.toolResults.push(result.toolResult!);
  wm.tokenCount += estimateTokens(
    `[${result.toolName}]: ${result.toolResult?.output ?? result.toolResult?.error ?? ''}`,
  );
}

/**
 * Removes all messages from the current task, resetting working memory.
 */
export function resetWorkingMemory(wm: WorkingMemory): void {
  wm.currentTaskId = null;
  wm.messages = [];
  wm.toolResults = [];
  wm.tokenCount = 0;
}

/**
 * Sets the current task ID in working memory.
 */
export function setWorkingTaskId(wm: WorkingMemory, taskId: string): void {
  wm.currentTaskId = taskId;
}

/**
 * Checks if working memory is approaching its token budget.
 * @returns fraction used (0–1), or >1 if over budget
 */
export function getWorkingMemoryPressure(wm: WorkingMemory): number {
  return wm.tokenCount / wm.MAX_TOKENS;
}

/**
 * Evicts oldest messages until under the token budget.
 * Returns the number of messages evicted.
 */
export function evictWorkingMemory(wm: WorkingMemory, targetFraction = 0.7): number {
  const target = wm.MAX_TOKENS * targetFraction;
  let evicted = 0;
  while (wm.tokenCount > target && wm.messages.length > 2) {
    const removed = wm.messages.shift()!;
    wm.tokenCount -= estimateTokens(removed.content);
    evicted++;
  }
  return evicted;
}

// ── Contextual Memory ─────────────────────────────────────────────────────────

export function createContextualMemory(maxTurns: number): ContextualMemory {
  return {
    recentMessages: [],
    MAX_TURNS: maxTurns,
  };
}

/**
 * Rolls recent working messages into contextual memory.
 * Keeps only the last MAX_TURNS messages.
 */
export function rollContextualMemory(
  cm: ContextualMemory,
  messages: AgentMessage[],
): void {
  const assistant = messages.filter((m) => m.role === 'assistant' || m.role === 'tool');
  cm.recentMessages = assistant.slice(-cm.MAX_TURNS);
}

/**
 * Merges contextual memory into working memory for the next task.
 * Returns the messages to prepend.
 */
export function buildContextualPrompt(
  cm: ContextualMemory,
): string {
  if (cm.recentMessages.length === 0) return '';
  const lines = ['[Recent conversation context:]\n'];
  for (const msg of cm.recentMessages) {
    if (msg.role === 'tool') {
      lines.push(`[Tool: ${msg.toolName}] ${msg.content.slice(0, 300)}`);
    } else {
      lines.push(`[${msg.role}] ${msg.content.slice(0, 500)}`);
    }
  }
  return lines.join('\n');
}

// ── Long-Term Memory ───────────────────────────────────────────────────────────

export function createLongTermMemory(): LongTermMemory {
  return {
    projectSummaries: [],
    userProfiles: [],
    updatedAt: Date.now(),
  };
}

function loadLongTermFromStorage(): LongTermMemory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createLongTermMemory();
    const parsed = JSON.parse(raw) as LongTermMemory;
    if (!parsed || !Array.isArray(parsed.projectSummaries) || !Array.isArray(parsed.userProfiles)) {
      return createLongTermMemory();
    }
    return parsed;
  } catch {
    return createLongTermMemory();
  }
}

/**
 * Persists longTerm memory to localStorage.
 */
export function persistLongTerm(ltm: LongTermMemory): void {
  try {
    ltm.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ltm));
  } catch {
    // localStorage may be unavailable (SSR, storage full)
  }
}

/**
 * Adds a new memory entry to the appropriate category.
 */
export function addMemoryEntry(
  ltm: LongTermMemory,
  entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>,
  category: 'project' | 'user',
): MemoryEntry {
  const full: MemoryEntry = {
    ...entry,
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (category === 'project') {
    ltm.projectSummaries.push(full);
  } else {
    ltm.userProfiles.push(full);
  }
  persistLongTerm(ltm);
  return full;
}

/**
 * Removes a memory entry by ID.
 */
export function removeMemoryEntry(
  ltm: LongTermMemory,
  id: string,
  category: 'project' | 'user',
): boolean {
  const list = category === 'project' ? ltm.projectSummaries : ltm.userProfiles;
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  persistLongTerm(ltm);
  return true;
}

/**
 * Updates importance or tags of a memory entry.
 */
export function updateMemoryEntry(
  ltm: LongTermMemory,
  id: string,
  patch: Partial<Pick<MemoryEntry, 'importance' | 'tags' | 'content'>>,
  category: 'project' | 'user',
): boolean {
  const list = category === 'project' ? ltm.projectSummaries : ltm.userProfiles;
  const entry = list.find((e) => e.id === id);
  if (!entry) return false;
  Object.assign(entry, patch, { updatedAt: Date.now() });
  persistLongTerm(ltm);
  return true;
}

/**
 * Builds a prompt fragment from long-term memory entries relevant to a query.
 */
export function buildLongTermPrompt(
  ltm: LongTermMemory,
  tags?: string[],
): string {
  const all: MemoryEntry[] = [...ltm.projectSummaries, ...ltm.userProfiles];
  const filtered = tags
    ? all.filter((e) => e.tags.some((t) => tags.includes(t)))
    : all;

  if (filtered.length === 0) return '';

  const lines = ['[Stored knowledge:]\n'];
  for (const e of filtered) {
    lines.push(`[${e.importance} importance${e.tags.length ? ', tags: ' + e.tags.join(', ') : ''}] ${e.content}`);
  }
  return lines.join('\n');
}

// ── Token Estimation ──────────────────────────────────────────────────────────

/**
 * Rough token estimate: characters / 4 (conservative for Chinese).
 * In production this should use tiktoken, but that requires WASM init
 * which may not be available at the memory layer level.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/**
 * Estimates total tokens used across a list of messages.
 */
export function estimateMessageTokens(messages: AgentMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

/**
 * Accumulates token usage counters.
 */
export function addTokenUsage(base: TokenUsage, delta: TokenUsage): TokenUsage {
  return {
    promptTokens: base.promptTokens + delta.promptTokens,
    completionTokens: base.completionTokens + delta.completionTokens,
    totalTokens: base.totalTokens + delta.totalTokens,
  };
}

/**
 * Checks if the accumulated token usage exceeds a limit.
 */
export function isOverTokenBudget(usage: TokenUsage, limit: number): boolean {
  return usage.totalTokens > limit;
}

// ── Full Memory Helpers ────────────────────────────────────────────────────────

/**
 * Serializes the full memory for debugging / serialization.
 */
export function serializeMemory(memory: AgentMemory): string {
  return JSON.stringify(memory, (key, value) => {
    if (key === 'toolResults') return `[${value.length} tool results]`;
    return value;
  });
}

/**
 * Clears all persistent memory from storage.
 */
export function clearPersistentMemory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
