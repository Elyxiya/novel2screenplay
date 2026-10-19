/**
 * Job Repository - 任务 CRUD 操作
 *
 * 提供 Job 的创建、读取、更新、删除操作。
 * 所有操作直接操作 SQLite 数据库。
 */

import { getEngine } from '@novel/db';
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
  novel_id: string | null;
  user_id: string | null;
}

export interface CreateJobParams {
  novelText: string;
  chapterTexts: string[];
  modelId: string;
  selectedChapters: number[];
  temperature: number;
  novelId?: string;
  title?: string;
  author?: string;
  /** 归属用户（多用户数据隔离） */
  userId?: string;
}

export interface UpdateJobParams {
  status?: string;
  currentPhase?: number;
  progress?: number;
  subProgress?: { totalScenes: number; completedScenes: number } | null;
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
  /**
   * P0：轻量读取——不加载 novel_text / chapter_texts。
   * 仅 update 路径使用：`jobStore.update` 只需状态类字段跑 updater，
   * 旧实现每次都 SELECT * 并 JSON.parse 整本正文，2MB 任务单次 update 达 45ms。
   */
  getForUpdate(jobId: string): StoredJob | null;
  update(jobId: string, params: UpdateJobParams): void;
  delete(jobId: string): void;
  /** 按状态列出任务；传入 userId 时按用户过滤（多用户隔离） */
  list(status?: PipelineJob['status'], userId?: string): StoredJob[];
  listByDateRange(startTime: number, endTime: number): StoredJob[];
  /** 删除某用户全部任务（清空历史），返回删除条数 */
  deleteByUser(userId: string): number;
  /**
   * FIX-05：尝试获取恢复锁（DB 持久化 CAS，跨进程安全）。
   * 成功条件：锁为空，或 locked_at 已早于 now - ttlMs（过期可夺）。
   */
  tryAcquireRecoverLock(jobId: string, owner: string, ttlMs: number): boolean;
  /** 刷新锁的持有时间（心跳）；仅在仍持有锁时返回 true */
  refreshRecoverLock(jobId: string, owner: string): boolean;
  /** 释放锁；仅在 owner 匹配时返回 true */
  releaseRecoverLock(jobId: string, owner: string): boolean;
}

