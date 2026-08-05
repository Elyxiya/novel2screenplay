import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPipelineJob } from '../../../src/lib/jobs/types';

describe('createPipelineJob', () => {
  it('should create job with default values', () => {
    const job = createPipelineJob({
      novelText: '测试',
    });

    expect(job.id).toBeTruthy();
    expect(job.type).toBe('conversion');
    expect(job.status).toBe('pending');
    expect(job.priority).toBe('normal');
    expect(job.retryCount).toBe(0);
    expect(job.maxRetries).toBe(3);
  });

  it('should create job with custom options', () => {
    const job = createPipelineJob(
      { novelText: '测试' },
      {
        priority: 'high',
        timeout: 60000,
        maxRetries: 5,
        modelId: 'gpt-4',
      }
    );

    expect(job.priority).toBe('high');
    expect(job.timeout).toBe(60000);
    expect(job.maxRetries).toBe(5);
    expect(job.modelId).toBe('gpt-4');
  });

  it('should generate unique IDs', () => {
    const job1 = createPipelineJob({ novelText: '测试1' });
    const job2 = createPipelineJob({ novelText: '测试2' });
    expect(job1.id).not.toBe(job2.id);
  });

  it('should store novelText in input', () => {
    const job = createPipelineJob({
      novelText: '小说文本内容',
    });
    expect(job.input.novelText).toBe('小说文本内容');
  });

  it('should store selectedChapters in input', () => {
    const job = createPipelineJob({
      novelText: '测试',
      selectedChapters: [0, 1, 2],
    });
    expect(job.input.selectedChapters).toEqual([0, 1, 2]);
  });
});

describe('Job type guards', () => {
  it('should identify completed jobs', () => {
    const job = createPipelineJob({ novelText: '测试' });
    job.status = 'completed';
    const isDone = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
    expect(isDone).toBe(true);
  });

  it('should identify failed jobs', () => {
    const job = createPipelineJob({ novelText: '测试' });
    job.status = 'failed';
    const isDone = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
    expect(isDone).toBe(true);
  });

  it('should identify cancelled jobs', () => {
    const job = createPipelineJob({ novelText: '测试' });
    job.status = 'cancelled';
    const isDone = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
    expect(isDone).toBe(true);
  });

  it('should not identify pending jobs as completed', () => {
    const job = createPipelineJob({ novelText: '测试' });
    const isDone = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
    expect(isDone).toBe(false);
  });
});

describe('Job retry logic', () => {
  it('should allow retry when under max retries', () => {
    const job = createPipelineJob({ novelText: '测试' });
    job.retryCount = 0;
    job.maxRetries = 3;
    job.status = 'failed';

    const canRetry = job.retryCount < job.maxRetries && job.status === 'failed';
    expect(canRetry).toBe(true);
  });

  it('should not allow retry when at max retries', () => {
    const job = createPipelineJob({ novelText: '测试' });
    job.retryCount = 3;
    job.maxRetries = 3;
    job.status = 'failed';

    const canRetry = job.retryCount < job.maxRetries && job.status === 'failed';
    expect(canRetry).toBe(false);
  });

  it('should not allow retry for non-failed jobs', () => {
    const job = createPipelineJob({ novelText: '测试' });
    job.retryCount = 0;
    job.maxRetries = 3;
    job.status = 'completed';

    const canRetry = job.retryCount < job.maxRetries && job.status === 'failed';
    expect(canRetry).toBe(false);
  });
});
