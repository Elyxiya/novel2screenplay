/**
 * History Repository - 历史记录 CRUD 操作
 *
 * 存储每次转换的完整结果（YAML 剧本内容），
 * 支持版本管理和快速检索。
 */

import { getDatabase } from './db';

export interface HistoryRow {
  id: string;
  project_id: string | null;
  job_id: string;
  title: string | null;
  author: string | null;
  scene_count: number | null;
  character_count: number | null;
  location_count: number | null;
  yaml_content: string | null;
  created_at: number;
}

export interface CreateHistoryParams {
  projectId?: string;
  jobId: string;
  title?: string;
  author?: string;
  sceneCount?: number;
  characterCount?: number;
  locationCount?: number;
  yamlContent?: string;
}

export interface History {
  id: string;
  projectId: string | null;
  jobId: string;
  title: string | null;
  author: string | null;
  sceneCount: number | null;
  characterCount: number | null;
  locationCount: number | null;
  yamlContent: string | null;
  createdAt: number;
}

export interface HistoryRepository {
  create(params: CreateHistoryParams): string;
  get(historyId: string): History | null;
  getByJobId(jobId: string): History | null;
  listByProject(projectId: string): History[];
  listRecent(limit?: number): History[];
  delete(historyId: string): void;
}

class HistoryRepositoryImpl implements HistoryRepository {
  /**
   * 创建新历史记录
   */
  create(params: CreateHistoryParams): string {
    const db = getDatabase();
    const id = `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO history (
        id, project_id, job_id, title, author,
        scene_count, character_count, location_count,
        yaml_content, created_at
      ) VALUES (
        @id, @projectId, @jobId, @title, @author,
        @sceneCount, @characterCount, @locationCount,
        @yamlContent, @createdAt
      )
    `);

    stmt.run({
      id,
      projectId: params.projectId ?? null,
      jobId: params.jobId,
      title: params.title ?? null,
      author: params.author ?? null,
      sceneCount: params.sceneCount ?? null,
      characterCount: params.characterCount ?? null,
      locationCount: params.locationCount ?? null,
      yamlContent: params.yamlContent ?? null,
      createdAt: now,
    });

    return id;
  }

  /**
   * 获取单个历史记录
   */
  get(historyId: string): History | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM history WHERE id = ?').get(historyId) as HistoryRow | undefined;

    if (!row) return null;

    return this.rowToHistory(row);
  }

  /**
   * 通过 Job ID 获取历史记录
   */
  getByJobId(jobId: string): History | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM history WHERE job_id = ?').get(jobId) as HistoryRow | undefined;

    if (!row) return null;

    return this.rowToHistory(row);
  }

  /**
   * 按项目列出历史记录
   */
  listByProject(projectId: string): History[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM history WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId) as HistoryRow[];

    return rows.map((row) => this.rowToHistory(row));
  }

  /**
   * 获取最近的历史记录
   */
  listRecent(limit: number = 10): History[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM history ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as HistoryRow[];

    return rows.map((row) => this.rowToHistory(row));
  }

  /**
   * 删除历史记录
   */
  delete(historyId: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM history WHERE id = ?').run(historyId);
  }

  /**
   * 将数据库行转换为 History 对象
   */
  private rowToHistory(row: HistoryRow): History {
    return {
      id: row.id,
      projectId: row.project_id,
      jobId: row.job_id,
      title: row.title,
      author: row.author,
      sceneCount: row.scene_count,
      characterCount: row.character_count,
      locationCount: row.location_count,
      yamlContent: row.yaml_content,
      createdAt: row.created_at,
    };
  }
}

// 单例导出
let repository: HistoryRepository | null = null;

export function getHistoryRepository(): HistoryRepository {
  if (!repository) {
    repository = new HistoryRepositoryImpl();
  }
  return repository;
}
