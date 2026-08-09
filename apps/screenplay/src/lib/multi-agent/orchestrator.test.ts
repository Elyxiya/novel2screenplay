/**
 * MultiAgentOrchestrator 单元测试
 *
 * 覆盖：
 * - startConversion 初始化任务
 * - 全流程成功（注入 mock LLM Provider，AgentCore 真实执行）
 * - 质量关卡失败触发自动重试
 * - Agent 阶段异常导致失败并终止后续阶段
 * - 无 LLM Provider 时的错误处理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMProvider, LLMMessage, LLMChatOptions, LLMChatResponse } from '../llm/types';
import { MultiAgentOrchestrator, type OrchestratorTask } from './orchestrator';

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

// ── Helpers ────────────────────────────────────────────────────────────────────

async function waitForCompletion(
  orch: MultiAgentOrchestrator,
  taskId: string,
  timeoutMs = 5000,
): Promise<OrchestratorTask> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = orch.getTask(taskId);
    // 任务稳定：没有阶段处于运行中，且至少一个阶段进入终态
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MultiAgentOrchestrator', () => {
  beforeEach(() => {
    mockRegistry.list.mockReturnValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('startConversion', () => {
    it('创建任务并初始化 4 个 pending 阶段', () => {
      const orch = new MultiAgentOrchestrator({ provider: new MockLLMProvider() });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      expect(taskId).toBeTruthy();
      const task = orch.getTask(taskId);
      expect(task).toBeDefined();
      expect(task?.phases).toHaveLength(4);
      expect(task?.phases.map((p) => p.name)).toEqual(['analyze', 'segment', 'convert', 'merge']);
    });
  });

  describe('full execution', () => {
    it('全流程成功：4 个阶段全部 completed', async () => {
      const orch = new MultiAgentOrchestrator({ provider: new MockLLMProvider() });
      const taskId = orch.startConversion({ novelText: '第一章 风起', title: '测试剧本' });

      const task = await waitForCompletion(orch, taskId);

      expect(task.phases.every((p) => p.status === 'completed')).toBe(true);
      expect(task.phases.every((p) => p.retryCount === 0)).toBe(true);
      const lastPhase = task.phases[task.phases.length - 1];
      expect(lastPhase.output).toBeDefined();
      expect(lastPhase.completedAt).toBeGreaterThanOrEqual(lastPhase.startedAt ?? 0);
    });
  });

  describe('review gate', () => {
    it('质量不达标时自动重试，重试通过后继续', async () => {
      const provider = new MockLLMProvider();
      // analyze 第一次评分 40 → fail → 重试评分 85 → pass；其余阶段 85
      provider.gateResponses = [40, 85, 85, 85, 85];

      const orch = new MultiAgentOrchestrator({ provider });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      const task = await waitForCompletion(orch, taskId);

      const analyze = task.phases.find((p) => p.name === 'analyze');
      expect(analyze?.status).toBe('completed');
      expect(analyze?.retryCount).toBe(1);
      expect(provider.gateCalls).toBe(5);
      expect(task.phases.every((p) => p.status === 'completed')).toBe(true);
    });

    it('关闭质量关卡时不触发 gate 评估', async () => {
      const provider = new MockLLMProvider();
      provider.gateResponses = [10]; // 即使低分也不会 fail（关卡关闭）

      const orch = new MultiAgentOrchestrator({ provider, enableReviewGates: false });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      const task = await waitForCompletion(orch, taskId);

      expect(provider.gateCalls).toBe(0);
      expect(task.phases.every((p) => p.status === 'completed')).toBe(true);
    });
  });

  describe('failure handling', () => {
    it('阶段异常时标记 failed 并终止后续阶段', async () => {
      const provider = new MockLLMProvider();
      provider.agentResponses = [new Error('LLM API down')];

      const orch = new MultiAgentOrchestrator({ provider });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      const task = await waitForCompletion(orch, taskId);

      const analyze = task.phases.find((p) => p.name === 'analyze');
      expect(analyze?.status).toBe('failed');
      expect(analyze?.error).toContain('LLM API down');

      const segment = task.phases.find((p) => p.name === 'segment');
      expect(['pending', 'skipped']).toContain(segment?.status);
    });

    it('未配置 LLM Provider 时阶段失败并提示配置', async () => {
      const orch = new MultiAgentOrchestrator(); // 不注入 provider，registry 默认返回 null
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      const task = await waitForCompletion(orch, taskId);

      const analyze = task.phases.find((p) => p.name === 'analyze');
      expect(analyze?.status).toBe('failed');
      expect(analyze?.error).toContain('未配置 LLM Provider');
    });
  });

  describe('manual review gate（人工介入）', () => {
    const mergePhaseId = (task: OrchestratorTask) =>
      task.phases.find((p) => p.name === 'merge')?.id ?? '';

    it('merge 重试耗尽后进入 awaiting 挂起，而非直接失败', async () => {
      const provider = new MockLLMProvider();
      // analyze/segment/convert pass(85)，merge 首次 fail(40) + 重试仍 fail(40)
      provider.gateResponses = [85, 85, 85, 40, 40];

      const orch = new MultiAgentOrchestrator({ provider });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      const task = await waitForCompletion(orch, taskId);

      const merge = task.phases.find((p) => p.name === 'merge');
      expect(merge?.status).toBe('awaiting');
      expect(merge?.retryCount).toBe(1); // 自动重试 1 次（maxRetries=1）
      expect(task.awaiting).toBeDefined();
      expect(task.awaiting?.phaseId).toBe(merge?.id);
      expect(task.awaiting?.phaseName).toBe('merge');
      // 任务未标记失败、也未标记完成
      expect(task.phases.some((p) => p.status === 'failed')).toBe(false);
      expect(task.phases.every((p) => p.status === 'completed')).toBe(false);
    });

    it('review 临界区决策同样进入 awaiting 挂起', async () => {
      const provider = new MockLLMProvider();
      // merge 分数 80 ∈ [75, 85) 临界区 → review 决策 → 重试仍 review → awaiting
      provider.gateResponses = [85, 85, 85, 80, 80];

      const orch = new MultiAgentOrchestrator({ provider });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      const task = await waitForCompletion(orch, taskId);

      const merge = task.phases.find((p) => p.name === 'merge');
      expect(merge?.status).toBe('awaiting');
      expect(task.awaiting?.decision).toBe('review');
    });

    it('approve 后接受输出，任务继续完成', async () => {
      const provider = new MockLLMProvider();
      provider.gateResponses = [85, 85, 85, 40, 40];

      const orch = new MultiAgentOrchestrator({ provider });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      let task = await waitForCompletion(orch, taskId);
      expect(task.awaiting).toBeDefined();

      const ok = orch.resolveManualReview(taskId, mergePhaseId(task), 'approve');
      expect(ok).toBe(true);

      task = await waitForCompletion(orch, taskId);
      expect(task.phases.every((p) => p.status === 'completed')).toBe(true);
      expect(task.awaiting).toBeUndefined();
    });

    it('retry 后重新生成该阶段，评分达标则完成', async () => {
      const provider = new MockLLMProvider();
      // 挂起后人工 retry 重跑 merge → 85 达标
      provider.gateResponses = [85, 85, 85, 40, 40, 85];

      const orch = new MultiAgentOrchestrator({ provider });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      let task = await waitForCompletion(orch, taskId);
      expect(task.awaiting).toBeDefined();

      const ok = orch.resolveManualReview(taskId, mergePhaseId(task), 'retry');
      expect(ok).toBe(true);

      task = await waitForCompletion(orch, taskId);
      const merge = task.phases.find((p) => p.name === 'merge');
      expect(merge?.status).toBe('completed');
      expect(merge?.retryCount).toBe(2); // 1 次自动 + 1 次人工
    });

    it('discard 后阶段失败，任务终止', async () => {
      const provider = new MockLLMProvider();
      provider.gateResponses = [85, 85, 85, 40, 40];

      const orch = new MultiAgentOrchestrator({ provider });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      let task = await waitForCompletion(orch, taskId);
      expect(task.awaiting).toBeDefined();

      const ok = orch.resolveManualReview(taskId, mergePhaseId(task), 'discard');
      expect(ok).toBe(true);

      task = await waitForCompletion(orch, taskId);
      const merge = task.phases.find((p) => p.name === 'merge');
      expect(merge?.status).toBe('failed');
      expect(merge?.error).toContain('人工放弃');
      expect(task.phases.some((p) => p.status === 'failed')).toBe(true);
    });

    it('对不在 awaiting 状态的阶段 resolve 返回 false', async () => {
      const provider = new MockLLMProvider();
      provider.gateResponses = [85, 85, 85, 40, 40];

      const orch = new MultiAgentOrchestrator({ provider });
      const taskId = orch.startConversion({ novelText: '第一章 风起' });

      const task = await waitForCompletion(orch, taskId);
      const analyze = task.phases.find((p) => p.name === 'analyze');
      expect(orch.resolveManualReview(taskId, analyze?.id ?? '', 'approve')).toBe(false);
    });
  });
});
