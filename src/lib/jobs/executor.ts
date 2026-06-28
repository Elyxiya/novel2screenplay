/**
 * Pipeline Executor
 *
 * 执行 Pipeline 任务的核心逻辑。
 */

import type { PipelineJob, PipelinePhase } from './types';

export interface ExecuteOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number, subProgress?: string) => void;
}

export interface ExecuteResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

/**
 * Pipeline 执行器
 */
export class PipelineExecutor {
  /**
   * 执行任务
   */
  async execute(job: PipelineJob, options: ExecuteOptions = {}): Promise<ExecuteResult> {
    const { signal, onProgress } = options;

    console.log(`[Executor] Starting job ${job.id}`);

    try {
      // 检查取消信号
      if (signal?.aborted) {
        return { success: false, error: 'Job was cancelled before execution' };
      }

      // 执行各阶段
      const phases = this.getPhases(job);
      let currentPhaseIndex = 0;

      for (const phase of phases) {
        // 检查取消信号
        if (signal?.aborted) {
          return { success: false, error: 'Job was cancelled during execution' };
        }

        onProgress?.(this.calculateProgress(currentPhaseIndex, phases.length), `阶段: ${phase.name}`);

        try {
          await this.executePhase(job, phase, signal);
          phase.status = 'completed';
          phase.completedAt = Date.now();
        } catch (error) {
          phase.status = 'failed';
          phase.error = error instanceof Error ? error.message : String(error);
          throw error;
        }

        currentPhaseIndex++;
      }

      onProgress?.(100, '完成');

      return {
        success: true,
        output: job.output,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取执行阶段列表
   */
  private getPhases(job: PipelineJob): PipelinePhase[] {
    const phases: PipelinePhase[] = [
      { id: 'segment', name: '分节', status: 'pending', progress: 0 },
      { id: 'analyze', name: '分析', status: 'pending', progress: 0 },
      { id: 'convert', name: '转换', status: 'pending', progress: 0 },
      { id: 'validate', name: '验证', status: 'pending', progress: 0 },
    ];

    job.currentPhase = phases[0];
    return phases;
  }

  /**
   * 执行单个阶段
   */
  private async executePhase(
    job: PipelineJob,
    phase: PipelinePhase,
    signal?: AbortSignal
  ): Promise<void> {
    phase.status = 'running';
    phase.startedAt = Date.now();
    job.currentPhase = phase;

    console.log(`[Executor] Starting phase ${phase.id} for job ${job.id}`);

    switch (phase.id) {
      case 'segment':
        await this.executeSegmentPhase(job, phase, signal);
        break;
      case 'analyze':
        await this.executeAnalyzePhase(job, phase, signal);
        break;
      case 'convert':
        await this.executeConvertPhase(job, phase, signal);
        break;
      case 'validate':
        await this.executeValidatePhase(job, phase, signal);
        break;
    }

    phase.progress = 100;
  }

  private async executeSegmentPhase(
    job: PipelineJob,
    phase: PipelinePhase,
    signal?: AbortSignal
  ): Promise<void> {
    // TODO: 调用分节服务
    await this.delay(100);
  }

  private async executeAnalyzePhase(
    job: PipelineJob,
    phase: PipelinePhase,
    signal?: AbortSignal
  ): Promise<void> {
    // TODO: 调用分析服务
    await this.delay(100);
  }

  private async executeConvertPhase(
    job: PipelineJob,
    phase: PipelinePhase,
    signal?: AbortSignal
  ): Promise<void> {
    // TODO: 调用转换服务
    await this.delay(100);
  }

  private async executeValidatePhase(
    job: PipelineJob,
    phase: PipelinePhase,
    signal?: AbortSignal
  ): Promise<void> {
    // TODO: 调用验证服务
    await this.delay(100);
  }

  private calculateProgress(currentPhaseIndex: number, totalPhases: number): number {
    const phaseWeight = 100 / totalPhases;
    return Math.round(currentPhaseIndex * phaseWeight);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
