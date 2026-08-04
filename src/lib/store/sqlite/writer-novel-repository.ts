/**
 * Writer Novel Repository - 创作侧小说资产 CRUD
 *
 * writer 模块的创作小说（kind='draft'）与上传资产（kind='upload'）共存于
 * novels 表，经 kind 列区分。创作数据（分卷/章节正文/人物卡/世界观）以
 * JSON 列存储，保持上传资产结构不变。
 */

import { getDatabase } from './db';
import type { DraftNovel, NovelVolume, NovelChapter, NovelCharacterCard, NovelWorldItem, CreateDraftParams } from '@/lib/schema/novel.schema';

export interface DraftSummary {
  id: string;
  title: string;
  author: string;
  synopsis: string;
  /** 章节总数（含未分卷） */
  chapterCount: number;
  /** 累计字数（正文去空白计数） */
  totalWords: number;
  /** 已转换章节数（送去转剧本后回写） */
  convertedCount: number;
  createdAt: number;
  updatedAt: number;
}

interface DraftRow {
  id: string;
  title: string;
  author: string | null;
  novel_text: string;
  chapter_texts: string;
  converted_chapters: string;
  created_at: number;
  updated_at: number;
  last_job_id: string | null;
  user_id: string | null;
  kind: string;
  synopsis: string;
  volumes: string;
  characters: string;
  world_items: string;
  draft_chapters: string;
}

