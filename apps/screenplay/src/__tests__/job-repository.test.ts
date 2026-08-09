// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getJobRepository } from '@/lib/store/sqlite/job-repository';

describe('job-repository subProgress 对象序列化', () => {
  const repo = getJobRepository();
  let jobId: string;

  beforeAll(() => {
    jobId = repo.create({
      novelText: '测试文本',
      chapterTexts: ['第一章'],
      modelId: 'deepseek-chat',
      selectedChapters: [0],
      temperature: 0.5,
    });
  });

  it('update 传对象不再抛 SQLite 绑定错误，且能往返还原', () => {
    expect(() => repo.update(jobId, { subProgress: { totalScenes: 3, completedScenes: 1 } })).not.toThrow();
    const job = repo.get(jobId)!;
    expect(job.subProgress).toEqual({ totalScenes: 3, completedScenes: 1 });
  });

  it('update 传 null 正常绑定', () => {
    expect(() => repo.update(jobId, { subProgress: null })).not.toThrow();
    const job = repo.get(jobId)!;
    expect(job.subProgress).toBeNull();
  });

  it('update 递增 subProgress 正常', () => {
    repo.update(jobId, { subProgress: { totalScenes: 3, completedScenes: 2 } });
    expect(repo.get(jobId)!.subProgress).toEqual({ totalScenes: 3, completedScenes: 2 });
  });

  afterAll(() => {
    repo.delete(jobId);
  });
});
