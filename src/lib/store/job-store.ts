/**
 * Job Store - SQLite 持久化存储
 *
 * 重构自内存存储，使用 SQLite 作为持久化层。
 * 保持与原有 API 的向后兼容。
 *
 * @deprecated 请使用 src/lib/store/sqlite 中的 Repository
 * 新代码应直接使用 getJobRepository() 等方法
 */

import type { PipelineJob, SceneStatus } from '../../types/api';
import type { Phase1Output } from '../pipeline/Phase1Analyzer';
import type { Phase2Output } from '../pipeline/Phase2Segmenter';
import type { Phase3Output } from '../pipeline/Phase3SceneConverter';
import type { Screenplay } from '../schema/screenplay.schema';
import { getJobRepository, type UpdateJobParams } from './sqlite';

/** Internal stored job with pipeline state */
export interface StoredJob {
  id: string;
  type: string;
  status: string;
  currentPhase?: number;
  progress: number;
  subProgress?: unknown;
  error?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt?: number;
  scenesStatus: SceneStatus[];
  logs: Array<{ timestamp: number; level: 'info' | 'warn' | 'error'; message: string }>;
  resultId?: string;
  metadata?: Record<string, unknown>;
  novelText: string;
  chapterTexts: string[];
  novelId?: string;
  /** 归属用户（多用户数据隔离） */
  userId?: string;
  config: {
    modelId: string;
    selectedChapters: number[];
    temperature: number;
    title?: string;
    author?: string;
  };
  pipelineState: {
    phase1Output?: Phase1Output;
    phase2Output?: Phase2Output;
    phase3Output?: Phase3Output[];
    phase4Output?: Screenplay;
  };
}

/**
 * Job Store 类
 *
 * 封装 SQLite Repository，提供与原内存存储相同的接口。
 * 这样可以最大程度保持向后兼容，无需修改现有调用代码。
 */
export class JobStore {
  private repository = getJobRepository();
  private recoveringJobs = new Set<string>();

  create(config: {
    novelText: string;
    chapterTexts: string[];
    modelId: string;
    selectedChapters: number[];
    temperature: number;
    novelId?: string;
    title?: string;
    author?: string;
    userId?: string;
  }): string {
    return this.repository.create(config);
  }

  get(jobId: string): StoredJob | undefined {
    return this.repository.get(jobId) ?? undefined;
  }

  update(jobId: string, updater: (job: StoredJob) => StoredJob): void {
    const job = this.repository.get(jobId);
    if (!job) return;

    // 执行 updater 获取更新后的 job
    const updatedJob = updater(job);

    // 提取可序列化的字段
    const params: UpdateJobParams = {};

    if (updatedJob.status !== job.status) params.status = updatedJob.status;
    if (updatedJob.currentPhase !== job.currentPhase) params.currentPhase = updatedJob.currentPhase;
    if (updatedJob.progress !== job.progress) params.progress = updatedJob.progress;
    if (updatedJob.subProgress !== job.subProgress) {
      params.subProgress = updatedJob.subProgress as { totalScenes: number; completedScenes: number } | null | undefined;
    }
    if (JSON.stringify(updatedJob.scenesStatus) !== JSON.stringify(job.scenesStatus)) {
      params.scenesStatus = updatedJob.scenesStatus;
    }
    if (JSON.stringify(updatedJob.logs) !== JSON.stringify(job.logs)) {
      params.logs = updatedJob.logs;
    }
    if (updatedJob.error !== job.error) params.error = updatedJob.error;
    if (updatedJob.resultId !== job.resultId) params.resultId = updatedJob.resultId;
    if (JSON.stringify(updatedJob.pipelineState) !== JSON.stringify(job.pipelineState)) {
      params.pipelineState = updatedJob.pipelineState;
    }
    if (updatedJob.startedAt !== job.startedAt) params.startedAt = updatedJob.startedAt;
    if (updatedJob.completedAt !== job.completedAt) params.completedAt = updatedJob.completedAt;

    this.repository.update(jobId, params);
  }

  delete(jobId: string): void {
    this.repository.delete(jobId);
  }

  list(): StoredJob[] {
    return this.repository.list();
  }

  listByStatus(status: PipelineJob['status']): StoredJob[] {
    return this.repository.list(status);
  }

  /** Resume lock management */
  tryLockRecover(jobId: string): boolean {
    if (this.recoveringJobs.has(jobId)) return false;
    this.recoveringJobs.add(jobId);
    return true;
  }

  unlockRecover(jobId: string): void {
    this.recoveringJobs.delete(jobId);
  }

  isRecovering(jobId: string): boolean {
    return this.recoveringJobs.has(jobId);
  }
}

/** Global singleton */
const GLOBAL_KEY = '__novel2screenplay_jobStore__';

function getGlobalStore(): JobStore {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new JobStore();
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as JobStore;
  }
  return new JobStore();
}

export const jobStore = getGlobalStore();
