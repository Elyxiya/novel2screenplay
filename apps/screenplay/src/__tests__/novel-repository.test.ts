// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getNovelRepository, type NovelRepository } from '@/lib/store/sqlite/novel-repository';
import { getDatabase, closeDatabase } from '@/lib/store/sqlite/db';

describe('novel-repository 小说资产与追加章节续转', () => {
  const repo: NovelRepository = getNovelRepository();
  const TEST_TITLE = '测试小说';
  let novelId: string;

  const chapter = (index: number, title: string, text: string) => ({
    index,
    title,
    paragraphCount: text.split('\n').filter(Boolean).length,
    text,
  });

  beforeAll(() => {
    getDatabase();
  });

  afterAll(() => {
    const db = getDatabase();
    // 清理本测试文件创建的数据（id 为 novel_ 前缀，按测试专用标题删除）
    db.prepare(`DELETE FROM novels WHERE title = ?`).run(TEST_TITLE);
    closeDatabase();
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare(`DELETE FROM novels WHERE title = ?`).run(TEST_TITLE);
    novelId = repo.create({
      title: TEST_TITLE,
      novelText: '第1章\n正文一\n\n第2章\n正文二\n\n第3章\n正文三',
      chapters: [
        chapter(0, '第一章', '第1章\n正文一'),
        chapter(1, '第二章', '第2章\n正文二'),
        chapter(2, '第三章', '第3章\n正文三'),
      ],
    });
  });

  it('create 后 get / list / findByText 正常', () => {
    const novel = repo.get(novelId)!;
    expect(novel.title).toBe('测试小说');
    expect(novel.totalChapters).toBe(3);
    expect(novel.convertedChapters).toEqual([]);
    expect(novel.chapterTexts).toHaveLength(3);

    const found = repo.findByText('第1章\n正文一\n\n第2章\n正文二\n\n第3章\n正文三');
    expect(found?.id).toBe(novelId);

    // 短文本互为前缀（更新稿件后全量重传）也应匹配
    const extended = repo.findByText('第1章\n正文一\n\n第2章\n正文二\n\n第3章\n正文三\n\n第4章\n正文四');
    expect(extended?.id).toBe(novelId);

    const summary = repo.list().find((s) => s.id === novelId);
    expect(summary?.totalChapters).toBe(3);
    expect(summary?.convertedCount).toBe(0);
  });

  it('markChaptersConverted 合并索引并更新 lastJobId', () => {
    repo.markChaptersConverted(novelId, [0], 'job_a');
    let novel = repo.get(novelId)!;
    expect(novel.convertedChapters).toEqual([0]);
    expect(novel.lastJobId).toBe('job_a');

    // 追加转换第 2 章，去重后合并
    repo.markChaptersConverted(novelId, [1, 1, 2], 'job_b');
    novel = repo.get(novelId)!;
    expect(novel.convertedChapters).toEqual([0, 1, 2]);
    expect(novel.convertedCount).toBe(3);
    expect(repo.list().find((s) => s.id === novelId)?.convertedCount).toBe(3);
  });

  it('appendChapters 只追加新章节并重排索引', () => {
    // 已有 3 章，前 2 章已转换；追传 4 章（含 2 个旧章节 + 2 个新章节）
    repo.markChaptersConverted(novelId, [0, 1], 'job_1');
    const added = repo.appendChapters(novelId, [
      chapter(0, '第一章', '第1章\n正文一'),          // 重复 → 跳过
      chapter(1, '第二章', '第2章\n正文二'),          // 重复 → 跳过
      chapter(2, '第三章', '第3章\n正文三'),          // 重复 → 跳过
      chapter(3, '第四章', '第4章\n正文四'),          // 新增
      chapter(4, '第五章', '第5章\n正文五'),          // 新增
    ]);
    expect(added).toBe(2);

    const novel = repo.get(novelId)!;
    expect(novel.totalChapters).toBe(5);
    expect(novel.convertedChapters).toEqual([0, 1]); // 旧标记保持不变
    expect(novel.chapterTexts[3]).toBe('第4章\n正文四');
    expect(novel.chapterTexts[4]).toBe('第5章\n正文五');
    expect(novel.chapters[3].index).toBe(3);
    expect(novel.chapters[4].index).toBe(4);
    // novel_text 保留原标题行，新章节追加在末尾（保证后续重传可前缀匹配）
    expect(novel.novelText.startsWith('第1章')).toBe(true);
    expect(novel.novelText.endsWith('第5章\n正文五')).toBe(true);
  });

  it('appendChapters 全量重传（含新章节）不产生重复章节', () => {
    const added = repo.appendChapters(novelId, [
      chapter(0, '第一章', '第1章\n正文一'),
      chapter(1, '第二章', '第2章\n正文二'),
      chapter(2, '第三章', '第3章\n正文三'),
      chapter(3, '第四章', '第4章\n正文四'),
      chapter(4, '第五章', '第5章\n正文五'),
    ]);
    expect(added).toBe(2);
    expect(repo.get(novelId)!.totalChapters).toBe(5);

    // 再次全量重传 → 无新增
    const again = repo.appendChapters(novelId, [
      chapter(0, '第一章', '第1章\n正文一'),
      chapter(1, '第二章', '第2章\n正文二'),
      chapter(2, '第三章', '第3章\n正文三'),
      chapter(3, '第四章', '第4章\n正文四'),
      chapter(4, '第五章', '第5章\n正文五'),
    ]);
    expect(again).toBe(0);
    expect(repo.get(novelId)!.totalChapters).toBe(5);
  });

  it('appendChapters 旧版本上传（章节数减少）不影响资产', () => {
    const added = repo.appendChapters(novelId, [
      chapter(0, '第一章', '第1章\n正文一'),
      chapter(1, '第二章', '第2章\n正文二'),
    ]);
    expect(added).toBe(0);
    expect(repo.get(novelId)!.totalChapters).toBe(3);
  });

  it('delete 删除资产', () => {
    repo.delete(novelId);
    expect(repo.get(novelId)).toBeNull();
  });
});
