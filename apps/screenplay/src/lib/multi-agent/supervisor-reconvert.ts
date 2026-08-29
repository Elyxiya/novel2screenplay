/**
 * 外科式 supervisor 手写 handoff 编排层（Task 4.4）
 *
 * 把「orchestrator 决策（Task 4.2）→ 经典链重转执行（Task 4.3）」这条链路接进
 * `multi-agent` 现有的 registry + handoff-protocol 基础设施，形成**手写 handoff**
 * 对照证据：
 *
 *   - supervisor 取 registry 中的 supervisor agent 标记 busy（外科路径占用）
 *   - 可执行重转场景（decision.reconvertScenes）→ 经典链执行（Task 4.3），
 *     产出 supervisor → writer 手写交接（记录决策 + 执行结果 + 重跑断言）
 *   - 无法执行（needs-manual）或超 escalation 预算（decision.escalatedScenes）
 *     → supervisor → validator 手写交接（升级人工介入）
 *
 * 对照意义：AgentCore 动态编排（AgentTaskPersistence/restore 持久化）是 LLM 驱动的
 * 多 agent 自由路径；本层是**确定性手写路径**——同一决策，用 registry 状态迁移 +
 * handoff 上下文链留痕，二者形成对照证据（spec §2.6：multi-agent 现有 registry/handoff
 * 接入该路径）。
 *
 * 执行前提：orchestrator「只决策不执行」——本层是决策的消费入口（supervisor / 前端监听
 * reconvert_decision 后调用），默认不介入 orchestrator 主链（Task 4.5 flag 默认关）。
 */

import type { AgentRole } from './roles';
import type { AgentInstance } from './agent-config';
import { getAgentRegistry } from './registry';
import type {
  HandoffPayload,
  HandoffRequest,
  HandoffResult,
} from './handoff-protocol';
import { getHandoffManager } from './handoff-manager';
import type { OrchestratorTask } from './orchestrator';
import type { ReconvertDecision } from './reconvert-decision';
import type {
  ReconvertBridgeOptions,
  TaskReconvertOutcome,
} from './reconvert-bridge';
import { executeReconvertForTask } from './reconvert-bridge';

/** 本层对 registry 的最小依赖（真实 AgentRegistry 结构上兼容；测试可注入 fake） */
export interface SurgicalRegistry {
  getAvailableByRole(role: AgentRole): AgentInstance[];
  getByRole(role: AgentRole): AgentInstance[];
  markBusy(instanceId: string, taskId: string): void;
  markIdle(instanceId: string): void;
}

/** 本层对 handoff 管理器的最小依赖（真实 HandoffProtocol 结构上兼容） */
export interface SurgicalHandoffSink {
  requestHandoff(request: HandoffRequest): Promise<HandoffResult>;
  completeHandoff(handoffId: string, result: HandoffPayload): Promise<void>;
}

export interface SupervisorReconvertOptions extends ReconvertBridgeOptions {
  /** 可注入 registry（测试用），缺省走 getAgentRegistry() 单例 */
  registry?: SurgicalRegistry;
  /** 可注入 handoff 管理器（测试用），缺省走 getHandoffManager() 单例 */
  handoffManager?: SurgicalHandoffSink;
}

/** 一次手写交接留痕（对照证据链的一条） */
export interface SurgicalReconvertHandoff {
  /** 交接 ID（requestHandoff 生成，未成功时为空串） */
  handoffId: string;
  fromRole: 'supervisor';
  toRole: 'writer' | 'validator';
  /** 交接原因（含目标场景号） */
  reason: string;
  /** 本次交接涉及场景号 */
  sceneNumbers: number[];
  status: 'completed' | 'failed';
}

export interface SurgicalReconvertResult {
  /** 经典链执行层结果（仅当存在可执行重转场景时） */
  outcome?: TaskReconvertOutcome;
  /** 手写 handoff 证据链（按发起顺序） */
  handoffs: SurgicalReconvertHandoff[];
}

/** 取某角色一个可用 agent（无空闲则取第一个，无则 undefined） */
function pickAgent(registry: SurgicalRegistry, role: AgentRole): AgentInstance | undefined {
  return registry.getAvailableByRole(role)[0] ?? registry.getByRole(role)[0];
}

