/**
 * MultiAgentOrchestrator 持久化（P-记忆）单元测试
 *
 * 覆盖：
 * - startConversion 后任务立即写入持久化（active + 全量 phases + userId）
 * - 任务流转中状态变更持续落库（awaiting 挂起快照 / 终态 completed）
 * - restoreFromPersistence 恢复挂起任务：保持 awaiting、不自动续跑
 * - 恢复挂起任务后可人工介入 approve 完成
 * - 恢复崩溃遗留 running 阶段任务：自动续跑至完成
 * - 无 persistence 时 restoreFromPersistence 为 no-op
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMProvider, LLMMessage, LLMChatOptions, LLMChatResponse } from '../llm/types';
import {
  MultiAgentOrchestrator,
  type OrchestratorTask,
  type AgentTaskPersistence,
  type AgentTaskStatus,
} from './orchestrator';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockRegistry = {
  register: vi.fn(),
  unregister: vi.fn(),
  get: vi.fn(),
  list: vi.fn(() => []),
  search: vi.fn(() => []),
  execute: vi.fn(async () => ({ success: false, error: 'not-implemented', durationMs: 0 })),
  toAgentTools: vi.fn(() => []),
};

vi.mock('../llm/registry', () => ({
  llmRegistry: { getDefault: vi.fn(() => null), list: vi.fn(() => []), register: vi.fn(), get: vi.fn(), unregister: vi.fn() },
}));

vi.mock('../tools/tool-registry', () => ({
  getToolRegistry: () => mockRegistry,
  createToolExecutor: () => ({
    execute: async () => 'ok',
    listTools: () => [],
  }),
}));

vi.mock('../tools/builtin-tools', () => ({
  initializeBuiltinTools: vi.fn(),
}));

vi.mock('../sse/index', () => ({
  getSSEClientManager: () => ({
    sendToJob: vi.fn(),
    addClient: vi.fn(),
    removeClient: vi.fn(),
  }),
}));

vi.mock('../store/job-store', () => ({
  jobStore: { get: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn(), list: vi.fn() },
}));

// ── Mock LLM Provider ──────────────────────────────────────────────────────────

class MockLLMProvider implements LLMProvider {
  name = 'mock-provider';
  modelId = 'mock-model';
  description = 'Mock provider for tests';
  contextWindow = 64000;

  /** 质量关卡评分序列（evaluateGate 调用） */
  gateResponses: number[] = [];
  gateCalls = 0;

  /** Agent 执行响应序列：字符串内容或 Error（抛错模拟 LLM 故障） */
  agentResponses: Array<string | Error> = [];
  agentCalls = 0;

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResponse> {
    if (options?.responseFormat === 'json_object') {
      const score =
        this.gateResponses.length > 0
          ? this.gateResponses[Math.min(this.gateCalls, this.gateResponses.length - 1)] ?? 85
          : 85;
      this.gateCalls += 1;
      return {
        content: JSON.stringify({
          format: score,
          consistency: score,
          coherence: score,
          dramaticTension: score,
          overall: score,
          suggestions: [],
        }),
        model: this.modelId,
      };
    }

    const idx = Math.min(this.agentCalls, Math.max(this.agentResponses.length - 1, 0));
    this.agentCalls += 1;
    const response = this.agentResponses.length > 0 ? this.agentResponses[idx] : '任务完成，输出结构化结果。';
    if (response instanceof Error) throw response;
    return { content: response, model: this.modelId };
  }

  async *chatStream(): AsyncGenerator<{ type: 'done' }> {
    yield { type: 'done' };
  }

  supportsJSONMode(): boolean {
    return true;
  }

  async estimateTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }
}

// ── 内存持久化（JSON 深拷贝模拟 SQLite 序列化往返） ─────────────────────────────

class MemoryPersistence implements AgentTaskPersistence {
  private store = new Map<string, { task: OrchestratorTask; status: AgentTaskStatus }>();

  upsert(task: OrchestratorTask, status: AgentTaskStatus = 'active'): void {
    this.store.set(task.id, { task: JSON.parse(JSON.stringify(task)), status });
  }

