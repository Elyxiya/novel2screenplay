/**
 * Novel Repository - 小说资产 CRUD 操作
 *
 * 存储用户上传的小说（工作台资产），并跟踪已转换章节，
 * 支持"追加章节继续转换"的工作流。
 */

import { getDatabase } from './db';

export interface NovelChapterMeta {
  index: number;
  title: string;
  paragraphCount: number;
}

export interface NovelAsset {
  id: string;
  title: string;
  author: string | null;
  /** 'upload' 上传资产 | 'draft' 创作台小说（kind='draft' 时 id 即创作台 /writer/[id] 的 id，可回跳） */
  kind: string;
  /** 归属用户（NULL 表示旧库遗留数据） */
  userId: string | null;
  novelText: string;
  /** 章节元信息（不含正文，正文见 novelText） */
  chapters: NovelChapterMeta[];
  /** 已成功转换的章节索引（按章节原文划分） */
  convertedChapters: number[];
  /** 章节正文（供续转时直接使用） */
  chapterTexts: string[];
  createdAt: number;
  updatedAt: number;
  lastJobId: string | null;
  /** 汇总字段（列表用，不入库） */
  totalChapters?: number;
  convertedCount?: number;
}

export interface CreateNovelParams {
  title: string;
  author?: string;
  /** 归属用户 */
  userId?: string;
  novelText: string;
  chapters: Array<{ index: number; title: string; paragraphCount: number; text: string }>;
}

export interface NovelSummary {
  id: string;
  title: string;
  author: string | null;
  userId: string | null;
  totalChapters: number;
  convertedCount: number;
  createdAt: number;
  updatedAt: number;
  lastJobId: string | null;
}

interface NovelRow {
  id: string;
  title: string;
  author: string | null;
  kind: string;
  user_id: string | null;
  novel_text: string;
  chapter_texts: string;
  converted_chapters: string;
  created_at: number;
  updated_at: number;
  last_job_id: string | null;
}

/** novels.chapter_texts 中存储的单章结构 */
export interface StoredChapter {
  index: number;
  title: string;
  paragraphCount: number;
  text: string;
}

export interface NovelRepository {
  create(params: CreateNovelParams): string;
  /** 在指定用户的资产中按开头 200 字符匹配（短文本互为前缀即匹配；上传同文或更新稿件时复用资产） */
  findByText(text: string, userId?: string): NovelAsset | null;
  get(novelId: string): NovelAsset | null;
  /** 列出指定用户的小说资产（多用户隔离） */
  list(userId?: string): NovelSummary[];
  /** 合并已转换章节索引（成功转换后调用） */
  markChaptersConverted(novelId: string, chapterIndexes: number[], jobId: string): void;
  /**
   * 追加新章节到已有资产（续转：作者更新稿件后重传或追传）。
   * 只追加正文不重复的章节，旧章节与已转换标记保持不变；
   * 追加章节的索引按合并后的位置重排（与 convertedChapters 语义一致）。
   * @returns 实际追加的章节数
   */
  appendChapters(novelId: string, chapters: Array<{ index: number; title: string; paragraphCount: number; text: string }>): number;
  delete(novelId: string): void;
}

