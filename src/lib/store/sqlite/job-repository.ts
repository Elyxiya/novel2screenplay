/**
 * Job Repository - 任务 CRUD 操作
 *
 * 提供 Job 的创建、读取、更新、删除操作。
 * 所有操作直接操作 SQLite 数据库。
 */

import { getDatabase } from './db';
import type { PipelineJob, SceneStatus } from '../../../types/api';
import type { StoredJob } from '../job-store';

export interface JobRow {
  id: string;
  status: string;
  current_phase: number;
  progress: number;
  sub_progress: number | null;
  scenes_status: string | null;
  logs: string;
  error: string | null;
  result_id: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
  novel_text: string;
  chapter_texts: string;
  config: string;
  pipeline_state: string | null;
}

export interface CreateJobParams {
  novelText: string;
  chapterTexts: string[];
  modelId: string;
  selectedChapters: number[];
  temperature: number;
}

export interface UpdateJobParams {
  status?: string;
  currentPhase?: number;
  progress?: number;
  subProgress?: number | null;
  scenesStatus?: SceneStatus[];
  logs?: Array<{ timestamp: number; level: string; message: string }>;
  error?: string | null;
  resultId?: string | null;
  pipelineState?: Partial<StoredJob['pipelineState']>;
  startedAt?: number;
  completedAt?: number;
}

export interface JobRepository {
  create(params: CreateJobParams): string;
  get(jobId: string): StoredJob | null;
  update(jobId: string, params: UpdateJobParams): void;
  delete(jobId: string): void;
  list(status?: PipelineJob['status']): StoredJob[];
  listByDateRange(startTime: number, endTime: number): StoredJob[];
}

class JobRepositoryImpl implements JobRepository {
  /**
   * 创建新任务
   */
  create(params: CreateJobParams): string {
    const db = getDatabase();
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO jobs (
        id, status, current_phase, progress, sub_progress,
        scenes_status, logs, error, result_id,
        created_at, updated_at, started_at, completed_at,
        novel_text, chapter_texts, config, pipeline_state
      ) VALUES (
        @id, @status, @currentPhase, @progress, @subProgress,
        @scenesStatus, @logs, @error, @resultId,
        @createdAt, @updatedAt, @startedAt, @completedAt,
        @novelText, @chapterTexts, @config, @pipelineState
      )
    `);

    stmt.run({
      id,
      status: 'pending',
      currentPhase: 0,
      progress: 0,
      subProgress: null,
      scenesStatus: '[]',
      logs: JSON.stringify([{ timestamp: now, level: 'info', message: '任务已创建' }]),
      error: null,
      resultId: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      novelText: params.novelText,
      chapterTexts: JSON.stringify(params.chapterTexts),
      config: JSON.stringify({
        modelId: params.modelId,
        selectedChapters: params.selectedChapters,
        temperature: params.temperature,
      }),
      pipelineState: null,
    });

    return id;
  }

  /**
   * 获取单个任务
   */
  get(jobId: string): StoredJob | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;

    if (!row) return null;

    return this.rowToStoredJob(row);
  }

  /**
   * 更新任务
   */
  update(jobId: string, params: UpdateJobParams): void {
    const db = getDatabase();
    const updates: string[] = [];
    const values: Record<string, unknown> = { id: jobId };

    if (params.status !== undefined) {
      updates.push('status = @status');
      values.status = params.status;
    }
    if (params.currentPhase !== undefined) {
      updates.push('current_phase = @currentPhase');
      values.currentPhase = params.currentPhase;
    }
    if (params.progress !== undefined) {
      updates.push('progress = @progress');
      values.progress = params.progress;
    }
    if (params.subProgress !== undefined) {
      updates.push('sub_progress = @subProgress');
      values.subProgress = params.subProgress;
    }
    if (params.scenesStatus !== undefined) {
      updates.push('scenes_status = @scenesStatus');
      values.scenesStatus = JSON.stringify(params.scenesStatus);
    }
    if (params.logs !== undefined) {
      updates.push('logs = @logs');
      values.logs = JSON.stringify(params.logs);
    }
    if (params.error !== undefined) {
      updates.push('error = @error');
      values.error = params.error;
    }
    if (params.resultId !== undefined) {
      updates.push('result_id = @resultId');
      values.resultId = params.resultId;
    }
    if (params.startedAt !== undefined) {
      updates.push('started_at = @startedAt');
      values.startedAt = params.startedAt;
    }
    if (params.completedAt !== undefined) {
      updates.push('completed_at = @completedAt');
      values.completedAt = params.completedAt;
    }
    if (params.pipelineState !== undefined) {
      updates.push('pipeline_state = @pipelineState');
      // 序列化 pipelineState 为 JSON 字符串
      values.pipelineState = JSON.stringify(params.pipelineState);
    }

    if (updates.length === 0) return;

    updates.push('updated_at = @updatedAt');
    values.updatedAt = Date.now();

    const sql = `UPDATE jobs SET ${updates.join(', ')} WHERE id = @id`;
    db.prepare(sql).run(values);
  }

  /**
   * 删除任务
   */
  delete(jobId: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  }

  /**
   * 按状态列出任务
   */
  list(status?: PipelineJob['status']): StoredJob[] {
    const db = getDatabase();

    let rows: JobRow[];
    if (status) {
      rows = db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC').all(status) as JobRow[];
    } else {
      rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRow[];
    }

    return rows.map((row) => this.rowToStoredJob(row));
  }

  /**
   * 按时间范围列出任务
   */
  listByDateRange(startTime: number, endTime: number): StoredJob[] {
    const db = getDatabase();
    const rows = db.prepare(
      'SELECT * FROM jobs WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC'
    ).all(startTime, endTime) as JobRow[];

    return rows.map((row) => this.rowToStoredJob(row));
  }

  /**
   * 将数据库行转换为 StoredJob 对象
   */
  private rowToStoredJob(row: JobRow): StoredJob {
    const config = JSON.parse(row.config);
    const chapterTexts = JSON.parse(row.chapter_texts);
    const pipelineState = row.pipeline_state ? JSON.parse(row.pipeline_state) : {};

    return {
      id: row.id,
      type: 'conversion',
      status: row.status as PipelineJob['status'],
      retryCount: 0,
      maxRetries: 3,
      currentPhase: row.current_phase ?? undefined,
      progress: row.progress,
      subProgress: row.sub_progress ?? undefined,
      scenesStatus: row.scenes_status ? JSON.parse(row.scenes_status) : [],
      logs: JSON.parse(row.logs),
      error: row.error ?? undefined,
      resultId: row.result_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      novelText: row.novel_text,
      chapterTexts,
      config: {
        modelId: config.modelId,
        selectedChapters: config.selectedChapters,
        temperature: config.temperature,
      },
      pipelineState: pipelineState || {},
    };
  }
}

// 单例导出
let repository: JobRepository | null = null;

export function getJobRepository(): JobRepository {
  if (!repository) {
    repository = new JobRepositoryImpl();
  }
  return repository;
}
