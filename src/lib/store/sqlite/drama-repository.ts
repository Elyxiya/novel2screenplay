/**
 * Drama Repository - 短剧分镜存储
 *
 * 存储"剧本 → 短剧分镜"转换结果，支持溯源链：
 * drama.source_job_id → job（剧本），job.novel_id → novel（小说）。
 */

import { getDatabase } from './db';

export interface DramaRecord {
  id: string;
  /** 溯源：来源剧本任务 ID（jobId） */
  sourceJobId: string;
  /** 溯源：来源小说资产 ID（可为空） */
  sourceNovelId: string | null;
  title: string;
  /** 分镜 YAML 全文 */
  dramaYaml: string;
  createdAt: number;
  /** 归属用户（NULL 表示旧库遗留数据） */
  userId: string | null;
}

export interface DramaSummary {
  id: string;
  title: string;
  sourceJobId: string;
  sourceNovelId: string | null;
  totalShots: number;
  totalScenes: number;
  createdAt: number;
}

interface DramaRow {
  id: string;
  source_job_id: string;
  source_novel_id: string | null;
  title: string;
  drama_yaml: string;
  created_at: number;
  user_id: string | null;
}

export interface DramaRepository {
  create(params: {
    sourceJobId: string;
    sourceNovelId?: string | null;
    title: string;
    dramaYaml: string;
    userId?: string | null;
  }): string;
  get(dramaId: string): DramaRecord | null;
  /** 按归属用户列出分镜摘要（多用户隔离） */
  list(userId?: string): DramaSummary[];
  /** 按来源剧本任务查找已生成的分镜 */
  findBySourceJobId(sourceJobId: string, userId?: string): DramaRecord | null;
  delete(dramaId: string): void;
}

class DramaRepositoryImpl implements DramaRepository {
  create(params: {
    sourceJobId: string;
    sourceNovelId?: string | null;
    title: string;
    dramaYaml: string;
    userId?: string | null;
  }): string {
    const db = getDatabase();
    const id = `drama_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO dramas (id, source_job_id, source_novel_id, title, drama_yaml, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.sourceJobId,
      params.sourceNovelId ?? null,
      params.title,
      params.dramaYaml,
      now,
      params.userId ?? null,
    );
    return id;
  }

  get(dramaId: string): DramaRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM dramas WHERE id = ?').get(dramaId) as DramaRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  list(userId?: string): DramaSummary[] {
    const db = getDatabase();
    const rows = userId
      ? (db.prepare('SELECT * FROM dramas WHERE user_id = ? ORDER BY created_at DESC').all(userId) as DramaRow[])
      : (db.prepare('SELECT * FROM dramas ORDER BY created_at DESC').all() as DramaRow[]);

    return rows.map(row => {
      const yaml = row.drama_yaml;
      const totalShots = yaml.match(/shotId:/g)?.length ?? 0;
      const totalScenes = yaml.match(/sceneNumber:/g)?.length ?? 0;
      return {
        id: row.id,
        title: row.title,
        sourceJobId: row.source_job_id,
        sourceNovelId: row.source_novel_id,
        totalShots,
        totalScenes,
        createdAt: row.created_at,
      };
    });
  }

  findBySourceJobId(sourceJobId: string, userId?: string): DramaRecord | null {
    const db = getDatabase();
    const rows = userId
      ? (db.prepare('SELECT * FROM dramas WHERE source_job_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1').all(sourceJobId, userId) as DramaRow[])
      : (db.prepare('SELECT * FROM dramas WHERE source_job_id = ? ORDER BY created_at DESC LIMIT 1').all(sourceJobId) as DramaRow[]);
    return rows.length ? this.rowToRecord(rows[0]) : null;
  }

  delete(dramaId: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM dramas WHERE id = ?').run(dramaId);
  }

  private rowToRecord(row: DramaRow): DramaRecord {
    return {
      id: row.id,
      sourceJobId: row.source_job_id,
      sourceNovelId: row.source_novel_id,
      title: row.title,
      dramaYaml: row.drama_yaml,
      createdAt: row.created_at,
      userId: row.user_id,
    };
  }
}

let instance: DramaRepository | null = null;

export function getDramaRepository(): DramaRepository {
  if (!instance) instance = new DramaRepositoryImpl();
  return instance;
}
