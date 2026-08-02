/**
 * builtin-tools 单元测试
 *
 * 覆盖：
 * - initializeBuiltinTools 注册 8 个内置工具
 * - pipeline.status / storage.result 对不存在任务返回错误
 * - analysis.characters / analysis.locations 无 LLM 时返回配置错误
 * - storage.history 真实调用 history repository 并返回 id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from './tool-registry';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const registered: ToolDefinition[] = [];

const registryStub = {
  register: (def: ToolDefinition) => {
    registered.push(def);
  },
  unregister: vi.fn(),
  get: (id: string) => registered.find((t) => t.id === id),
  list: () => registered,
  search: vi.fn(() => []),
  execute: vi.fn(async () => ({ success: false, error: 'not-implemented', durationMs: 0 })),
  toAgentTools: () => registered.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
};

vi.mock('./tool-registry', () => ({
  getToolRegistry: () => registryStub,
  createToolExecutor: vi.fn(),
}));

vi.mock('../llm/registry', () => ({
  llmRegistry: {
    getDefault: vi.fn(() => null),
    list: vi.fn(() => []),
    register: vi.fn(),
    get: vi.fn(),
    unregister: vi.fn(),
  },
}));

vi.mock('../store/sqlite', () => ({
  getHistoryRepository: () => ({
    create: vi.fn(() => 'hist_001'),
    get: vi.fn(),
    list: vi.fn(() => []),
    delete: vi.fn(),
  }),
  getJobRepository: () => ({
    create: vi.fn(() => 'job_001'),
    get: vi.fn(),
    list: vi.fn(() => []),
    update: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock('../store/job-store', () => ({
  jobStore: {
    get: vi.fn(() => undefined),
    update: vi.fn(),
    create: vi.fn(() => 'job_001'),
    delete: vi.fn(),
    list: vi.fn(() => []),
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('builtin-tools', () => {
  beforeEach(() => {
    registered.length = 0;
    vi.clearAllMocks();
  });

  describe('initializeBuiltinTools', () => {
    it('注册 8 个内置工具且分类正确', async () => {
      const { initializeBuiltinTools } = await import('./builtin-tools');
      initializeBuiltinTools();

      expect(registered).toHaveLength(8);
      const ids = registered.map((t) => t.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          'pipeline.start',
          'pipeline.status',
          'pipeline.cancel',
          'analysis.characters',
          'analysis.locations',
          'conversion.merge',
          'storage.history',
          'storage.result',
        ]),
      );

      const pipelineTools = registered.filter((t) => t.category === 'pipeline');
      expect(pipelineTools.length).toBe(3);
      const storageTools = registered.filter((t) => t.category === 'storage');
      expect(storageTools.length).toBe(2);
    });
  });

  describe('pipeline.status', () => {
    it('任务不存在时返回错误', async () => {
      const { initializeBuiltinTools } = await import('./builtin-tools');
      initializeBuiltinTools();

      const handler = registered.find((t) => t.id === 'pipeline.status')?.handler;
      expect(handler).toBeDefined();

      const result = await handler?.({ jobId: 'nope' }, { taskId: 't', agentRole: 'analyzer' });
      expect(result).toEqual({ error: '任务不存在' });
    });
  });

  describe('analysis tools', () => {
    it('characters 工具在未配置 LLM 时返回配置错误', async () => {
      const { initializeBuiltinTools } = await import('./builtin-tools');
      initializeBuiltinTools();

      const handler = registered.find((t) => t.id === 'analysis.characters')?.handler;
      const result = await handler?.({ text: '张三说你好。' }, { taskId: 't', agentRole: 'analyzer' });
      expect(result).toEqual({ error: '未配置 LLM Provider，请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY' });
    });

    it('locations 工具在未配置 LLM 时返回配置错误', async () => {
      const { initializeBuiltinTools } = await import('./builtin-tools');
      initializeBuiltinTools();

      const handler = registered.find((t) => t.id === 'analysis.locations')?.handler;
      const result = await handler?.({ text: '他们在北京见面。' }, { taskId: 't', agentRole: 'analyzer' });
      expect(result).toEqual({ error: '未配置 LLM Provider，请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY' });
    });
  });

  describe('storage tools', () => {
    it('storage.result 任务不存在时返回错误', async () => {
      const { initializeBuiltinTools } = await import('./builtin-tools');
      initializeBuiltinTools();

      const handler = registered.find((t) => t.id === 'storage.result')?.handler;
      const result = await handler?.({ jobId: 'nope' }, { taskId: 't', agentRole: 'editor' });
      expect(result).toEqual({ error: '任务不存在' });
    });

    it('storage.history 保存成功并返回 historyId', async () => {
      const { initializeBuiltinTools } = await import('./builtin-tools');
      initializeBuiltinTools();

      const handler = registered.find((t) => t.id === 'storage.history')?.handler;
      const result = await handler?.(
        { jobId: 'job_1', title: '测试剧本', yamlContent: 'title: 测试' },
        { taskId: 't', agentRole: 'editor' },
      );
      expect(result).toEqual({ success: true, historyId: 'hist_001' });
    });
  });
});
