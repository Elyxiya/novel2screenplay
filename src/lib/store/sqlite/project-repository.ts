/**
 * Project Repository - 项目 CRUD 操作
 *
 * 提供 Project 的创建、读取、更新、删除操作。
 * Project 是用户的转换项目容器，可以包含多个转换历史。
 */

import { getDatabase } from './db';

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  source_novel_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  metadata: string | null;
}

export interface CreateProjectParams {
  name: string;
  description?: string;
  sourceNovelId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectParams {
  name?: string;
  description?: string | null;
  sourceNovelId?: string | null;
  status?: 'active' | 'archived' | 'deleted';
  metadata?: Record<string, unknown>;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  sourceNovelId: string | null;
  status: 'active' | 'archived' | 'deleted';
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface ProjectRepository {
  create(params: CreateProjectParams): string;
  get(projectId: string): Project | null;
  update(projectId: string, params: UpdateProjectParams): void;
  delete(projectId: string): void;
  list(status?: Project['status']): Project[];
}

class ProjectRepositoryImpl implements ProjectRepository {
  /**
   * 创建新项目
   */
  create(params: CreateProjectParams): string {
    const db = getDatabase();
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO projects (
        id, name, description, source_novel_id, status,
        created_at, updated_at, metadata
      ) VALUES (
        @id, @name, @description, @sourceNovelId, @status,
        @createdAt, @updatedAt, @metadata
      )
    `);

    stmt.run({
      id,
      name: params.name,
      description: params.description ?? null,
      sourceNovelId: params.sourceNovelId ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    });

    return id;
  }

  /**
   * 获取单个项目
   */
  get(projectId: string): Project | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;

    if (!row) return null;

    return this.rowToProject(row);
  }

  /**
   * 更新项目
   */
  update(projectId: string, params: UpdateProjectParams): void {
    const db = getDatabase();
    const updates: string[] = [];
    const values: Record<string, unknown> = { id: projectId };

    if (params.name !== undefined) {
      updates.push('name = @name');
      values.name = params.name;
    }
    if (params.description !== undefined) {
      updates.push('description = @description');
      values.description = params.description;
    }
    if (params.sourceNovelId !== undefined) {
      updates.push('source_novel_id = @sourceNovelId');
      values.sourceNovelId = params.sourceNovelId;
    }
    if (params.status !== undefined) {
      updates.push('status = @status');
      values.status = params.status;
    }
    if (params.metadata !== undefined) {
      updates.push('metadata = @metadata');
      values.metadata = JSON.stringify(params.metadata);
    }

    if (updates.length === 0) return;

    updates.push('updated_at = @updatedAt');
    values.updatedAt = Date.now();

    const sql = `UPDATE projects SET ${updates.join(', ')} WHERE id = @id`;
    db.prepare(sql).run(values);
  }

  /**
   * 删除项目（软删除）
   */
  delete(projectId: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE projects SET status = 'deleted', updated_at = ? WHERE id = ?
    `).run(Date.now(), projectId);
  }

  /**
   * 按状态列出项目
   */
  list(status?: Project['status']): Project[] {
    const db = getDatabase();

    let rows: ProjectRow[];
    if (status) {
      rows = db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC').all(status) as ProjectRow[];
    } else {
      rows = db.prepare('SELECT * FROM projects WHERE status != \'deleted\' ORDER BY created_at DESC').all() as ProjectRow[];
    }

    return rows.map((row) => this.rowToProject(row));
  }

  /**
   * 将数据库行转换为 Project 对象
   */
  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      sourceNovelId: row.source_novel_id,
      status: row.status as Project['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  }
}

// 单例导出
let repository: ProjectRepository | null = null;

export function getProjectRepository(): ProjectRepository {
  if (!repository) {
    repository = new ProjectRepositoryImpl();
  }
  return repository;
}
