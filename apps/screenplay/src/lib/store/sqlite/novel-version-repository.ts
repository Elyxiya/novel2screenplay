/**
 * Novel Version Repository - 转换版本记录（FIX-24）
 *
 * 每次成功转换落一行（novel_id + job_id + format_version + prompt_hash），
 * 支撑审计交付与版本对比（GET /api/novels/[id]/versions）。
 * 无外键约束（与既有仓储风格一致）；旧库由 db.ts 幂等迁移补建表。
 */
import { getEngine } from './db';

export interface NovelVersionRecord {
  id: string;
  novelId: string;
  jobId: string;
  formatVersion: string;
  promptHash: string;
  createdAt: number;
}

interface NovelVersionRow {
  id: string;
  novel_id: string;
  job_id: string;
  format_version: string;
  prompt_hash: string;
  created_at: number;
}

export interface CreateNovelVersionParams {
  novelId: string;
  jobId: string;
  formatVersion: string;
  promptHash: string;
}

export interface NovelVersionRepository {
  create(params: CreateNovelVersionParams): string;
  /** 按 novel 列出全部版本（created_at 倒序，最新在前） */
  listByNovel(novelId: string): NovelVersionRecord[];
}

function rowToRecord(row: NovelVersionRow): NovelVersionRecord {
  return {
    id: row.id,
    novelId: row.novel_id,
    jobId: row.job_id,
    formatVersion: row.format_version,
    promptHash: row.prompt_hash,
    createdAt: row.created_at,
  };
}

class NovelVersionRepositoryImpl implements NovelVersionRepository {
  create(params: CreateNovelVersionParams): string {
    const db = getEngine();
    const id = `ver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      `INSERT INTO novel_versions (id, novel_id, job_id, format_version, prompt_hash, created_at)
       VALUES (@id, @novelId, @jobId, @formatVersion, @promptHash, @createdAt)`,
    ).run({
      id,
      novelId: params.novelId,
      jobId: params.jobId,
      formatVersion: params.formatVersion,
      promptHash: params.promptHash,
      createdAt: Date.now(),
    });
    return id;
  }

  listByNovel(novelId: string): NovelVersionRecord[] {
    const db = getEngine();
    const rows = db
      .prepare('SELECT * FROM novel_versions WHERE novel_id = ? ORDER BY created_at DESC')
      .all(novelId) as NovelVersionRow[];
    return rows.map(rowToRecord);
  }
}

const GLOBAL_KEY = '__novel2screenplay_novelVersionRepository__';

export function getNovelVersionRepository(): NovelVersionRepository {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new NovelVersionRepositoryImpl();
  }
  return g[GLOBAL_KEY] as NovelVersionRepository;
}
