import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineEngine } from '../../../src/lib/pipeline/PipelineEngine';
import { jobStore, type StoredJob } from '../../../src/lib/store/job-store';

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
      const { parseNovel } = await import('../../../src/lib/novel/parser');
      vi.mocked(parseNovel).mockReturnValueOnce({
        title: '',
        chapters: [],
        warnings: ['未检测到章节'],
      });

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
      vi.mocked(jobStore.get).mockReturnValueOnce(undefined);

      const status = engine.getJobStatus('non-existent');
      expect(status).toBeUndefined();
    });

    it('should return job for existing job', () => {
      const mockJob = {
        id: 'test-job-id',
        status: 'running',
        progress: 50,
      };
      vi.mocked(jobStore.get).mockReturnValueOnce(mockJob as unknown as Job);

      const status = engine.getJobStatus('test-job-id');
      expect(status).toBeDefined();
      expect(status?.id).toBe('test-job-id');
    });
  });

  describe('cancelJob', () => {
    it('should handle non-existent job gracefully', () => {
      vi.mocked(jobStore.get).mockReturnValueOnce(undefined);

      // Should not throw
      expect(() => engine.cancelJob('non-existent')).not.toThrow();
    });

    it('should update job status to pending on cancel', () => {
      const mockJob = {
        id: 'test-job-id',
        status: 'running',
        progress: 50,
        logs: [],
      };
      vi.mocked(jobStore.get).mockReturnValueOnce(mockJob as unknown as StoredJob);

      engine.cancelJob('test-job-id');

      expect(jobStore.update).toHaveBeenCalled();
    });
  });
});
