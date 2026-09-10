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
import type { PipelineJobState } from '@novel/contracts/pipeline';
import type { Screenplay } from '@novel/contracts/screenplay';
import type { QualityAssessment } from '../multi-agent/handoff-protocol';
import type { JobMetrics } from '../pipeline/metrics';
import type { PreprocessReport } from '../preprocess/clean';
import type { ProfileMergeReport } from '../pipeline/user-profile';
import type { StyleProfile, UserProfile } from '@novel/contracts/pipeline';
import { getJobRepository, type UpdateJobParams } from './sqlite';

/** FIX-05：恢复锁 TTL（毫秒）——进程崩溃后由 TTL 自动释放，锁可被夺 */
export const RECOVER_LOCK_TTL_MS = 10 * 60_000;

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
  pipelineState: PipelineJobState & {
    phase4Output?: Screenplay;
    /** P-评估：传统管线完成的 LLM 质量评估结果（持久化） */
    qualityAssessment?: QualityAssessment;
    /** FIX-02b：运行期指标（usage/耗时/预算拦截/占位），随 pipelineState 落库 */
    metrics?: JobMetrics;
    /** FIX-11：预处理留痕（噪声行清洗报告） */
    preprocess?: PreprocessReport;
    /** FIX-13：用户自定义设定（意图通道）与融合报告 */
    userProfile?: UserProfile;
    profileReport?: ProfileMergeReport;
    /** FIX-12：风格五轴参数（C6） */
    styleProfile?: StyleProfile;
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
  /** FIX-05：本进程的锁持有者标识（写进 jobs.lock_owner，用于跨进程 CAS 与归属校验） */
  private readonly lockOwner = `owner_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

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

  /**
   * Resume lock management（FIX-05：DB 持久化 CAS + TTL，跨进程安全）。
   * 进程内 Set 保留为快路径；DB 锁为事实源（崩溃后由 TTL 释放）。
   */
  tryLockRecover(jobId: string): boolean {
    if (this.recoveringJobs.has(jobId)) return false;
    const acquired = this.repository.tryAcquireRecoverLock(jobId, this.lockOwner, RECOVER_LOCK_TTL_MS);
    if (acquired) this.recoveringJobs.add(jobId);
    return acquired;
  }

  /** 心跳续锁：长时间恢复期间周期调用，仅在仍持锁时生效 */
  refreshRecoverLock(jobId: string): boolean {
    if (!this.recoveringJobs.has(jobId)) return false;
    return this.repository.refreshRecoverLock(jobId, this.lockOwner);
  }

  unlockRecover(jobId: string): void {
    this.recoveringJobs.delete(jobId);
    this.repository.releaseRecoverLock(jobId, this.lockOwner);
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