/** 发起一次手写交接并留痕：requestHandoff（自动接受）→ completeHandoff → 释放目标 agent */
async function performHandoff(
  handoffManager: SurgicalHandoffSink,
  registry: SurgicalRegistry,
  args: {
    taskId: string;
    fromInstanceId: string | undefined;
    toRole: 'writer' | 'validator';
    reason: string;
    sceneNumbers: number[];
    contextSummary: string;
    metadata: Record<string, unknown>;
  },
): Promise<SurgicalReconvertHandoff> {
  const fromInstanceId = args.fromInstanceId ?? 'supervisor-surgical';
  const target = pickAgent(registry, args.toRole);

  const result = await handoffManager.requestHandoff({
    taskId: args.taskId,
    fromRole: 'supervisor',
    fromInstanceId,
    toRole: args.toRole,
    toInstanceId: target?.instanceId,
    reason: args.reason,
    payload: { contextSummary: args.contextSummary, metadata: args.metadata },
  });

  if (result.success && result.handoff.id) {
    await handoffManager.completeHandoff(result.handoff.id, {
      contextSummary: args.contextSummary,
      metadata: args.metadata,
    });
    if (target) registry.markIdle(target.instanceId);
  }

  return {
    handoffId: result.handoff.id ?? '',
    fromRole: 'supervisor',
    toRole: args.toRole,
    reason: args.reason,
    sceneNumbers: args.sceneNumbers,
    status: result.success ? 'completed' : 'failed',
  };
}

/**
 * 外科式 supervisor 决策落地入口（Task 4.4）：
 * - reconvertScenes → 经典链重转（Task 4.3 执行）→ supervisor→writer 手写交接；
 *   执行层判定 needs-manual（agent-task/unavailable 无经典写回目标）→ supervisor→validator 升级人工
 * - escalatedScenes（超 escalation 预算）→ 独立 supervisor→validator 升级人工
 * - 全程用 registry 状态迁移（supervisor busy → ... → idle）+ handoff 上下文链留痕
 */
export async function executeSurgicalReconvert(
  task: OrchestratorTask,
  decision: ReconvertDecision,
  options: SupervisorReconvertOptions,
): Promise<SurgicalReconvertResult> {
  const registry = options.registry ?? getAgentRegistry();
  const handoffManager = options.handoffManager ?? getHandoffManager();
  const handoffs: SurgicalReconvertHandoff[] = [];

  const supervisor = pickAgent(registry, 'supervisor');
  if (supervisor) registry.markBusy(supervisor.instanceId, task.id);

  try {
    let outcome: TaskReconvertOutcome | undefined;

    // 1) 可执行重转场景 → 经典链执行（Task 4.3 只重转这些场景）
    if (decision.reconvertScenes.length > 0) {
      outcome = await executeReconvertForTask(task, decision, options);

      if (outcome.status === 'reconverted') {
        handoffs.push(
          await performHandoff(handoffManager, registry, {
            taskId: task.id,
            fromInstanceId: supervisor?.instanceId,
            toRole: 'writer',
            reason: `身份外科式重转（场景 #${outcome.result.reconvertedSceneNumbers.join(', #')}）`,
            sceneNumbers: outcome.result.reconvertedSceneNumbers,
            contextSummary:
              `任务 ${task.id} 身份一致性未达标，外科式重转 ` +
              `${outcome.result.reconvertedSceneNumbers.length} 个场景；重跑身份断言 ` +
              `${outcome.result.identityAfter.passed ? '通过' : `仍失败 ${outcome.result.identityAfter.score}/100`}`,
            metadata: {
              decision: {
                reconvertScenes: decision.reconvertScenes,
                escalatedScenes: decision.escalatedScenes,
                shouldReconvert: decision.shouldReconvert,
                shouldEscalate: decision.shouldEscalate,
              },
              reconvertedSceneNumbers: outcome.result.reconvertedSceneNumbers,
              identityAfter: outcome.result.identityAfter,
            },
          }),
        );
      } else {
        // 无经典 job 可写回 → 升级人工
        handoffs.push(
          await performHandoff(handoffManager, registry, {
            taskId: task.id,
            fromInstanceId: supervisor?.instanceId,
            toRole: 'validator',
            reason: `身份不一致需人工介入：${outcome.reason}`,
            sceneNumbers: decision.reconvertScenes,
            contextSummary: `任务 ${task.id} 无经典 job 可写回，经典链重转不可用，升级人工介入。`,
            metadata: { decision, needsManual: outcome.reason },
          }),
        );
      }
    }

    // 2) 超 escalation 预算场景 → 独立升级人工（与重转解耦，即使已发出重转请求也照升）
    if (decision.escalatedScenes.length > 0) {
      handoffs.push(
        await performHandoff(handoffManager, registry, {
          taskId: task.id,
          fromInstanceId: supervisor?.instanceId,
          toRole: 'validator',
          reason: `场景 #${decision.escalatedScenes.join(', #')} 超出外科介入预算，升级人工`,
          sceneNumbers: decision.escalatedScenes,
          contextSummary: `任务 ${task.id} 场景 ${decision.escalatedScenes.join(', #')} 重转已达预算上限，升级人工介入。`,
          metadata: { decision, escalatedScenes: decision.escalatedScenes },
        }),
      );
    }

    return { outcome, handoffs };
  } finally {
    if (supervisor) registry.markIdle(supervisor.instanceId);
  }
}
