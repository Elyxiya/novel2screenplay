// @vitest-environment node
/**
 * 多用户数据隔离：novels / jobs / history 按 user_id 过滤
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getNovelRepository, getJobRepository, getHistoryRepository, getUserRepository } from '.';
import { getDatabase, closeDatabase } from './db';
import { hashPassword } from '@novel/auth/password';

describe('多用户数据隔离', () => {
  const novelRepo = getNovelRepository();
  const jobRepo = getJobRepository();
  const historyRepo = getHistoryRepository();
  const userRepo = getUserRepository();

  let userA: string;
  let userB: string;

  beforeAll(async () => {
    getDatabase();
    const hash = await hashPassword('pass-123');
    userA = userRepo.create({ username: '隔离用户A', passwordHash: hash });
    userB = userRepo.create({ username: '隔离用户B', passwordHash: hash });
  });

  afterAll(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(userA, userB);
    db.prepare('DELETE FROM novels WHERE user_id IN (?, ?)').run(userA, userB);
    db.prepare('DELETE FROM jobs WHERE user_id IN (?, ?)').run(userA, userB);
    db.prepare('DELETE FROM history WHERE user_id IN (?, ?)').run(userA, userB);
    closeDatabase();
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM novels WHERE user_id IN (?, ?)').run(userA, userB);
    db.prepare('DELETE FROM jobs WHERE user_id IN (?, ?)').run(userA, userB);
    db.prepare('DELETE FROM history WHERE user_id IN (?, ?)').run(userA, userB);
  });

  const chapter = (index: number, title: string, text: string) => ({
    index, title, paragraphCount: text.split('\n').filter(Boolean).length, text,
  });

  it('novels：A 创建的资产仅 A 可见，B 的 findByText 找不到', () => {
    const novelText = '隔离小说\n第1章 起\n正文一';
    const id = novelRepo.create({
      title: '隔离小说',
      novelText,
      chapters: [chapter(0, '第1章', '第1章 起\n正文一')],
      userId: userA,
    });

    expect(novelRepo.list(userA).map((n) => n.id)).toContain(id);
    expect(novelRepo.list(userB).map((n) => n.id)).not.toContain(id);
    expect(novelRepo.findByText(novelText, userA)?.id).toBe(id);
    expect(novelRepo.findByText(novelText, userB)).toBeNull();
    expect(novelRepo.get(id)?.userId).toBe(userA);
  });

  it('jobs：A 创建的转换任务仅 A 的 list 可见', () => {
    const base = {
      novelText: '任务正文',
      chapterTexts: ['第1章'],
      modelId: 'test-model',
      selectedChapters: [0],
      temperature: 0.7,
    };
    const idA = jobRepo.create({ ...base, userId: userA });
    const idB = jobRepo.create({ ...base, userId: userB });

    expect(jobRepo.list(undefined, userA).map((j) => j.id)).toContain(idA);
    expect(jobRepo.list(undefined, userA).map((j) => j.id)).not.toContain(idB);
    expect(jobRepo.list(undefined, userB).map((j) => j.id)).toContain(idB);
    expect(jobRepo.list(undefined, userB).map((j) => j.id)).not.toContain(idA);
    expect(jobRepo.get(idA)?.userId).toBe(userA);
  });

  it('history：A 的转换记录仅 A 的 listRecent 可见', () => {
    // history 对 job 有外键约束，先创建真实 job
    const base = {
      novelText: '任务正文',
      chapterTexts: ['第1章'],
      modelId: 'test-model',
      selectedChapters: [0],
      temperature: 0.7,
    };
    const jobA = jobRepo.create({ ...base, userId: userA });
    const jobB = jobRepo.create({ ...base, userId: userB });

    historyRepo.create({ jobId: jobA, title: 'A的记录', userId: userA });
    historyRepo.create({ jobId: jobB, title: 'B的记录', userId: userB });

    const aTitles = historyRepo.listRecent(20, userA).map((h) => h.title);
    const bTitles = historyRepo.listRecent(20, userB).map((h) => h.title);
    expect(aTitles).toContain('A的记录');
    expect(aTitles).not.toContain('B的记录');
    expect(bTitles).toContain('B的记录');
    expect(bTitles).not.toContain('A的记录');
  });
});