export interface WriterNovelRepository {
  /** 创建空白创作小说，返回资产 ID */
  createDraft(params: CreateDraftParams & { userId?: string }): string;
  /** 读取创作小说完整结构（含章节正文） */
  getDraft(id: string): DraftNovel | null;
  /** 列出当前用户的创作小说（不含章节正文） */
  listDrafts(userId: string): DraftSummary[];
  /** 更新标题/作者/简介 */
  updateMeta(id: string, meta: { title?: string; author?: string; synopsis?: string }): void;
  /** 全量保存卷结构/人物卡/世界观（任一字段省略则不动） */
  saveStructure(id: string, data: { volumes?: NovelVolume[]; characters?: NovelCharacterCard[]; worldItems?: NovelWorldItem[] }): void;
  /** upsert 单章正文（按章节 id 匹配，含字数统计），返回归一化后的章节 */
  saveChapter(id: string, chapter: NovelChapter): NovelChapter | null;
  /** 删除单章 */
  deleteChapter(id: string, chapterId: string): void;
  /** 把创作章节物化为上传资产格式（novel_text + chapter_texts），供"送去转剧本" */
  materialize(id: string): void;
  /** 标记已转换章节数（转剧本成功后由 job 回写） */
  markConverted(id: string, chapterIds: string[], jobId: string): void;
  delete(id: string): void;
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function countWords(text: string): number {
  return text.replace(/\s/g, '').length;
}

class WriterNovelRepositoryImpl implements WriterNovelRepository {
  createDraft(params: CreateDraftParams & { userId?: string }): string {
    const db = getDatabase();
    const id = `novel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    db.prepare(`
      INSERT INTO novels (
        id, title, author, novel_text, chapter_texts, converted_chapters,
        created_at, updated_at, last_job_id, user_id,
        kind, synopsis, volumes, characters, world_items, draft_chapters
      ) VALUES (?, ?, ?, '', '[]', '[]', ?, ?, NULL, ?, 'draft', ?, '[]', '[]', '[]', '[]')
    `).run(
      id,
      params.title,
      params.author || null,
      now,
      now,
      params.userId ?? null,
      params.synopsis ?? '',
    );
    return id;
  }

  getDraft(id: string): DraftNovel | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM novels WHERE id = ? AND kind = \'draft\'').get(id) as DraftRow | undefined;
    if (!row) return null;
    return this.rowToDraft(row);
  }

  listDrafts(userId: string): DraftSummary[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM novels WHERE kind = \'draft\' AND user_id = ? ORDER BY updated_at DESC',
    ).all(userId) as DraftRow[];
    return rows.map((row) => {
      const chapters = safeJson<NovelChapter[]>(row.draft_chapters, []);
      const converted = safeJson<string[]>(row.converted_chapters, []);
      return {
        id: row.id,
        title: row.title,
        author: row.author ?? '',
        synopsis: row.synopsis,
        chapterCount: chapters.length,
        totalWords: chapters.reduce((sum, c) => sum + c.wordCount, 0),
        convertedCount: converted.length,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  updateMeta(id: string, meta: { title?: string; author?: string; synopsis?: string }): void {
    const db = getDatabase();
    const current = this.getDraft(id);
    if (!current) return;
    const next = {
      title: meta.title ?? current.title,
      author: meta.author ?? current.author,
      synopsis: meta.synopsis ?? current.synopsis,
    };
    db.prepare(
      'UPDATE novels SET title = ?, author = ?, synopsis = ?, updated_at = ? WHERE id = ?',
    ).run(next.title, next.author, next.synopsis, Date.now(), id);
  }

  saveStructure(id: string, data: { volumes?: NovelVolume[]; characters?: NovelCharacterCard[]; worldItems?: NovelWorldItem[] }): void {
    const db = getDatabase();
    const current = this.getDraft(id);
    if (!current) return;
    db.prepare(
      'UPDATE novels SET volumes = ?, characters = ?, world_items = ?, updated_at = ? WHERE id = ?',
    ).run(
      data.volumes !== undefined ? JSON.stringify(data.volumes) : JSON.stringify(current.volumes),
      data.characters !== undefined ? JSON.stringify(data.characters) : JSON.stringify(current.characters),
      data.worldItems !== undefined ? JSON.stringify(data.worldItems) : JSON.stringify(current.worldItems),
      Date.now(),
      id,
    );
  }

  saveChapter(id: string, chapter: NovelChapter): NovelChapter | null {
    const db = getDatabase();
    const current = this.getDraft(id);
    if (!current) return null;
    const chapters = current.chapters;
    const idx = chapters.findIndex((c) => c.id === chapter.id);
    const normalized = { ...chapter, wordCount: countWords(chapter.content) };
    if (idx >= 0) {
      chapters[idx] = normalized;
    } else {
      chapters.push(normalized);
    }
    db.prepare('UPDATE novels SET draft_chapters = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(chapters), Date.now(), id);
    return normalized;
  }

  deleteChapter(id: string, chapterId: string): void {
    const db = getDatabase();
    const current = this.getDraft(id);
    if (!current) return;
    const chapters = current.chapters.filter((c) => c.id !== chapterId);
    db.prepare('UPDATE novels SET draft_chapters = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(chapters), Date.now(), id);
  }

  materialize(id: string): void {
    const db = getDatabase();
    const current = this.getDraft(id);
    if (!current) return;
    const chapters = [...current.chapters].sort((a, b) => {
      const va = a.volumeId ? a.order : 9999 + a.order;
      const vb = b.volumeId ? b.order : 9999 + b.order;
      return va - vb;
    });
    const chapterTexts = chapters.map((c, i) => ({
      index: i,
      title: c.title,
      paragraphCount: c.content ? c.content.split(/\n+/).filter((p) => p.trim()).length : 0,
      text: c.content,
    }));
    const novelText = chapters.map((c) => `${c.title}\n\n${c.content}`.trim()).join('\n\n');
    db.prepare(
      'UPDATE novels SET novel_text = ?, chapter_texts = ?, updated_at = ? WHERE id = ?',
    ).run(novelText, JSON.stringify(chapterTexts), Date.now(), id);
  }

  markConverted(id: string, chapterIds: string[], jobId: string): void {
    const db = getDatabase();
    const row = db.prepare('SELECT converted_chapters FROM novels WHERE id = ?').get(id) as
      { converted_chapters: string } | undefined;
    if (!row) return;
    const existing = safeJson<string[]>(row.converted_chapters, []);
    const merged = Array.from(new Set([...existing, ...chapterIds]));
    db.prepare('UPDATE novels SET converted_chapters = ?, last_job_id = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), jobId, Date.now(), id);
  }

  delete(id: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM novels WHERE id = ? AND kind = \'draft\'').run(id);
  }

  private rowToDraft(row: DraftRow): DraftNovel {
    return {
      id: row.id,
      title: row.title,
      author: row.author ?? '',
      synopsis: row.synopsis,
      volumes: safeJson<NovelVolume[]>(row.volumes, []),
      chapters: safeJson<NovelChapter[]>(row.draft_chapters, []),
      characters: safeJson<NovelCharacterCard[]>(row.characters, []),
      worldItems: safeJson<NovelWorldItem[]>(row.world_items, []),
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

let instance: WriterNovelRepository | null = null;

export function getWriterNovelRepository(): WriterNovelRepository {
  if (!instance) instance = new WriterNovelRepositoryImpl();
  return instance;
}
