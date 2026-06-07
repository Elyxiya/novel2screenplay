import type { PipelineJob, SceneStatus } from '../../types/api';
import type { Phase1Output } from '../pipeline/Phase1Analyzer';
import type { Phase2Output } from '../pipeline/Phase2Segmenter';
import type { Phase3Output } from '../pipeline/Phase3SceneConverter';
import type { Screenplay } from '../schema/screenplay.schema';

/** Internal stored job with pipeline state */
export interface StoredJob extends PipelineJob {
  novelText: string;
  chapterTexts: string[];
  config: {
    modelId: string;
    selectedChapters: number[];
    temperature: number;
  };
  pipelineState: {
    phase1Output?: Phase1Output;
    phase2Output?: Phase2Output;
    phase3Output?: Phase3Output[];
    phase4Output?: Screenplay;
  };
}

/**
 * In-memory job store with JSON file backup.
 *
 * ⚠️ KNOWN LIMITATION: Data is lost on Next.js hot-reload.
 * For production use with multiple instances, migrate to Redis.
 */
export class JobStore {
  private jobs = new Map<string, StoredJob>();
  private recoveringJobs = new Set<string>();

  create(config: {
    novelText: string;
    chapterTexts: string[];
    modelId: string;
    selectedChapters: number[];
    temperature: number;
  }): string {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const initialScenesStatus: SceneStatus[] = [];

    const job: StoredJob = {
      id,
      status: 'pending',
      currentPhase: 0,
      progress: 0,
      subProgress: null,
      scenesStatus: initialScenesStatus,
      logs: [{ timestamp: now, level: 'info', message: '任务已创建' }],
      error: null,
      resultId: null,
      createdAt: now,
      updatedAt: now,
      novelText: config.novelText,
      chapterTexts: config.chapterTexts,
      config: {
        modelId: config.modelId,
        selectedChapters: config.selectedChapters,
        temperature: config.temperature,
      },
      pipelineState: {},
    };

    this.jobs.set(id, job);
    return id;
  }

  get(jobId: string): StoredJob | undefined {
    return this.jobs.get(jobId);
  }

  update(jobId: string, updater: (job: StoredJob) => StoredJob): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    const updated = updater(job);
    updated.updatedAt = Date.now();
    this.jobs.set(jobId, updated);
  }

  delete(jobId: string): void {
    this.jobs.delete(jobId);
    this.recoveringJobs.delete(jobId);
  }

  list(): StoredJob[] {
    return Array.from(this.jobs.values());
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

/** Global singleton — survives Next.js hot-reload by attaching to globalThis */
const GLOBAL_KEY = '__novel2screenplay_jobStore';

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
