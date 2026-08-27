/**
 * Multi-Agent Orchestrator
 *
 * 负责多 Agent 协作编排：
 * - 每个 Phase 由真实 Agent（AgentCore + AgentLLMProvider）执行
 * - 质量关卡 ReviewGate 用 LLM 真实评估
 * - 通过 SSE 推送进度与日志
 */

import { randomUUID } from 'node:crypto';
import { AgentCore } from '../agent/AgentCore';
import type { AgentConfig } from '../agent/types';
import { AgentLLMProvider } from '../agent/llm/AgentLLMProvider';
import { createAgentCoreAdapter } from '../agent/llm/AgentCoreLLMAdapter';
import { createToolExecutor } from '../tools/tool-registry';
import { getToolRegistry } from '../tools/tool-registry';
import { llmRegistry } from '../llm/registry';
import { resolveDefaultProvider } from '../llm/llm-gateway';
import type { LLMProvider } from '../llm/types';
import { ROLE_PROMPTS } from './roles';
import type { AgentRole } from './roles';
import {
  evaluateQuality,
  makeGateDecision,
  DEFAULT_GATE_CONFIGS,
  type GateConfig,
  type GateDecision,
} from './review-gate';
import { getSSEClientManager } from '../sse/index';
import type { SSEEvent } from '../sse/index';
import {
  getAgentDebugLogger,
  createLoggingLLMProvider,
  createLoggingToolExecutor,
} from '../agent/debug';
import type { AgentEventHandler } from '../agent/AgentCore';
import { assessWithLLM } from '../eval/llm-quality';

export interface OrchestratorTask {
  id: string;
  jobId?: string;
  /** 归属用户（多用户数据隔离，NULL 表示旧任务/内部任务） */
  userId?: string;
  input: string;
  title?: string;
  author?: string;
  modelId?: string;
  phaseCount: number;
  phases: OrchestratorPhase[];
  /** 用户附加指令（人工介入后恢复执行时沿用） */
  instruction?: string;
  /** 质量关卡等待人工介入的挂起信息 */
  awaiting?: {
    phaseId: string;
    phaseName: string;
    reason: string;
    decision: GateDecision;
    /** 挂起阶段的可视输出摘要（供人工介入参考） */
    outputSummary?: string;
  };
}

export interface OrchestratorPhase {
  id: string;
  name: string;
  description: string;
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting';
  output?: unknown;
  retryCount: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface OrchestratorResult {
  taskId: string;
  jobId?: string;
  title: string;
  success: boolean;
  durationMs: number;
  phases: OrchestratorPhase[];
  gateResults: Record<string, { decision: string; reason: string }>;
  error?: string;
  output?: unknown;
}

/** 人工介入动作：批准 / 重新生成 / 放弃 / 按用户建议修改重跑 */
export type ManualReviewAction = 'approve' | 'retry' | 'discard' | 'revise';

/** Agent 任务持久化适配器（P-记忆）：将 orchestrator 任务落盘并在重启后恢复 */
export type AgentTaskStatus = 'active' | 'completed' | 'failed';

export interface AgentTaskPersistence {
  /** 全量保存任务状态（存在则覆盖） */
  upsert(task: OrchestratorTask, status?: AgentTaskStatus): void;
  /** 加载所有未完成任务（服务重启后恢复用） */
  loadActive(): Array<{ task: OrchestratorTask }>;
}

export interface OrchestratorConfig {
  /** 是否启用质量关卡（默认 true） */
  enableReviewGates: boolean;
  /** 是否自动重试（默认 true） */
  enableAutoRetry: boolean;
  /** 并发场景数（默认 3） */
  maxConcurrentScenes: number;
  /** 质量阈值（默认 75） */
  defaultQualityThreshold: number;
  /** 注入 LLM Provider（默认从 llmRegistry 获取） */
  provider?: LLMProvider;
  /** 任务持久化适配器（P-记忆）；不注入则纯内存运行 */
  persistence?: AgentTaskPersistence;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  enableReviewGates: true,
  enableAutoRetry: true,
  maxConcurrentScenes: 3,
  defaultQualityThreshold: 75,
};

const DEFAULT_PHASES: Array<Omit<OrchestratorPhase, 'id' | 'status' | 'retryCount'>> = [
  {
    name: 'analyze',
    description: '分析小说，提取角色、地点与时间线',
    role: 'analyzer',
  },
  {
    name: 'segment',
    description: '将小说拆分为可转换的场景单元',
    role: 'writer',
  },
  {
    name: 'convert',
    description: '将场景单元转换为剧本对白与动作',
    role: 'writer',
  },
  {
    name: 'merge',
    description: '合并校验，产出最终剧本',
    role: 'editor',
  },
];

export class MultiAgentOrchestrator {
  private tasks = new Map<string, OrchestratorTask>();
  private config: OrchestratorConfig;
  /** 每个 phase 的调试日志包装 provider（key: taskId:phaseId） */
  private phaseProviders = new Map<string, LLMProvider>();