class JobRepositoryImpl implements JobRepository {
  /**
   * 创建新任务
   */
  create(params: CreateJobParams): string {
    const db = getEngine();
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const stmt = db.prepare(`
      INSERT INTO jobs (
        id, status, current_phase, progress, sub_progress,
        scenes_status, logs, error, result_id,
        created_at, updated_at, started_at, completed_at,
        novel_text, chapter_texts, config, pipeline_state, novel_id, user_id
      ) VALUES (
        @id, @status, @currentPhase, @progress, @subProgress,
        @scenesStatus, @logs, @error, @resultId,
        @createdAt, @updatedAt, @startedAt, @completedAt,
        @novelText, @chapterTexts, @config, @pipelineState, @novelId, @userId
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
        title: params.title,
        author: params.author,
      }),
      pipelineState: null,
      novelId: params.novelId ?? null,
      userId: params.userId ?? null,
    });

    return id;
  }

  /**
   * 获取单个任务
   */
  get(jobId: string): StoredJob | null {
    const db = getEngine();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;

    if (!row) return null;

    return this.rowToStoredJob(row);
  }

  /**
   * P0：轻量读取（不加载 novel_text / chapter_texts）。
   * update 路径只需要状态类字段；整本正文与章节数组每次反序列化是主要写放大来源。
   */
  getForUpdate(jobId: string): StoredJob | null {
    const db = getEngine();
    const row = db
      .prepare(
        `SELECT id, status, current_phase, progress, sub_progress, scenes_status, logs, error,
                result_id, created_at, updated_at, started_at, completed_at, config,
                pipeline_state, novel_id, user_id
           FROM jobs WHERE id = ?`,
      )
      .get(jobId) as JobRow | undefined;

    if (!row) return null;
    return this.rowToStoredJob(row, true);
  }

  /**
   * 更新任务
   */
  update(jobId: string, params: UpdateJobParams): void {
    const db = getEngine();
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
      // subProgress 是结构对象，序列化为 JSON 存储（SQLite 只能绑定原始类型）
      values.subProgress = params.subProgress === null ? null : JSON.stringify(params.subProgress);
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
    const db = getEngine();
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
  }

  /**
   * 删除某用户全部任务（清空历史），返回删除条数
   */
  tryAcquireRecoverLock(jobId: string, owner: string, ttlMs: number): boolean {
    const db = getEngine();
    const now = Date.now();
    const res = db
      .prepare(
        `UPDATE jobs SET lock_owner = @owner, locked_at = @now
         WHERE id = @id AND (lock_owner IS NULL OR locked_at < @expireBefore)`,
      )
      .run({ id: jobId, owner, now, expireBefore: now - ttlMs });
    return res.changes > 0;
  }

  refreshRecoverLock(jobId: string, owner: string): boolean {
    const db = getEngine();
    const res = db
      .prepare('UPDATE jobs SET locked_at = @now WHERE id = @id AND lock_owner = @owner')
      .run({ id: jobId, now: Date.now(), owner });
    return res.changes > 0;
  }

  releaseRecoverLock(jobId: string, owner: string): boolean {
    const db = getEngine();
    const res = db
      .prepare('UPDATE jobs SET lock_owner = NULL, locked_at = NULL WHERE id = @id AND lock_owner = @owner')
      .run({ id: jobId, owner });
    return res.changes > 0;
  }

  deleteByUser(userId: string): number {
    const db = getEngine();
    return db.prepare('DELETE FROM jobs WHERE user_id = ?').run(userId).changes;
  }

  /**
   * 按状态列出任务；传入 userId 时按用户过滤（多用户隔离）
   */
  list(status?: PipelineJob['status'], userId?: string): StoredJob[] {
    const db = getEngine();

    let rows: JobRow[];
    if (status && userId) {
      rows = db.prepare('SELECT * FROM jobs WHERE status = ? AND user_id = ? ORDER BY created_at DESC').all(status, userId) as JobRow[];
    } else if (status) {
      rows = db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC').all(status) as JobRow[];
    } else if (userId) {
      rows = db.prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC').all(userId) as JobRow[];
    } else {
      rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all() as JobRow[];
    }

    return rows.map((row) => this.rowToStoredJob(row));
  }

  /**
   * 按时间范围列出任务
   */
  listByDateRange(startTime: number, endTime: number): StoredJob[] {
    const db = getEngine();
    const rows = db.prepare(
      'SELECT * FROM jobs WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC'
    ).all(startTime, endTime) as JobRow[];

    return rows.map((row) => this.rowToStoredJob(row));
  }

  /**
   * 将数据库行转换为 StoredJob 对象
   * @param lite 轻量行（缺 novel_text / chapter_texts 列）——用空值占位，仅 update 路径使用
   */
  private rowToStoredJob(row: JobRow, lite = false): StoredJob {
    const config = JSON.parse(row.config);
    const chapterTexts = lite ? [] : JSON.parse(row.chapter_texts);
    const pipelineState = row.pipeline_state ? JSON.parse(row.pipeline_state) : {};

    return {
      id: row.id,
      type: 'conversion',
      status: row.status as PipelineJob['status'],
      retryCount: 0,
      maxRetries: 3,
      currentPhase: row.current_phase ?? undefined,
      progress: row.progress,
      subProgress: row.sub_progress
        ? typeof row.sub_progress === 'string'
          ? JSON.parse(row.sub_progress)
          : undefined // 旧格式数字，忽略
        : null,
      scenesStatus: row.scenes_status ? JSON.parse(row.scenes_status) : [],
      logs: JSON.parse(row.logs),
      error: row.error ?? undefined,
      resultId: row.result_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      novelText: lite ? '' : row.novel_text,
      chapterTexts,
      novelId: row.novel_id ?? undefined,
      userId: row.user_id ?? undefined,
      config: {
        modelId: config.modelId,
        selectedChapters: config.selectedChapters,
        temperature: config.temperature,
        title: config.title,
        author: config.author,
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
