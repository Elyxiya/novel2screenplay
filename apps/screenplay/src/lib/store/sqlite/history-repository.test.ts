// @vitest-environment node
/**
 * history-repository：历史记录 CRUD + 用户隔离删除专项测试
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getHistoryRepository, getJobRepository, getUserRepository } from '.';
import { getDatabase, closeDatabase } from './db';
import { hashPassword } from '@/lib/auth/password';

describe('history-repository', () => {
  const historyRepo = getHistoryRepository();
  const jobRepo = getJobRepository();
  const userRepo = getUserRepository();

  let userA: string;
  let userB: string;

  const baseJob = {
    novelText: '历史任务正文',
    chapterTexts: ['第1章'],
    modelId: 'test-model',
    selectedChapters: [0],
    temperature: 0.7,
  };

  /** 创建真实 job 并写一条历史记录 */
  const createHistory = (userId: string, title: string, jobUserId?: string) => {
    const jobId = jobRepo.create({ ...baseJob, userId: jobUserId ?? userId });
    historyRepo.create({ jobId, title, userId });
    return jobId;
  };

  beforeAll(async () => {
    getDatabase();
    const hash = await hashPassword('pass-123');
    userA = userRepo.create({ username: '历史用户A', passwordHash: hash });
    userB = userRepo.create({ username: '历史用户B', passwordHash: hash });
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM history WHERE user_id IN (?, ?)').run(userA, userB);
    db.prepare('DELETE FROM jobs WHERE user_id IN (?, ?)').run(userA, userB);
  });

  afterAll(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM history WHERE user_id IN (?, ?)').run(userA, userB);
    db.prepare('DELETE FROM jobs WHERE user_id IN (?, ?)').run(userA, userB);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(userA, userB);
    closeDatabase();
  });

  it('create + getByJobId：写入后可通过 jobId 检索', () => {
    const jobId = createHistory(userA, '第一转换');
    const row = historyRepo.getByJobId(jobId)!;
    expect(row).not.toBeNull();
    expect(row.title).toBe('第一转换');
    expect(row.jobId).toBe(jobId);
    // 归属校验：history 行 user_id 写入正确
    const raw = getDatabase().prepare('SELECT user_id FROM history WHERE job_id = ?').get(jobId) as { user_id: string };
    expect(raw.user_id).toBe(userA);
  });

  it('create 携带完整统计字段并可往返', () => {
    const jobId = jobRepo.create({ ...baseJob, userId: userA });
    historyRepo.create({
      jobId,
      title: '带统计',
      author: '作者甲',
      sceneCount: 5,
      characterCount: 3,
      locationCount: 2,
      userId: userA,
    });
    const row = historyRepo.getByJobId(jobId)!;
    expect(row.author).toBe('作者甲');
    expect(row.sceneCount).toBe(5);
    expect(row.characterCount).toBe(3);
    expect(row.locationCount).toBe(2);
  });

  it('listRecent：按 userId 过滤，且按时间倒序', async () => {
    const jobA1 = createHistory(userA, 'A1');
    await new Promise((r) => setTimeout(r, 5)); // 保证 created_at 可区分
    const jobA2 = createHistory(userA, 'A2');
    createHistory(userB, 'B1');

    const aList = historyRepo.listRecent(10, userA);
    expect(aList.map((h) => h.title)).toEqual(['A2', 'A1']); // 时间倒序
    expect(historyRepo.listRecent(10, userA).map((h) => h.title)).not.toContain('B1');

    const bList = historyRepo.listRecent(10, userB);
    expect(bList.map((h) => h.title)).toEqual(['B1']);
    expect(historyRepo.getByJobId(jobA2)?.title).toBe('A2');
    expect(historyRepo.getByJobId(jobA1)?.title).toBe('A1');
  });

  it('deleteByJobId：无 userId 时删除全部匹配，带 userId 时仅删除归属该用户', () => {
    const jobShared = jobRepo.create({ ...baseJob, userId: userA });
    // 同 jobId 不可能写两条（job_id 唯一场景未强制），此处验证删除归属过滤
    historyRepo.create({ jobId: jobShared, title: 'A的记录', userId: userA });

    // B 删 A 的记录：无归属权限时不受影响（按 userId 过滤）
    historyRepo.deleteByJobId(jobShared, userB);
    expect(historyRepo.getByJobId(jobShared)).not.toBeNull();

    // A 删除自己的记录
    historyRepo.deleteByJobId(jobShared, userA);
    expect(historyRepo.getByJobId(jobShared)).toBeNull();
  });

  it('deleteByJobId：不传 userId 时删除所有匹配记录', () => {
    const jobId = createHistory(userA, '待删');
    expect(historyRepo.getByJobId(jobId)).not.toBeNull();
    historyRepo.deleteByJobId(jobId);
    expect(historyRepo.getByJobId(jobId)).toBeNull();
  });

  it('clearByUser：仅清空指定用户的历史，不影响他人', () => {
    createHistory(userA, 'A保留前');
    createHistory(userB, 'B保留');

    historyRepo.clearByUser(userA);
    expect(historyRepo.listRecent(10, userA)).toHaveLength(0);
    expect(historyRepo.listRecent(10, userB).map((h) => h.title)).toEqual(['B保留']);
  });

  it('clearByUser：无 userId 时清空全部', () => {
    createHistory(userA, 'A全清');
    createHistory(userB, 'B全清');
    historyRepo.clearByUser();
    expect(historyRepo.listRecent(10, userA)).toHaveLength(0);
    expect(historyRepo.listRecent(10, userB)).toHaveLength(0);
  });

  it('delete：按历史 id 删除', () => {
    const jobId = createHistory(userA, '按id删');
    const row = historyRepo.getByJobId(jobId)!;
    historyRepo.delete(row.id);
    expect(historyRepo.getByJobId(jobId)).toBeNull();
  });
});
