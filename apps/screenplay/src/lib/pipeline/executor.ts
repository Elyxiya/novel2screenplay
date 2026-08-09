/**
 * Pipeline Executor
 *
 * 执行 Pipeline 任务的核心逻辑。
 * 内部使用 PipelineEngine 执行 4 阶段转换。
 */

import { PipelineEngine } from './PipelineEngine';
import { initializeProviders } from '../llm/registry';
import type { PipelineJob, PipelineJobOutput } from '../jobs/types';

export interface ExecuteOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number, subProgress?: string) => void;
}

export interface ExecuteResult {
  success: boolean;
  /** SQLite 持久化任务 ID（PipelineEngine.startJob 创建，主链路 jobStore） */
  jobId?: string;
  output?: PipelineJobOutput;
  error?: string;
}

// 初始化 LLM Providers
initializeProviders();

/**
 * Pipeline 执行器
 * 
 * 桥接 Job 系统和 PipelineEngine，
 * 将 Job 输入转换为 Pipeline 输入并执行。
 */
export class PipelineExecutor {
  private engine: PipelineEngine;

  constructor() {
    this.engine = new PipelineEngine();
  }

  /**
   * 执行任务
   */
  async execute(job: PipelineJob, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    const { signal, onProgress } = options;

    console.log(`[Executor] Starting job ${job.id}`);

    try {
      if (signal?.aborted) {
        return { success: false, error: 'Job was cancelled before execution' };
      }

      const { novelText, selectedChapters } = job.input;

      if (!novelText) {
        return { success: false, error: 'Job missing novelText input' };
      }

      onProgress?.(5, '准备转换...');

      // startJob 在 SQLite jobStore 创建持久化任务并异步执行
      // （主链路：结果以 /api/result/[jobId] 为准）
      const jobId = await this.engine.startJob({
        novelText,
        title: job.metadata?.title as string | undefined,
        author: job.metadata?.author as string | undefined,
        modelId: job.modelId,
        selectedChapters,
      });

      onProgress?.(100, '完成');

      return {
        success: true,
        jobId,
        output: job.output,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// 全局实例
let executor: PipelineExecutor | null = null;

export function getExecutor(): PipelineExecutor {
  if (!executor) {
    executor = new PipelineExecutor();
  }
  return executor;
}
