import { describe, it, expect, beforeEach } from 'vitest';
import { getNovelVersionRepository } from '@/lib/store/sqlite/novel-version-repository';
import { getDatabase } from '@/lib/store/sqlite/db';

describe('novel_versions · 版本记录（FIX-24）', () => {
  const repo = getNovelVersionRepository();

  beforeEach(() => {
    getDatabase();
  });

  it('create → listByNovel 往返字段完整', () => {
    const novelId = `novel_${Date.now()}_a`;
    const id = repo.create({
      novelId,
      jobId: 'job_1',
      formatVersion: 'novel2screenplay-v1',
      promptHash: 'abc123def456abcd',
    });

    const versions = repo.listByNovel(novelId);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id,
      novelId,
      jobId: 'job_1',
      formatVersion: 'novel2screenplay-v1',
      promptHash: 'abc123def456abcd',
    });
    expect(typeof versions[0].createdAt).toBe('number');
  });

  it('多版本按 created_at 倒序（最新在前）', async () => {
    const novelId = `novel_${Date.now()}_b`;
    repo.create({ novelId, jobId: 'job_old', formatVersion: 'v1', promptHash: 'h1' });
    // 毫秒级时间戳需错开，避免同 ms 并列导致排序断言不稳定
    await new Promise((r) => setTimeout(r, 5));
    repo.create({ novelId, jobId: 'job_new', formatVersion: 'v1', promptHash: 'h2' });

    const versions = repo.listByNovel(novelId);
    expect(versions.map((v) => v.jobId)).toEqual(['job_new', 'job_old']);
  });

  it('不同小说互不串扰', () => {
    const a = `novel_${Date.now()}_c1`;
    const b = `novel_${Date.now()}_c2`;
    repo.create({ novelId: a, jobId: 'job_a', formatVersion: 'v1', promptHash: 'ha' });
    repo.create({ novelId: b, jobId: 'job_b', formatVersion: 'v1', promptHash: 'hb' });

    expect(repo.listByNovel(a).map((v) => v.jobId)).toEqual(['job_a']);
    expect(repo.listByNovel(b).map((v) => v.jobId)).toEqual(['job_b']);
  });
});
