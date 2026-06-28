/**
 * Pipeline Worker
 *
 * 后台任务处理器，从队列中取任务执行。
 */

import type { PipelineJob } from './types';
import type { JobQueue } from './job-queue';
import { PipelineExecutor } from '../pipeline/executor';
import { getJobQueue } from './job-queue';

export interface WorkerOptions {
  /** Worker ID */
  id: string;
  /** 处理间隔（毫秒） */
  pollInterval: number;
  /** 最大并发数 */
  maxConcurrency: number;
}

const DEFAULT_OPTIONS: WorkerOptions = {
  id: `worker_${Date.now()}`,
  pollInterval: 1000,
  maxConcurrency: 3,
};

export class PipelineWorker {
  private options: WorkerOptions;
  private queue: JobQueue;
  private executor: PipelineExecutor;
  private running = false;
  private pollTimer?: NodeJS.Timeout;
  private activeJobs = new Map<string, { job: PipelineJob; abortController: AbortController }>();

  constructor(
    options: Partial<WorkerOptions> = {},
    queue?: JobQueue,
    executor?: PipelineExecutor
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.queue = queue || getJobQueue();
    this.executor = executor || new PipelineExecutor();

    // 注册队列监听器
    this.queue.on('complete', (job) => this.handleJobComplete(job));
    this.queue.on('fail', (job) => this.handleJobFail(job));
  }

  /**
   * 启动 Worker
   */
  start(): void {
    if (this.running) {
      console.log(`[Worker ${this.options.id}] Already running`);
      return;
    }

    this.running = true;
    console.log(`[Worker ${this.options.id}] Started, polling every ${this.options.pollInterval}ms`);

    this.poll();
  }

  /**
   * 停止 Worker
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }

    // 等待活跃任务完成
    await this.waitForActiveJobs();

    console.log(`[Worker ${this.options.id}] Stopped`);
  }

  /**
   * 暂停 Worker
   */
  pause(): void {
    this.running = false;
    console.log(`[Worker ${this.options.id}] Paused`);
  }

  /**
   * 恢复 Worker
   */
  resume(): void {
    if (!this.running) {
      this.running = true;
      console.log(`[Worker ${this.options.id}] Resumed`);
      this.poll();
    }
  }

  /**
   * 取消指定任务
   */
  cancelJob(jobId: string): boolean {
    const active = this.activeJobs.get(jobId);

    if (active) {
      active.abortController.abort();
      return true;
    }

    return this.queue.cancel(jobId);
  }

  /**
   * 获取 Worker 状态
   */
  getStatus(): {
    running: boolean;
    activeJobs: number;
    options: WorkerOptions;
  } {
    return {
      running: this.running,
      activeJobs: this.activeJobs.size,
      options: this.options,
    };
  }

  /**
   * 轮询处理
   */
  private async poll(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      await this.processJobs();
    } catch (error) {
      console.error(`[Worker ${this.options.id}] Poll error:`, error);
    }

    // 继续轮询
    this.pollTimer = setTimeout(() => this.poll(), this.options.pollInterval);
  }

  /**
   * 处理任务
   */
  private async processJobs(): Promise<void> {
    const stats = this.queue.getStats();

    // 如果已经达到最大并发，跳过
    if (stats.concurrency >= this.options.maxConcurrency) {
      return;
    }

    // 出队任务
    const job = await this.queue.dequeue();

    if (!job) {
      return;
    }

    // 创建 AbortController 用于取消
    const abortController = new AbortController();
    this.activeJobs.set(job.id, { job, abortController });

    // 执行任务
    this.executeJob(job, abortController.signal).catch((error) => {
      console.error(`[Worker ${this.options.id}] Job ${job.id} execution error:`, error);
    });
  }

  /**
   * 执行任务
   */
  private async executeJob(job: PipelineJob, signal: AbortSignal): Promise<void> {
    console.log(`[Worker ${this.options.id}] Executing job ${job.id}`);

    try {
      const result = await this.executor.execute(job, {
        signal,
        onProgress: (progress, subProgress) => {
          job.progress = progress;
          job.subProgress = subProgress;
          this.queue.update(job);
        },
      });

      job.status = 'completed';
      job.output = result.output;
      job.completedAt = Date.now();
      job.progress = 100;

      console.log(`[Worker ${this.options.id}] Job ${job.id} completed successfully`);

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = Date.now();

      console.error(`[Worker ${this.options.id}] Job ${job.id} failed:`, job.error);
    } finally {
      this.activeJobs.delete(job.id);
      this.queue.update(job);
    }
  }

  /**
   * 处理任务完成
   */
  private handleJobComplete(job: PipelineJob): void {
    console.log(`[Worker ${this.options.id}] Job ${job.id} completed`);
  }

  /**
   * 处理任务失败
   */
  private handleJobFail(job: PipelineJob): void {
    console.log(`[Worker ${this.options.id}] Job ${job.id} failed: ${job.error}`);
  }

  /**
   * 等待活跃任务完成
   */
  private async waitForActiveJobs(): Promise<void> {
    while (this.activeJobs.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

// 全局 Worker 实例
let globalWorker: PipelineWorker | null = null;

export function getWorker(): PipelineWorker {
  if (!globalWorker) {
    globalWorker = new PipelineWorker();
  }
  return globalWorker;
}

export function startWorker(): PipelineWorker {
  const worker = getWorker();
  worker.start();
  return worker;
}

export function stopWorker(): Promise<void> {
  if (globalWorker) {
    return globalWorker.stop();
  }
  return Promise.resolve();
}
