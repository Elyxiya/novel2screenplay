/**
 * Pipeline Job Queue
 *
 * 优先级队列实现，支持延迟重试和超时控制。
 */

import type { PipelineJob, JobPriority, JobStatus } from './types';

export interface JobQueueOptions {
  /** 最大并发任务数 */
  maxConcurrency: number;
  /** 默认超时时间（毫秒） */
  defaultTimeout: number;
  /** 重试延迟（毫秒） */
  retryDelay: number;
}

const DEFAULT_OPTIONS: JobQueueOptions = {
  maxConcurrency: 3,
  defaultTimeout: 10 * 60 * 1000, // 10 分钟
  retryDelay: 5000, // 5 秒
};

type JobListener = (job: PipelineJob) => void;

export interface JobQueue {
  /** 入队任务 */
  enqueue(job: PipelineJob): Promise<void>;
  /** 出队任务 */
  dequeue(): Promise<PipelineJob | null>;
  /** 获取任务 */
  get(jobId: string): PipelineJob | undefined;
  /** 列出所有任务 */
  list(status?: JobStatus): PipelineJob[];
  /** 更新任务 */
  update(job: PipelineJob): void;
  /** 取消任务 */
  cancel(jobId: string): boolean;
  /** 清除已完成任务 */
  clearCompleted(): number;
  /** 任务数 */
  size(): number;
  /** 监听器 */
  on(event: 'enqueue' | 'dequeue' | 'complete' | 'fail' | 'cancel' | 'update', listener: JobListener): void;
  off(event: 'enqueue' | 'dequeue' | 'complete' | 'fail' | 'cancel' | 'update', listener: JobListener): void;
  /** 获取队列统计 */
  getStats(): {
    total: number;
    pending: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    concurrency: number;
    maxConcurrency: number;
  };
}

/**
 * 优先级队列实现
 */
export class PipelineJobQueue implements JobQueue {
  private jobs = new Map<string, PipelineJob>();
  private priorityQueue: string[] = [];
  private listeners = new Map<string, Set<JobListener>>();
  private options: JobQueueOptions;
  private concurrency = 0;

  constructor(options: Partial<JobQueueOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async enqueue(job: PipelineJob): Promise<void> {
    job.status = 'queued';
    this.jobs.set(job.id, job);
    this.insertByPriority(job.id);
    this.emit('enqueue', job);
    console.log(`[Queue] Enqueued job ${job.id} with priority ${job.priority}`);
  }

  async dequeue(): Promise<PipelineJob | null> {
    // 检查是否达到并发上限
    if (this.concurrency >= this.options.maxConcurrency) {
      return null;
    }

    // 获取最高优先级任务
    while (this.priorityQueue.length > 0) {
      const jobId = this.priorityQueue.shift()!;
      const job = this.jobs.get(jobId);

      if (!job || job.status !== 'queued') {
        continue;
      }

      // 检查超时
      if (job.timeout && Date.now() - job.createdAt > job.timeout) {
        job.status = 'failed';
        job.error = 'Job timed out before execution';
        this.emit('fail', job);
        continue;
      }

      // 分配任务
      job.status = 'running';
      job.startedAt = Date.now();
      this.concurrency++;
      this.emit('dequeue', job);
      console.log(`[Queue] Dequeued job ${job.id}, concurrency: ${this.concurrency}/${this.options.maxConcurrency}`);

      return job;
    }

    return null;
  }

  get(jobId: string): PipelineJob | undefined {
    return this.jobs.get(jobId);
  }

  list(status?: JobStatus): PipelineJob[] {
    const all = Array.from(this.jobs.values());

    if (status) {
      return all.filter((j) => j.status === status);
    }

    return all;
  }

  update(job: PipelineJob): void {
    const oldJob = this.jobs.get(job.id);

    if (oldJob?.status === 'running' && job.status !== 'running') {
      this.concurrency = Math.max(0, this.concurrency - 1);
    }

    this.jobs.set(job.id, job);

    // 触发 update 事件（始终触发，用于 SSE 推送）
    this.emit('update', job);

    if (job.status === 'completed') {
      this.emit('complete', job);
      console.log(`[Queue] Job ${job.id} completed`);
    } else if (job.status === 'failed') {
      this.emit('fail', job);
      console.log(`[Queue] Job ${job.id} failed: ${job.error}`);
    }
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);

    if (!job) {
      return false;
    }

    if (job.status === 'running') {
      // 无法直接取消运行中的任务，需要标记
      job.status = 'cancelled';
      // 移除出队列
      this.priorityQueue = this.priorityQueue.filter((id) => id !== jobId);
    } else if (job.status === 'queued') {
      job.status = 'cancelled';
      this.priorityQueue = this.priorityQueue.filter((id) => id !== jobId);
    }

    this.emit('cancel', job);
    console.log(`[Queue] Cancelled job ${jobId}`);
    return true;
  }

  clearCompleted(): number {
    let count = 0;

    for (const [id, job] of this.jobs) {
      if (job.status === 'completed' || job.status === 'cancelled') {
        this.jobs.delete(id);
        count++;
      }
    }

    console.log(`[Queue] Cleared ${count} completed/cancelled jobs`);
    return count;
  }

  size(): number {
    return this.jobs.size;
  }

  on(event: 'enqueue' | 'dequeue' | 'complete' | 'fail' | 'cancel' | 'update', listener: JobListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: 'enqueue' | 'dequeue' | 'complete' | 'fail' | 'cancel' | 'update', listener: JobListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: 'enqueue' | 'dequeue' | 'complete' | 'fail' | 'cancel' | 'update', job: PipelineJob): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(job);
      } catch (error) {
        console.error(`[Queue] Listener error for ${event}:`, error);
      }
    });
  }

  private insertByPriority(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const priorityOrder: Record<JobPriority, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    const jobPriority = priorityOrder[job.priority];

    // 找到插入位置
    let insertIndex = this.priorityQueue.length;
    for (let i = 0; i < this.priorityQueue.length; i++) {
      const existingJob = this.jobs.get(this.priorityQueue[i]);
      if (!existingJob) continue;

      const existingPriority = priorityOrder[existingJob.priority];
      if (jobPriority < existingPriority) {
        insertIndex = i;
        break;
      }
    }

    this.priorityQueue.splice(insertIndex, 0, jobId);
  }

  /**
   * 获取队列统计
   */
  getStats(): {
    total: number;
    pending: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    concurrency: number;
    maxConcurrency: number;
  } {
    const jobs = Array.from(this.jobs.values());

    return {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === 'pending').length,
      queued: jobs.filter((j) => j.status === 'queued').length,
      running: jobs.filter((j) => j.status === 'running').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      cancelled: jobs.filter((j) => j.status === 'cancelled').length,
      concurrency: this.concurrency,
      maxConcurrency: this.options.maxConcurrency,
    };
  }
}

// 全局单例
const GLOBAL_KEY = '__novel2screenplay_job_queue__';

export function getJobQueue(): PipelineJobQueue {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new PipelineJobQueue();
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as PipelineJobQueue;
  }
  return new PipelineJobQueue();
}