  loadActive(): Array<{ task: OrchestratorTask }> {
    return [...this.store.values()]
      .filter((r) => r.status === 'active')
      .map((r) => ({ task: r.task }));
  }

  get(taskId: string): OrchestratorTask | undefined {
    return this.store.get(taskId)?.task;
  }

  getStatus(taskId: string): AgentTaskStatus | undefined {
    return this.store.get(taskId)?.status;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function waitForCompletion(
  orch: MultiAgentOrchestrator,
  taskId: string,
  timeoutMs = 5000,
): Promise<OrchestratorTask> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = orch.getTask(taskId);
    if (
      task &&
      task.phases.every((p) => p.status !== 'running') &&
      task.phases.some((p) => p.status !== 'pending')
    ) {
      return task;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
}

function buildTaskWithPhases(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  const id = overrides.id ?? 'task-' + Math.random().toString(36).slice(2, 10);
  const base: OrchestratorTask = {
    id,
    input: '第一章 风起',
    phaseCount: 4,
    phases: [
      { id: `${id}-analyze`, name: 'analyze', description: '', role: 'analyzer', status: 'completed', retryCount: 0 },
      { id: `${id}-segment`, name: 'segment', description: '', role: 'writer', status: 'completed', retryCount: 0 },
      { id: `${id}-convert`, name: 'convert', description: '', role: 'writer', status: 'completed', retryCount: 0 },
      { id: `${id}-merge`, name: 'merge', description: '', role: 'editor', status: 'awaiting', retryCount: 1, error: '质量未达标（待人工介入）' },
    ],
    awaiting: {
      phaseId: `${id}-merge`,
      phaseName: 'merge',
      reason: 'merge 质量未达标',
      decision: 'fail',
    },
    ...overrides,
  };
  return base;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MultiAgentOrchestrator 持久化（P-记忆）', () => {
  beforeEach(() => {
    mockRegistry.list.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('startConversion 持久化', () => {
    it('创建任务后立即写入持久化（active + 全量 phases + userId）', () => {
      const persistence = new MemoryPersistence();
      const orch = new MultiAgentOrchestrator({ provider: new MockLLMProvider(), persistence });
      const taskId = orch.startConversion({
        novelText: '第一章 风起',
        title: '测试剧本',
        userId: 'user-1',
      });

      const saved = persistence.get(taskId);
      expect(saved).toBeDefined();
      expect(saved?.userId).toBe('user-1');
      expect(saved?.phases).toHaveLength(4);
      expect(saved?.phases.every((p) => p.status === 'pending')).toBe(true);
      expect(persistence.getStatus(taskId)).toBe('active');
    });

    it('未注入 persistence 时纯内存运行不抛错', () => {
      const orch = new MultiAgentOrchestrator({ provider: new MockLLMProvider() });
      expect(() => orch.startConversion({ novelText: '第一章 风起' })).not.toThrow();
    });
  });

  describe('任务流转持久化', () => {
    it('全流程完成后终态标记 completed', async () => {
      const persistence = new MemoryPersistence();
      const orch = new MultiAgentOrchestrator({ provider: new MockLLMProvider(), persistence });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      await waitForCompletion(orch, taskId);

      expect(persistence.getStatus(taskId)).toBe('completed');
      const saved = persistence.get(taskId);
      expect(saved?.phases.every((p) => p.status === 'completed')).toBe(true);
    });

    it('merge 挂起 awaiting 时持久化快照含挂起信息', async () => {
      const provider = new MockLLMProvider();
      provider.gateResponses = [85, 85, 85, 40, 40]; // merge 首次 fail + 重试仍 fail → awaiting
      const persistence = new MemoryPersistence();
      const orch = new MultiAgentOrchestrator({ provider, persistence });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      const task = await waitForCompletion(orch, taskId);
      expect(task.awaiting).toBeDefined();

      const saved = persistence.get(taskId);
      expect(saved?.awaiting?.phaseName).toBe('merge');
      expect(saved?.phases.find((p) => p.name === 'merge')?.status).toBe('awaiting');
      expect(persistence.getStatus(taskId)).toBe('active'); // 挂起仍属未完成任务
    });
  });

  describe('重启恢复 restoreFromPersistence', () => {
    it('恢复挂起任务：保持 awaiting 挂起、不自动续跑', async () => {
      const provider = new MockLLMProvider();
      provider.gateResponses = [85, 85, 85, 40, 40];
      const persistence = new MemoryPersistence();
      const orch1 = new MultiAgentOrchestrator({ provider, persistence });
      const taskId = orch1.startConversion({ novelText: '第一章 风起' });
      await waitForCompletion(orch1, taskId);
      expect(orch1.getTask(taskId)?.awaiting).toBeDefined();

      // 模拟服务重启：新 orchestrator 实例 + 同一持久化存储
      const provider2 = new MockLLMProvider();
      const orch2 = new MultiAgentOrchestrator({ provider: provider2, persistence });
      await orch2.restoreFromPersistence();

      const restored = orch2.getTask(taskId);
      expect(restored).toBeDefined();
      expect(restored?.awaiting).toBeDefined();
      expect(restored?.phases.find((p) => p.name === 'merge')?.status).toBe('awaiting');
      // 挂起任务不自动续跑（新 provider 未被调用）
      expect(provider2.agentCalls).toBe(0);
      expect(provider2.gateCalls).toBe(0);
    });

    it('恢复挂起任务后可通过人工介入 approve 完成', async () => {
      const taskId = 'task-awaiting-1';
      const task = buildTaskWithPhases({ id: taskId });
      const persistence = new MemoryPersistence();
      persistence.upsert(task, 'active');

      const orch = new MultiAgentOrchestrator({
        provider: new MockLLMProvider(),
        persistence,
      });
      await orch.restoreFromPersistence();

      const merge = orch.getTask(taskId)?.phases.find((p) => p.name === 'merge');
      expect(merge?.status).toBe('awaiting');

      const ok = orch.resolveManualReview(taskId, merge?.id ?? '', 'approve');
      expect(ok).toBe(true);

      await waitForCompletion(orch, taskId);
      expect(orch.getTask(taskId)?.phases.every((p) => p.status === 'completed')).toBe(true);
      expect(persistence.getStatus(taskId)).toBe('completed');
    });

    it('恢复崩溃遗留 running 阶段任务：自动续跑至完成', async () => {
      const taskId = 'task-crashed-1';
      const task: OrchestratorTask = {
        id: taskId,
        input: '第一章 风起',
        phaseCount: 4,
        phases: [
          { id: `${taskId}-analyze`, name: 'analyze', description: '', role: 'analyzer', status: 'completed', retryCount: 0, output: { agentResult: '已有分析结果' } },
          { id: `${taskId}-segment`, name: 'segment', description: '', role: 'writer', status: 'running', retryCount: 0 }, // 崩溃遗留
          { id: `${taskId}-convert`, name: 'convert', description: '', role: 'writer', status: 'pending', retryCount: 0 },
          { id: `${taskId}-merge`, name: 'merge', description: '', role: 'editor', status: 'pending', retryCount: 0 },
        ],
      };
      const persistence = new MemoryPersistence();
      persistence.upsert(task, 'active');

      const provider = new MockLLMProvider();
      provider.gateResponses = [85, 85, 85];
      const orch = new MultiAgentOrchestrator({ provider, persistence });
      await orch.restoreFromPersistence();

      const done = await waitForCompletion(orch, taskId);
      expect(done.phases.every((p) => p.status === 'completed')).toBe(true);
      // running 阶段被置回 pending 并重新执行（LLM 被调用）
      expect(provider.agentCalls).toBeGreaterThan(0);
      expect(persistence.getStatus(taskId)).toBe('completed');
    });

    it('无 persistence 时 restoreFromPersistence 为 no-op', async () => {
      const orch = new MultiAgentOrchestrator({ provider: new MockLLMProvider() });
      await expect(orch.restoreFromPersistence()).resolves.toBeUndefined();
    });
  });
});