class NovelRepositoryImpl implements NovelRepository {
  create(params: CreateNovelParams): string {
    const db = getDatabase();
    const id = `novel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO novels (
        id, title, author, novel_text, chapter_texts,
        converted_chapters, created_at, updated_at, last_job_id, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.title,
      params.author ?? null,
      params.novelText,
      JSON.stringify(params.chapters.map((c) => ({ index: c.index, title: c.title, paragraphCount: c.paragraphCount, text: c.text }))),
      JSON.stringify([]),
      now,
      now,
      null,
      params.userId ?? null,
    );
    return id;
  }

  findByText(text: string, userId?: string): NovelAsset | null {
    const db = getDatabase();
    // 按开头 200 字符前缀匹配（换行符已在上传时统一为 LF）。
    // 兼容短文本：存量与新文本互为前缀即视为同一部小说，
    // 使"更新稿件后全量重传"能复用资产并自动并入新增章节。
    // 仅在当前用户的资产中匹配（多用户隔离）。
    const rows = userId
      ? (db.prepare('SELECT * FROM novels WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100').all(userId) as NovelRow[])
      : (db.prepare('SELECT * FROM novels ORDER BY updated_at DESC LIMIT 100').all() as NovelRow[]);
    const head = text.slice(0, 200);
    const row = rows.find((r) => {
      const storedHead = r.novel_text.slice(0, 200);
      return storedHead === head || storedHead.startsWith(head) || head.startsWith(storedHead);
    });
    return row ? this.rowToAsset(row) : null;
  }

  get(novelId: string): NovelAsset | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId) as NovelRow | undefined;
    return row ? this.rowToAsset(row) : null;
  }

  list(userId?: string): NovelSummary[] {
    const db = getDatabase();
    const rows = userId
      ? (db.prepare('SELECT * FROM novels WHERE user_id = ? ORDER BY updated_at DESC').all(userId) as NovelRow[])
      : (db.prepare('SELECT * FROM novels ORDER BY updated_at DESC').all() as NovelRow[]);
    return rows.map((row) => {
      const chapters = JSON.parse(row.chapter_texts || '[]') as Array<{ index: number; title: string; paragraphCount: number; text: string }>;
      const converted = JSON.parse(row.converted_chapters || '[]') as number[];
      return {
        id: row.id,
        title: row.title,
        author: row.author,
        userId: row.user_id,
        totalChapters: chapters.length,
        convertedCount: converted.length,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastJobId: row.last_job_id,
      };
    });
  }

  markChaptersConverted(novelId: string, chapterIndexes: number[], jobId: string): void {
    const db = getDatabase();
    const novel = this.get(novelId);
    if (!novel) return;

    const merged = Array.from(new Set([...novel.convertedChapters, ...chapterIndexes])).sort((a, b) => a - b);
    db.prepare('UPDATE novels SET converted_chapters = ?, last_job_id = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(merged), jobId, Date.now(), novelId);
  }

  appendChapters(novelId: string, chapters: CreateNovelParams['chapters']): number {
    const db = getDatabase();
    const row = db.prepare('SELECT chapter_texts, novel_text FROM novels WHERE id = ?').get(novelId) as
      { chapter_texts: string; novel_text: string } | undefined;
    if (!row) return 0;

    const stored = JSON.parse(row.chapter_texts || '[]') as StoredChapter[];
    // 按正文全文去重：兼容两种追加场景——
    //  a) 全量重传（旧章节 + 新章节）：旧章节正文与存量一致被跳过，只并入新章节；
    //  b) 仅粘贴新章节：正文不与存量重复，全部并入。
    const existingTexts = new Set(stored.map((c) => c.text.trim()));

    const toAppend: StoredChapter[] = [];
    for (const c of chapters) {
      if (!c.text || existingTexts.has(c.text.trim())) continue;
      existingTexts.add(c.text.trim()); // 批次内部同样去重
      // 索引按合并后的位置重排，与 convertedChapters 的"章节位置"语义保持一致
      toAppend.push({
        index: stored.length + toAppend.length,
        title: c.title,
        paragraphCount: c.paragraphCount,
        text: c.text,
      });
    }

    if (toAppend.length === 0) {
      // 无新章节：仅刷新更新时间，避免资产被误判为过期
      db.prepare('UPDATE novels SET updated_at = ? WHERE id = ?').run(Date.now(), novelId);
      return 0;
    }

    const merged = [...stored, ...toAppend];
    // 保留原完整文本（含标题行），仅把新章节正文追加到末尾，
    // 保证后续"更新稿件后重传"仍能通过开头前缀匹配到该资产
    const appendedText = toAppend.map((c) => c.text).join('\n\n');
    const novelText = row.novel_text.endsWith('\n')
      ? row.novel_text + appendedText
      : row.novel_text + '\n\n' + appendedText;
    db.prepare(
      'UPDATE novels SET chapter_texts = ?, novel_text = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(merged), novelText, Date.now(), novelId);
    return toAppend.length;
  }

  delete(novelId: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM novels WHERE id = ?').run(novelId);
  }

  private rowToAsset(row: NovelRow): NovelAsset {
    const chapters = JSON.parse(row.chapter_texts || '[]') as Array<{ index: number; title: string; paragraphCount: number; text: string }>;
    const converted = JSON.parse(row.converted_chapters || '[]') as number[];
    return {
      id: row.id,
      title: row.title,
      author: row.author,
      kind: row.kind ?? 'upload',
      userId: row.user_id,
      novelText: row.novel_text,
      chapters: chapters.map(({ index, title, paragraphCount }) => ({ index, title, paragraphCount })),
      convertedChapters: converted,
      chapterTexts: chapters.map((c) => c.text),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastJobId: row.last_job_id,
      totalChapters: chapters.length,
      convertedCount: converted.length,
    };
  }
}

let instance: NovelRepository | null = null;

export function getNovelRepository(): NovelRepository {
  if (!instance) instance = new NovelRepositoryImpl();
  return instance;
}