  constructor(config?: Partial<OrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 启动一次转换任务
   */
  startConversion(input: {
    novelText: string;
    title?: string;
    author?: string;
    selectedChapters?: number[];
    instruction?: string;
    /** 归属用户（多用户数据隔离） */
    userId?: string;
  }): string {
    const taskId = randomUUID();
    const phases: OrchestratorPhase[] = DEFAULT_PHASES.map((p) => ({
      ...p,
      id: `${taskId}-${p.name}`,
      status: 'pending',
      retryCount: 0,
    }));

    const task: OrchestratorTask = {
      id: taskId,
      userId: input.userId,
      input: input.novelText,
      title: input.title,
      author: input.author,
      instruction: input.instruction,
      phaseCount: phases.length,
      phases,
    };

    this.tasks.set(taskId, task);
    this.persistTask(task, 'active');

    // 异步执行
    void this.execute(taskId, input.instruction).catch((err) => {
      console.error(`[Orchestrator] 任务 ${taskId} 执行失败:`, err);
      this.updatePhaseStatus(taskId, 'failed', err.message);
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
   * 从持久化存储恢复未完成任务（P-记忆：服务重启后调用）。
   * - 无 persistence 时直接返回
   * - 崩溃遗留的 running 阶段结果未落盘，置回 pending 重新执行
   * - awaiting 挂起任务保持挂起，等待人工介入（不自动续跑）
   * - 其余未完成任务自动续跑
   */
  async restoreFromPersistence(): Promise<void> {
    const persistence = this.config.persistence;
    if (!persistence) return;

    let records: Array<{ task: OrchestratorTask }> = [];
    try {
      records = persistence.loadActive();
    } catch (err) {
      console.error(`[Orchestrator] 恢复 Agent 任务失败:`, err);
      return;
    }

    for (const { task } of records) {
      // 修复崩溃遗留：running 阶段结果未落盘，置回 pending 重新执行
      for (const p of task.phases) {
        if (p.status === 'running') p.status = 'pending';
      }

      this.tasks.set(task.id, task);

      // 挂起任务保持挂起，等待人工介入
      if (task.awaiting) {
        this.emit('log', {
          taskId: task.id,
          level: 'info',
          message: `任务已从持久化存储恢复（${task.awaiting.phaseName} 等待人工介入）`,
        });
        continue;
      }

      const firstIncomplete = task.phases.findIndex((p) => p.status === 'pending');
      if (firstIncomplete === -1) {
        // active 记录不应全 completed；防御性标记完成
        this.persistTask(task, 'completed');
        continue;
      }

      this.emit('log', {
        taskId: task.id,
        level: 'info',
        message: `任务已从持久化存储恢复，继续执行剩余阶段`,
      });
      void this.execute(task.id, task.instruction, firstIncomplete).catch((err) => {
        console.error(`[Orchestrator] 恢复任务 ${task.id} 续跑失败:`, err);
        this.updatePhaseStatus(task.id, 'failed', err.message);
      });
    }
  }

  /**
   * 将任务全量状态写入持久化存储（P-记忆）。未注入 persistence 时为 no-op。
   */
  private persistTask(task: OrchestratorTask, status?: AgentTaskStatus): void {
    const persistence = this.config.persistence;
    if (!persistence) return;
    try {
      persistence.upsert(task, status);
    } catch (err) {
      console.error(`[Orchestrator] 持久化任务 ${task.id} 失败:`, err);
    }
  }

  /**
   * 执行完整流水线
   */
  private async execute(taskId: string, instruction?: string, startIndex = 0): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const t0 = Date.now();
    if (startIndex === 0) this.emit('task_start', { taskId });

    for (let i = startIndex; i < task.phases.length; i++) {
      const phase = task.phases[i];
      // 人工介入恢复执行时跳过已完成的阶段
      if (phase.status === 'completed') continue;
      // 仍处于等待人工介入（防重入）
      if (phase.status === 'awaiting') break;

      phase.status = 'running';
      phase.startedAt = Date.now();
      this.emit('phase_start', { taskId, phaseId: phase.id, name: phase.name });
      this.emit('log', {
        taskId,
        level: 'info',
        message: `开始阶段: ${phase.name} (${phase.role})`,
      });

      try {
        const output = await this.executePhase(task, phase, instruction);
        phase.output = output;
        phase.status = 'completed';
        phase.completedAt = Date.now();
        this.emit('phase_complete', { taskId, phaseId: phase.id, name: phase.name });
        this.emit('log', {
          taskId,
          level: 'info',
          message: `阶段完成: ${phase.name}`,
        });

        // 质量关卡：评估 → 不达标自动重试 → 仍不达标按 onFail 策略分发
        if (this.config.enableReviewGates) {
          const gateConfig = this.getGateConfig(phase.name);
          let gate = await this.evaluateGate(task, phase, output);
          this.emit('gate_result', { taskId, phaseId: phase.id, gate });

          const isBelow = () => gate.decision === 'fail' || gate.decision === 'review';
          while (
            isBelow() &&
            this.config.enableAutoRetry &&
            phase.retryCount < gateConfig.maxRetries
          ) {
            phase.retryCount += 1;
            this.emit('log', {
              taskId,
              level: 'warning',
              message: `阶段 ${phase.name} 质量未达标 (${gate.reason})，自动重试 (${phase.retryCount}/${gateConfig.maxRetries})`,
            });
            phase.status = 'running';
            const retryOutput = await this.executePhase(task, phase, instruction);
            phase.output = retryOutput;
            phase.status = 'completed';
            phase.completedAt = Date.now();
            gate = await this.evaluateGate(task, phase, retryOutput);
            this.emit('gate_result', { taskId, phaseId: phase.id, gate });
          }

          if (isBelow()) {
            if (gateConfig.onFail === 'manual_review') {
              // 挂起等待人工介入（不判失败，任务保持可恢复）
              const outputSummary = formatOutputSummary(phase.output);
              phase.status = 'awaiting';
              phase.error = `质量未达标（待人工介入）: ${gate.reason}`;
              phase.completedAt = Date.now();
              task.awaiting = {
                phaseId: phase.id,
                phaseName: phase.name,
                reason: gate.reason,
                decision: gate.decision,
                outputSummary,
              };
              this.emit('phase_awaiting_manual', {
                taskId,
                phaseId: phase.id,
                name: phase.name,
                reason: gate.reason,
                gate,
                outputSummary,
              });
              this.emit('log', {
                taskId,
                level: 'warning',
                message: `阶段 ${phase.name} 质量未达标，等待人工介入: ${gate.reason}`,
              });
              this.persistTask(task);
              break;
            } else if (gateConfig.onFail === 'skip') {
              phase.status = 'skipped';
              phase.completedAt = Date.now();
              this.emit('log', {
                taskId,
                level: 'warning',
                message: `阶段 ${phase.name} 质量未达标，跳过: ${gate.reason}`,
              });
              this.persistTask(task);
              continue;
            } else {
              // 'stop'（含重试耗尽仍配置 stop 的场景）
              phase.status = 'failed';
              phase.error = `质量未达标: ${gate.reason}`;
              phase.completedAt = Date.now();
              this.emit('phase_failed', { taskId, phaseId: phase.id, error: phase.error });
              this.emit('log', {
                taskId,
                level: 'error',
                message: `阶段失败: ${phase.name} - 质量未达标`,
              });
              this.persistTask(task);
              break;
            }
          }
        }
        // 质量关卡通过（或关闭）→ 阶段 completed 落库
        this.persistTask(task);
      } catch (err) {
        phase.status = 'failed';
        phase.error = err instanceof Error ? err.message : String(err);
        phase.completedAt = Date.now();
        this.emit('phase_failed', { taskId, phaseId: phase.id, error: phase.error });
        this.emit('log', {
          taskId,
          level: 'error',
          message: `阶段失败: ${phase.name} - ${phase.error}`,
        });
        this.persistTask(task);
        break;
      }
    }

    // 任务挂起等待人工介入：不发 task_complete
    if (task.awaiting) {
      const { phaseId, phaseName, reason, outputSummary } = task.awaiting;
      this.emit('task_awaiting', { taskId, phaseId, name: phaseName, reason, outputSummary });
      this.emit('log', {
        taskId,
        level: 'warning',
        message: `任务挂起：${phaseName} 等待人工介入`,
      });
      return;
    }

    const success = task.phases.every((p) => p.status === 'completed');
    await this.finalizeTask(taskId, success, t0);
  }

  /**
   * 人工介入处理：批准继续 / 重新生成 / 放弃 / 按用户建议修改重跑
   * revise 时携带 instruction（自由文本追问），追加到任务指令后重跑当前阶段，
   * 后续阶段同样沿用用户建议。
   * @returns 是否成功处理
   */
  resolveManualReview(
    taskId: string,
    phaseId: string,
    action: ManualReviewAction,
    instruction?: string,
  ): boolean {
    const task = this.tasks.get(taskId);
    const awaiting = task?.awaiting;
    if (!task || !awaiting || awaiting.phaseId !== phaseId) return false;

    const idx = task.phases.findIndex((p) => p.id === phaseId);
    const phase = task.phases[idx];
    if (idx === -1 || !phase || phase.status !== 'awaiting') return false;

    if (action === 'revise' && !instruction?.trim()) return false;

    // 清除挂起标记
    task.awaiting = undefined;
    this.persistTask(task);

    if (action === 'approve') {
      phase.status = 'completed';
      phase.completedAt = Date.now();
      phase.error = undefined;
      this.emit('phase_complete', { taskId, phaseId, name: phase.name });
      this.emit('log', {
        taskId,
        level: 'info',
        message: `人工介入：接受 ${phase.name} 输出，继续后续阶段`,
      });
      void this.execute(taskId, task.instruction, idx + 1).catch((err) => {
        console.error(`[Orchestrator] 人工介入后任务 ${taskId} 执行失败:`, err);
        this.updatePhaseStatus(taskId, 'failed', err.message);
      });
      return true;
    }

    // retry 与 revise 都重跑当前阶段；revise 额外将用户建议累积进任务指令
    if (action === 'revise') {
      task.instruction = [task.instruction, instruction?.trim()]
        .filter(Boolean)
        .join('\n');
      this.persistTask(task);
    }

    if (action === 'retry' || action === 'revise') {
      phase.retryCount += 1;
      phase.status = 'pending';
      phase.error = undefined;
      this.emit('log', {
        taskId,
        level: 'info',
        message:
          action === 'revise'
            ? `人工介入：按用户建议重新生成 ${phase.name}（建议：${instruction?.trim()}）`
            : `人工介入：重新生成 ${phase.name}（第 ${phase.retryCount} 次）`,
      });
      void this.execute(taskId, task.instruction, idx).catch((err) => {
        console.error(`[Orchestrator] 人工介入后任务 ${taskId} 执行失败:`, err);
        this.updatePhaseStatus(taskId, 'failed', err.message);
      });
      return true;
    }

    // discard：放弃该阶段，任务失败
    phase.status = 'failed';
    phase.error = '人工放弃该阶段';
    phase.completedAt = Date.now();
    this.emit('phase_failed', { taskId, phaseId, name: phase.name, error: phase.error });
    this.emit('log', {
      taskId,
      level: 'error',
      message: `人工放弃阶段 ${phase.name}，任务终止`,
    });
    void this.finalizeTask(taskId, false, Date.now()).catch((err) => {
      console.error(`[Orchestrator] 任务收尾失败:`, err);
    });
    return true;
  }

  /**
   * 任务收尾：持久化结果 + 推送 task_complete
   */
  private async finalizeTask(
    taskId: string,
    success: boolean,
    t0: number,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const durationMs = Date.now() - t0;

    // 持久化任务结果
    if (task.jobId) {
      try {
        const { jobStore } = await import('../store/job-store');
        jobStore.update(task.jobId, (job) => ({
          ...job,
          status: success ? 'completed' : 'failed',
          currentPhase: success ? 5 : (job.currentPhase ?? 0),
          progress: success ? 100 : (job.progress ?? 0),
          completedAt: Date.now(),
        }));
      } catch (err) {
        console.error(`[Orchestrator] 持久化结果失败:`, err);
      }
    }

    // Agent 任务终态落库（保留记录供审计/查询）
    this.persistTask(task, success ? 'completed' : 'failed');

    this.emit('task_complete', {
      taskId,
      success,
      durationMs,
      phases: task.phases.map((p) => ({ id: p.id, name: p.name, status: p.status })),
    });
    this.emit('log', {
      taskId,
      level: success ? 'info' : 'error',
      message: success
        ? `任务完成，耗时 ${(durationMs / 1000).toFixed(1)}s`
        : '任务失败，存在未完成阶段',
    });
  }

  /**
   * 执行单个阶段
   * 真实调用 AgentCore：实例化 Agent、调用 LLM、执行工具循环
   */
  private async executePhase(
    task: OrchestratorTask,
    phase: OrchestratorPhase,
    instruction?: string,
  ): Promise<unknown> {
    const provider = this.getPhaseProvider(task, phase);
    if (!provider) {
      throw new Error('未配置 LLM Provider，请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY');
    }

    // 调试日志：开启会话（幂等）
    const debugLogger = getAgentDebugLogger();
    debugLogger.beginSession(task.id, {
      phase: phase.name,
      role: phase.role,
      jobId: task.jobId,
      modelId: provider.modelId,
      userId: task.userId,
    });

    const agentLLM = new AgentLLMProvider(provider);
    const llmAdapter = createAgentCoreAdapter(agentLLM);

    // 注册工具（幂等）
    const toolRegistry = getToolRegistry();
    if (toolRegistry.list().length === 0) {
      const { initializeBuiltinTools } = await import('../tools/builtin-tools');
      const { createBuiltinToolDeps } = await import('../tools/builtin-tools-assembly');
      initializeBuiltinTools(createBuiltinToolDeps());
    }
    const toolExecutor = createLoggingToolExecutor(createToolExecutor(task.userId), debugLogger, {
      taskId: task.id,
      phase: phase.name,
      role: phase.role,
    });
    const tools = toolRegistry.toAgentTools();

    const phaseDescription = instruction
      ? `${phase.description}\n用户附加指令: ${instruction}`
      : phase.description;

    const agentConfig: AgentConfig = {
      modelId: provider.modelId,
      maxTokens: 4096,
      temperature: phase.role === 'analyzer' ? 0.3 : 0.5,
      maxSteps: 20,
      maxTotalTokens: 64000,
      maxConcurrentTools: 3,
      verbose: false,
      systemPrompt: ROLE_PROMPTS[phase.role as AgentRole] ?? DEFAULT_SYSTEM_PROMPT,
      tools,
    };

    const agent = new AgentCore(agentConfig, llmAdapter, toolExecutor);

    // 订阅 Agent 事件 → 调试日志
    const unsubscribe = agent.on(toDebugEventHandler(task.id, phase));
    try {
      // 构造任务输入：小说原文 + 前面阶段输出摘要 + 用户指令
      const context = this.buildAgentContext(task, phase);
      const novelSource =
        task.input && task.input.trim().length > 0
          ? `\n\n小说原文:\n${task.input}`
          : '';
      const runPrompt = [
        phaseDescription,
        novelSource,
        context.length > 0 ? `\n\n前面阶段输出:\n${context}` : '',
        `\n\n需要执行的工作: ${phase.description}`,
        `\n可用工具: ${tools.map((t) => t.name).join(', ')}`,
      ].join('');

      this.emit('log', {
        taskId: task.id,
        level: 'debug',
        message: `[Agent:${phase.role}] 开始执行 ${phase.name}`,
      });

      const result = await agent.run(runPrompt);

      this.emit('log', {
        taskId: task.id,
        level: 'debug',
        message: `[Agent:${phase.role}] ${phase.name} 完成`,
      });

      // 返回结构化结果
      return {
        agentResult: result,
        completedAt: Date.now(),
      };
    } finally {
      unsubscribe();
    }
  }

  /**
   * 获取（并缓存）带调试日志包装的 phase provider。
   * 同一 phase 的 Agent 执行与质量关卡评估复用同一包装，日志归入同一会话。
   */
  private getPhaseProvider(
    task: OrchestratorTask,
    phase: OrchestratorPhase,
  ): LLMProvider | undefined {
    const key = `${task.id}:${phase.id}`;
    const cached = this.phaseProviders.get(key);
    if (cached) return cached;

    const raw =
      this.config.provider ?? resolveDefaultProvider(task.userId) ?? llmRegistry.getDefault();
    if (!raw) return undefined;

    const wrapped = createLoggingLLMProvider(raw, getAgentDebugLogger(), {
      taskId: task.id,
      phase: phase.name,
      role: phase.role,
    });
    this.phaseProviders.set(key, wrapped);
    return wrapped;
  }

  /**
   * 质量关卡：LLM 真实评估
   */
  private async evaluateGate(
    task: OrchestratorTask,
    phase: OrchestratorPhase,
    output: unknown,
  ): Promise<{ decision: GateDecision; reason: string }> {
    const provider = this.getPhaseProvider(task, phase);
    const gateConfig = this.getGateConfig(phase.name);

    // 把 Agent 输出转换为评估文本
    const content = this.serializeOutput(output);

    const assessment = await evaluateQuality(
      content,
      gateConfig,
      provider
        ? () =>
            assessWithLLM(provider, content, {
              passThreshold: this.config.defaultQualityThreshold,
            })
        : undefined,
    );

    this.emit('log', {
      taskId: task.id,
      level: 'debug',
      message: `[Gate:${phase.name}] 质量评分 ${assessment.score}/100`,
    });

    return makeGateDecision(assessment, gateConfig);
  }

  private getGateConfig(phaseName: string): GateConfig {
    const key = gateConfigMap[phaseName];
    return DEFAULT_GATE_CONFIGS[key] ?? DEFAULT_GATE_CONFIGS.analysis_characters;
  }

  /**
   * 构造 Agent 上下文：前面阶段的输出摘要
   */
  private buildAgentContext(task: OrchestratorTask, currentPhase: OrchestratorPhase): string {
    const prior = task.phases.filter(
      (p) => p.status === 'completed' || (p.id === currentPhase.id && p.status === 'running'),
    );
    if (prior.length === 0) return '';
    return prior
      .map((p) => {
        const output = p.output as { agentResult?: string } | undefined;
        const text = output?.agentResult ?? '';
        return `[${p.name}]\n${String(text).slice(0, 2000)}`;
      })
      .join('\n\n');
  }

  private serializeOutput(output: unknown): string {
    if (typeof output === 'string') return output;
    if (output && typeof output === 'object') {
      const agentResult = (output as { agentResult?: unknown }).agentResult;
      if (typeof agentResult === 'string') return agentResult;
      return JSON.stringify(agentResult ?? output, null, 2);
    }
    return String(output);
  }

  private updatePhaseStatus(taskId: string, status: OrchestratorPhase['status'], error?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const running = task.phases.find((p) => p.status === 'running');
    if (running) {
      running.status = status;
      running.error = error;
      running.completedAt = Date.now();
      this.persistTask(task);
    }
  }

  private emit(event: string, payload: Record<string, unknown>): void {
    const sse = getSSEClientManager();
    const jobId = payload.taskId as string;
    const evt: SSEEvent = {
      type: toSSEEventType(event),
      data: { event, ...payload },
      timestamp: Date.now(),
    };
    try {
      sse.sendToJob(jobId, evt);
    } catch {
      // SSE 未连接时静默
    }
  }
}

function toSSEEventType(event: string): SSEEvent['type'] {
  switch (event) {
    case 'task_start':
    case 'task_complete':
      return 'complete';
    case 'phase_start':
    case 'phase_complete':
      return 'phase';
    case 'gate_result':
    case 'phase_awaiting_manual':
      return 'progress';
    case 'task_awaiting':
      return 'complete';
    case 'log':
      return 'log';
    default:
      return 'progress';
  }
}

/**
 * 将 AgentCore 事件转换为调试日志条目处理器。
 */
function toDebugEventHandler(taskId: string, phase: OrchestratorPhase): AgentEventHandler {
  const logger = getAgentDebugLogger();
  return (event) => {
    const base = {
      taskId,
      phase: phase.name,
      role: phase.role,
    };
    switch (event.type) {
      case 'state_change':
        logger.append(taskId, {
          type: 'state_change',
          level: 'debug',
          data: { ...base, from: event.from, to: event.to },
        });
        break;
      case 'step_complete':
        logger.append(taskId, {
          type: 'task_event',
          level: 'debug',
          data: {
            ...base,
            event: 'step_complete',
            stepIndex: event.step.index,
            action: event.step.action,
            observation: event.step.observation,
          },
        });
        break;
      case 'task_start':
      case 'task_complete':
      case 'task_error':
      case 'token_warning':
        logger.append(taskId, {
          type: 'task_event',
          level: event.type === 'task_error' ? 'error' : 'info',
          data: { ...base, event: event.type, ...event },
        });
        break;
    }
  };
}

/**
 * 生成阶段输出的人类可读摘要，供人工介入（awaiting）时参考
 */
function formatOutputSummary(output: unknown): string {
  if (output == null) return '（无输出）';
  if (Array.isArray(output)) return `共 ${output.length} 项输出`;
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    const parts = Object.entries(obj).map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: ${v.length} 项`;
      if (typeof v === 'string') return `${k}: ${v.slice(0, 60)}`;
      try {
        return `${k}: ${JSON.stringify(v)}`;
      } catch {
        return `${k}: ?`;
      }
    });
    return parts.join('；').slice(0, 240) || '（空对象）';
  }
  return String(output).slice(0, 240);
}

const gateConfigMap: Record<string, keyof typeof DEFAULT_GATE_CONFIGS> = {
  analyze: 'analysis_characters',
  segment: 'segmentation_scenes',
  convert: 'conversion_scene',
  merge: 'merge_validation',
};

const DEFAULT_SYSTEM_PROMPT =
  '你是一个专业的影视剧本创作助手。根据任务描述，使用可用工具完成小说到剧本的转换工作。' +
  '每一步都先规划，再调用工具执行，最后总结结果。输出保持结构化、可解析。';
