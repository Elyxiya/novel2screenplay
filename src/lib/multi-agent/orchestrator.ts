/**
 * MultiAgentOrchestrator - 多 Agent 编排器
 *
 * 协调多个 Agent 完成剧本转换任务。
 */

import type { AgentRole } from './roles';
import type { HandoffPayload } from './handoff-protocol';
import type { GateConfig, GateResult, GateContext } from './review-gate';
import { DEFAULT_GATE_CONFIGS } from './review-gate';
import { getAgentRegistry } from './registry';
import { getHandoffManager } from './handoff-manager';
import { getSSEClientManager } from '../sse';

export interface OrchestratorConfig {
  /** 是否启用质量关卡 */
  enableReviewGates: boolean;
  /** 是否启用自动重试 */
  enableAutoRetry: boolean;
  /** 最大并发场景数 */
  maxConcurrentScenes: number;
  /** 默认质量阈值 */
  defaultQualityThreshold: number;
}

export interface OrchestratorTask {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  phases: OrchestratorPhase[];
  currentPhaseIndex: number;
  createdAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface OrchestratorPhase {
  id: string;
  name: string;
  role: AgentRole;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: unknown;
  output: unknown;
  gateResult: GateResult | null;
  handoffs: string[];
}

export interface OrchestratorResult {
  success: boolean;
  taskId: string;
  phases: OrchestratorPhase[];
  totalDuration: number;
  qualityScore: number;
  errors: string[];
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  enableReviewGates: true,
  enableAutoRetry: true,
  maxConcurrentScenes: 5,
  defaultQualityThreshold: 75,
};

export class MultiAgentOrchestrator {
  private config: OrchestratorConfig;
  private tasks = new Map<string, OrchestratorTask>();

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 创建并启动转换任务
   */
  async startConversion(input: {
    novelText: string;
    title?: string;
    selectedChapters?: number[];
  }): Promise<string> {
    const taskId = `orch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 创建任务
    const task: OrchestratorTask = {
      id: taskId,
      status: 'running',
      phases: this.createPhases(taskId),
      currentPhaseIndex: 0,
      createdAt: Date.now(),
      completedAt: null,
      error: null,
    };

    this.tasks.set(taskId, task);

    // 启动异步执行
    this.executeTask(task).catch((err) => {
      task.status = 'failed';
      task.error = (err as Error).message;
    });

    return taskId;
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): OrchestratorTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 创建转换流程阶段
   */
  private createPhases(taskId: string): OrchestratorPhase[] {
    return [
      {
        id: `${taskId}_phase_1`,
        name: '分析阶段',
        role: 'analyzer',
        status: 'pending',
        input: null,
        output: null,
        gateResult: null,
        handoffs: [],
      },
      {
        id: `${taskId}_phase_2`,
        name: '分割阶段',
        role: 'analyzer',
        status: 'pending',
        input: null,
        output: null,
        gateResult: null,
        handoffs: [],
      },
      {
        id: `${taskId}_phase_3`,
        name: '转换阶段',
        role: 'writer',
        status: 'pending',
        input: null,
        output: null,
        gateResult: null,
        handoffs: [],
      },
      {
        id: `${taskId}_phase_4`,
        name: '编辑阶段',
        role: 'editor',
        status: 'pending',
        input: null,
        output: null,
        gateResult: null,
        handoffs: [],
      },
      {
        id: `${taskId}_phase_5`,
        name: '验证阶段',
        role: 'validator',
        status: 'pending',
        input: null,
        output: null,
        gateResult: null,
        handoffs: [],
      },
    ];
  }

  /**
   * 执行任务流程
   */
  private async executeTask(task: OrchestratorTask): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const sseManager = getSSEClientManager();

    this.emitSSE(task.id, 'task_start', { taskId: task.id });

    for (let i = 0; i < task.phases.length; i++) {
      task.currentPhaseIndex = i;
      const phase = task.phases[i];

      this.emitSSE(task.id, 'phase_start', {
        phaseIndex: i,
        phaseName: phase.name,
        role: phase.role,
      });

      try {
        await this.executePhase(task, phase);
        phase.status = 'completed';
        this.emitSSE(task.id, 'phase_complete', { phaseIndex: i, phaseName: phase.name });
      } catch (err) {
        phase.status = 'failed';
        const errorMsg = `Phase ${phase.name} failed: ${(err as Error).message}`;
        errors.push(errorMsg);
        this.emitSSE(task.id, 'phase_error', { phaseIndex: i, error: errorMsg });

        if (!this.config.enableAutoRetry) {
          break;
        }
      }

      // 检查是否需要停止
      if (phase.status === 'failed') {
        break;
      }
    }

    const totalDuration = Date.now() - startTime;
    const success = task.phases.every((p) => p.status === 'completed');

    task.status = success ? 'completed' : 'failed';
    task.completedAt = Date.now();

    const result: OrchestratorResult = {
      success,
      taskId: task.id,
      phases: task.phases,
      totalDuration,
      qualityScore: this.calculateAverageQuality(task.phases),
      errors,
    };

    this.emitSSE(task.id, 'task_complete', result);

    return result;
  }

  /**
   * 执行单个阶段
   */
  private async executePhase(task: OrchestratorTask, phase: OrchestratorPhase): Promise<void> {
    phase.status = 'running';

    // 模拟 Agent 执行
    // 实际实现中，这里会调用相应的 Agent
    await this.simulateAgentWork(phase);

    // 获取关卡配置
    const gateConfig = this.getGateConfig(phase);

    // 如果启用质量关卡，进行评估
    if (this.config.enableReviewGates && gateConfig) {
      const gateResult = await this.evaluateGate(task.id, phase, gateConfig);
      phase.gateResult = gateResult;

      if (gateResult.decision === 'fail') {
        // 根据配置处理失败
        if (gateConfig.onFail === 'stop') {
          throw new Error(`Gate ${gateConfig.id} failed: ${gateResult.reason}`);
        } else if (gateConfig.onFail === 'retry' && gateResult.retryCount < gateConfig.maxRetries) {
          // 重试
          phase.gateResult.retryCount++;
          await this.executePhase(task, phase);
        } else if (gateConfig.onFail === 'manual_review') {
          // 人工审核（暂时跳过）
          console.log(`[Orchestrator] Manual review required for ${gateConfig.id}`);
        }
      }
    }
  }

  /**
   * 评估质量关卡
   */
  private async evaluateGate(
    taskId: string,
    phase: OrchestratorPhase,
    config: GateConfig,
  ): Promise<GateResult> {
    const startTime = Date.now();

    // 模拟验证
    const assessment = {
      score: 80,
      passed: true,
      dimensions: {
        format: 85,
        consistency: 80,
        coherence: 75,
        drama: 80,
      },
      issues: [] as string[],
      suggestions: [] as string[],
    };

    const decision = assessment.score >= config.criteria.minScore ? 'pass' : 'fail';

    return {
      gateId: config.id,
      decision,
      assessment,
      reason: decision === 'pass' ? '通过质量检查' : '未达到质量标准',
      timestamp: Date.now(),
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }

  /**
   * 获取关卡配置
   */
  private getGateConfig(phase: OrchestratorPhase): GateConfig | null {
    const configMap: Record<string, string> = {
      '分析阶段': 'analysis_characters',
      '分割阶段': 'segmentation_scenes',
      '转换阶段': 'conversion_scene',
      '编辑阶段': 'merge_validation',
      '验证阶段': 'final_quality',
    };

    const configKey = configMap[phase.name];
    return configKey ? DEFAULT_GATE_CONFIGS[configKey] : null;
  }

  /**
   * 模拟 Agent 工作
   */
  private async simulateAgentWork(phase: OrchestratorPhase): Promise<void> {
    // 实际实现中，这里会调用相应的 Agent
    // 暂时模拟工作延迟
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 设置模拟输出
    phase.output = { processed: true, timestamp: Date.now() };
  }

  /**
   * 计算平均质量分数
   */
  private calculateAverageQuality(phases: OrchestratorPhase[]): number {
    const gateResults = phases
      .map((p) => p.gateResult)
      .filter((r): r is GateResult => r !== null);

    if (gateResults.length === 0) return 0;

    const total = gateResults.reduce((sum, r) => sum + r.assessment.score, 0);
    return Math.round(total / gateResults.length);
  }

  /**
   * 发送 SSE 事件
   */
  private emitSSE(taskId: string, eventType: string, data: unknown): void {
    const sseManager = getSSEClientManager();
    sseManager.sendToJob(taskId, {
      type: eventType as 'progress' | 'log' | 'phase' | 'complete' | 'heartbeat',
      data,
      timestamp: Date.now(),
    });
  }
}

// 全局单例
const GLOBAL_KEY = '__novel2screenplay_orchestrator__';

export function getOrchestrator(): MultiAgentOrchestrator {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new MultiAgentOrchestrator();
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as MultiAgentOrchestrator;
  }
  return new MultiAgentOrchestrator();
}
