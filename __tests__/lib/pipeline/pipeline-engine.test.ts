import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineEngine } from '../../../src/lib/pipeline/PipelineEngine';

// Mock dependencies
vi.mock('../../../src/lib/llm/registry', () => ({
  initializeProviders: vi.fn(),
  llmRegistry: {
    get: vi.fn().mockReturnValue({
      name: 'test-provider',
      modelId: 'test-model',
      chat: vi.fn().mockResolvedValue({ content: '{}' }),
    }),
    getDefault: vi.fn().mockReturnValue({
      name: 'test-provider',
      modelId: 'test-model',
      chat: vi.fn().mockResolvedValue({ content: '{}' }),
    }),
  },
}));

vi.mock('../../../src/lib/store/job-store', () => ({
  jobStore: {
    create: vi.fn().mockReturnValue('test-job-id'),
    get: vi.fn().mockReturnValue(null),
    update: vi.fn(),
  },
}));

vi.mock('../../../src/lib/sse/sse-client-manager', () => ({
  getSSEClientManager: vi.fn().mockReturnValue({
    sendToJob: vi.fn(),
  }),
}));

vi.mock('../../../src/lib/novel/parser', () => ({
  parseNovel: vi.fn().mockReturnValue({
    title: '测试小说',
    chapters: [
      { index: 0, title: '第一章', text: '测试内容', paragraphs: ['测试内容'] },
    ],
    warnings: [],
  }),
}));

describe('PipelineEngine', () => {
  let engine: PipelineEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new PipelineEngine();
  });

  describe('constructor', () => {
    it('should create engine instance', () => {
      expect(engine).toBeDefined();
    });
  });

  describe('startJob', () => {
    it('should throw error when novelText is empty', async () => {
      await expect(
        engine.startJob({ novelText: '' })
      ).rejects.toThrow('未检测到有效章节内容');
    });

    it('should throw error when no chapters detected', async () => {
      const { parseNovel } = await import('../../../src/lib/novel/parser');
      vi.mocked(parseNovel).mockReturnValueOnce({
        title: 'Test',
        chapters: [],
        warnings: [],
      });

      await expect(
        engine.startJob({ novelText: '无章节文本' })
      ).rejects.toThrow('未检测到有效章节内容');
    });

    it('should return jobId on success', async () => {
      const jobId = await engine.startJob({
        novelText: '测试小说内容',
        title: '测试标题',
        author: '测试作者',
      });

      expect(jobId).toBe('test-job-id');
    });
  });

  describe('getJobStatus', () => {
    it('should return undefined for non-existent job', () => {
      const { jobStore } = require('../../../src/lib/store/job-store');
      vi.mocked(jobStore.get).mockReturnValueOnce(undefined);

      const status = engine.getJobStatus('non-existent');
      expect(status).toBeUndefined();
    });
  });

  describe('cancelJob', () => {
    it('should handle non-existent job gracefully', () => {
      const { jobStore } = require('../../../src/lib/store/job-store');
      vi.mocked(jobStore.get).mockReturnValueOnce(undefined);

      // Should not throw
      engine.cancelJob('non-existent');
    });
  });
});
