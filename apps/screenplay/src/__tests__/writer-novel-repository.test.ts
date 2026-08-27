// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getWriterNovelRepository, type WriterNovelRepository } from '@/lib/store/sqlite/writer-novel-repository';
import { getNovelRepository } from '@/lib/store/sqlite/novel-repository';
import { getDatabase, closeDatabase } from '@/lib/store/sqlite/db';

describe('writer-novel-repository 创作小说 CRUD', () => {
  const repo: WriterNovelRepository = getWriterNovelRepository();
  const TEST_TITLE = 'Writer测试小说';
  const TEST_USER = 'writer_test_user';
  let draftId: string;

  beforeAll(() => {
    getDatabase();
  });

  afterAll(() => {
    const db = getDatabase();
    db.prepare(`DELETE FROM novels WHERE title = ?`).run(TEST_TITLE);
    closeDatabase();
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare(`DELETE FROM novels WHERE title = ?`).run(TEST_TITLE);
    draftId = repo.createDraft({ title: TEST_TITLE, author: '测试作者', synopsis: '简介', userId: TEST_USER });
  });

  it('createDraft 后 getDraft / listDrafts 正常', () => {
    const draft = repo.getDraft(draftId)!;
    expect(draft.title).toBe(TEST_TITLE);
    expect(draft.author).toBe('测试作者');
    expect(draft.synopsis).toBe('简介');
    expect(draft.volumes).toEqual([]);
    expect(draft.chapters).toEqual([]);
    expect(draft.characters).toEqual([]);
    expect(draft.worldItems).toEqual([]);
    expect(draft.userId).toBe(TEST_USER);

    const summary = repo.listDrafts(TEST_USER).find((s) => s.id === draftId);
    expect(summary?.chapterCount).toBe(0);
    expect(summary?.totalWords).toBe(0);

    // 多用户隔离：他人不可见
    const other = repo.listDrafts('someone_else');
    expect(other.some((s) => s.id === draftId)).toBe(false);
  });

  it('saveStructure 保存分卷/人物卡/世界观', () => {
    repo.saveStructure(draftId, {
      volumes: [{ id: 'v1', title: '第一卷', order: 0, description: '起点' }],
      characters: [{ id: 'p1', name: '林晚', role: '主角', traits: '冷静', background: '', notes: '' }],
      worldItems: [{ id: 'w1', name: '雾都', category: '地理', description: '常年浓雾' }],
    });
    const draft = repo.getDraft(draftId)!;
    expect(draft.volumes).toHaveLength(1);
    expect(draft.volumes[0].title).toBe('第一卷');
    expect(draft.characters).toHaveLength(1);
    expect(draft.characters[0].name).toBe('林晚');
    expect(draft.worldItems).toHaveLength(1);
  });

  it('saveChapter upsert 单章并统计字数', () => {
    repo.saveChapter(draftId, {
      id: 'c1', volumeId: 'v1', title: '第一章', order: 0, content: '夜色沉沉。\n他推开门。', wordCount: 0, updatedAt: Date.now(),
    });
    let draft = repo.getDraft(draftId)!;
    expect(draft.chapters).toHaveLength(1);
    expect(draft.chapters[0].wordCount).toBe(10);

    // 再次保存同 id 章节（修改正文），不重复追加
    repo.saveChapter(draftId, {
      id: 'c1', volumeId: 'v1', title: '第一章（改）', order: 0, content: '夜色沉沉。他推开门。雨落下。', wordCount: 0, updatedAt: Date.now(),
    });
    draft = repo.getDraft(draftId)!;
    expect(draft.chapters).toHaveLength(1);
    expect(draft.chapters[0].title).toBe('第一章（改）');
    expect(draft.chapters[0].wordCount).toBe(14);

    const summary = repo.listDrafts(TEST_USER).find((s) => s.id === draftId);
    expect(summary?.chapterCount).toBe(1);
    expect(summary?.totalWords).toBe(14);
  });

  it('deleteChapter 删除单章', () => {
    repo.saveChapter(draftId, { id: 'c1', volumeId: null, title: '第一章', order: 0, content: '正文', wordCount: 0, updatedAt: 1 });
    repo.saveChapter(draftId, { id: 'c2', volumeId: null, title: '第二章', order: 1, content: '正文二', wordCount: 0, updatedAt: 1 });
    repo.deleteChapter(draftId, 'c1');
    const draft = repo.getDraft(draftId)!;
    expect(draft.chapters.map((c) => c.id)).toEqual(['c2']);
  });

  it('materialize 物化为上传资产格式（送去转剧本前置）', () => {
    repo.saveChapter(draftId, { id: 'c1', volumeId: null, title: '第一章', order: 0, content: '第一段。\n第二段。', wordCount: 0, updatedAt: 1 });
    repo.saveChapter(draftId, { id: 'c2', volumeId: null, title: '第二章', order: 1, content: '第二段正文。', wordCount: 0, updatedAt: 1 });
    repo.materialize(draftId);

    const db = getDatabase();
    const row = db.prepare('SELECT novel_text, chapter_texts FROM novels WHERE id = ?').get(draftId) as
      { novel_text: string; chapter_texts: string };
    expect(row.novel_text).toContain('第一章');
    const texts = JSON.parse(row.chapter_texts) as Array<{ index: number; title: string; text: string }>;
    expect(texts).toHaveLength(2);
    expect(texts[0].title).toBe('第一章');
    expect(texts[1].text).toBe('第二段正文。');
  });

  it('materialize 后 ②输入字段不丢（title/author/novelText/chapterTexts），且 kind=draft 可被 ② 读取', () => {
    repo.saveChapter(draftId, { id: 'c1', volumeId: null, title: '第一章', order: 0, content: '内容甲。', wordCount: 0, updatedAt: 1 });
    repo.saveChapter(draftId, { id: 'c2', volumeId: null, title: '第二章', order: 1, content: '内容乙。', wordCount: 0, updatedAt: 1 });
    repo.materialize(draftId);

    // ② 侧通过 /api/novels/[id] 读取同一行（novel-repository.get），须能拿到完整输入
    const novel = getNovelRepository().get(draftId)!;
    expect(novel).not.toBeNull();
    expect(novel.kind).toBe('draft');
    expect(novel.id).toBe(draftId);
    expect(novel.title).toBe(TEST_TITLE);
    expect(novel.author).toBe('测试作者');
    expect(novel.chapterTexts).toEqual(['内容甲。', '内容乙。']);
    expect(novel.novelText).toContain('第一章');
    expect(novel.novelText).toContain('内容乙。');
    expect(novel.totalChapters).toBe(2);
  });

  it('转换完成后回写 last_job_id 与已转换索引，可据此回跳上游（job 关联）', () => {
    repo.saveChapter(draftId, { id: 'c1', volumeId: null, title: '第一章', order: 0, content: '内容甲。', wordCount: 0, updatedAt: 1 });
    repo.saveChapter(draftId, { id: 'c2', volumeId: null, title: '第二章', order: 1, content: '内容乙。', wordCount: 0, updatedAt: 1 });
    repo.materialize(draftId);

    // 模拟由 pipeline 完成（novel-repository.markChaptersConverted 写同一行）——真实链路
    getNovelRepository().markChaptersConverted(draftId, [0], 'job_conv_1');
    const novel = getNovelRepository().get(draftId)!;
    expect(novel.lastJobId).toBe('job_conv_1');
    expect(novel.convertedChapters).toEqual([0]);

    // 创作侧列表同步反映已转换数
    const summary = repo.listDrafts(TEST_USER).find((s) => s.id === draftId);
    expect(summary?.convertedCount).toBe(1);

    // 创作侧 writer 仓库的 markConverted 同样能记录 job 关联（供按 jobId 跳转结果页）
    repo.markConverted(draftId, ['c2'], 'job_conv_2');
    const row = getDatabase().prepare('SELECT last_job_id FROM novels WHERE id = ?').get(draftId) as { last_job_id: string };
    expect(row.last_job_id).toBe('job_conv_2');
  });

  it('updateMeta 更新标题/作者/简介', () => {
    repo.updateMeta(draftId, { title: '新标题', synopsis: '新简介' });
    const draft = repo.getDraft(draftId)!;
    expect(draft.title).toBe('新标题');
    expect(draft.synopsis).toBe('新简介');
    expect(draft.author).toBe('测试作者');
  });

  it('delete 删除创作小说', () => {
    repo.delete(draftId);
    expect(repo.getDraft(draftId)).toBeNull();
  });
});
