/**
 * 经典链重转桥接器（Task 4.3 执行层）
 *
 * orchestrator「只决策不执行」——本模块是身份外科式重转的**经典管线单场景执行路径**：
 *
 *   task.jobId → StoredJob.pipelineState
 *     → Task 3 组装器（Phase3SceneConverter + settingCard，主角常驻/滚动摘要/open-threads 注入）
 *     → 只重转 identity 失败的具体场景
 *     → 写回 pipelineState（phase3Output 按 sceneNumber 替换 + Phase4 重合并）
 *     → 重跑身份断言（复用 Task 2 确定性规则）验证修复
 *
 * 架构前提（spec §2.6 已核实）：orchestrator 与经典管线**不共享**组件，重转执行硬走经典
 * 链单场景路径，吃 Task 3 组装器，不用 orchestrator 的 executePhase。
 *
 * 数据链（Task 4.2b 已验证）：agent 独立任务不写经典 pipelineState；本模块统一经
 * `resolvePipelineState`（agent-pipeline-bridge）取产物——classic-job 直接写回；
 * agent-task / unavailable 无经典 job 可写回 → 返回 needs-manual（人工介入兜底）。
 */

import type { LLMProvider } from '../llm/types';
import type { Phase3Output } from '@novel/contracts/pipeline';
import { ContextManager } from '../pipeline/ContextManager';
import { Phase3SceneConverter } from '../pipeline/Phase3SceneConverter';
import { Phase4Merger } from '../pipeline/Phase4Merger';
import type { StoredJob } from '../store/job-store';
import { jobStore as defaultJobStore } from '../store/job-store';
import type { BudgetController } from '../llm/adapter/budget-controller';
import { getBudgetController } from '../llm/adapter/budget-controller';
import { runIdentityAssessment } from '../eval/identity-rules';
import type { IdentitySignal } from './handoff-protocol';
import { hasReconvertibleState, resolvePipelineState } from './agent-pipeline-bridge';
import type { OrchestratorTask } from './orchestrator';
import type { ReconvertDecision } from './reconvert-decision';

/** 重跑身份断言所需的人工标注（与 identity-rules 的 IdentityRuleData 注解同源） */
export interface IdentityAnnotations {
  deadCharacters: Array<{ name: string; deathChapter: number }>;
  reveals: Array<{ secretName: string; revealChapter: number }>;
  aliasIndex: Record<string, string>;
}

/** 桥接器对 JobStore 的最小依赖（测试可注入 fake，默认真实 jobStore 单例） */
export interface ReconvertJobStore {
  get(jobId: string): StoredJob | undefined;
  update(jobId: string, updater: (job: StoredJob) => StoredJob): void;
}

export interface ReconvertBridgeOptions {
  /** 重转所用的 LLM Provider（与 orchestrator 同 provider；重转走经典链自建 Phase3SceneConverter） */
  provider: LLMProvider;
  /** 人工标注（死亡/揭示章 + 别名索引），用于重转后重跑身份断言；缺省空标注 → 规则零误报全通过 */
  annotations?: Partial<IdentityAnnotations>;
  /** 可注入 JobStore（测试用），缺省走 jobStore 单例 */
  jobStore?: ReconvertJobStore;
  /** 可注入 ContextManager（测试用，避免加载 tiktoken）；缺省新建 */
  ctxManager?: ContextManager;
  /** 可注入 BudgetController；缺省全局单例 */
  budgetController?: BudgetController;
  abortSignal?: AbortSignal;
}

export interface ReconvertBridgeResult {
  success: boolean;
  jobId: string;
  /** 请求重转的场景号 */
  sceneNumbers: number[];
  /** 本次实际完成重转的场景号 */
  reconvertedSceneNumbers: number[];
  /** 重转前 phase3Output（对照/审计用） */
  previousPhase3: Phase3Output[];
  /** 重转后合并的 phase3Output（未重转场景原样保留） */
  newPhase3: Phase3Output[];
  /** Phase4 重合并的修正清单 */
  fixes: string[];
  /** 重转后重跑身份断言的信号 */
  identityAfter: IdentitySignal;
  error?: string;
}

const EMPTY_ANNOTATIONS: IdentityAnnotations = {
  deadCharacters: [],
  reveals: [],
  aliasIndex: {},
};

function failResult(
  jobId: string,
  sceneNumbers: number[],
  error: string,
): ReconvertBridgeResult {
  return {
    success: false,
    jobId,
    sceneNumbers,
    reconvertedSceneNumbers: [],
    previousPhase3: [],
    newPhase3: [],
    fixes: [],
    identityAfter: { passed: false, score: 0, failures: [] },
    error,
  };
}

/**
 * 经典链单场景重转（核心执行）：
 * 1. 经 jobId 取 StoredJob.pipelineState（hasReconvertibleState 校验可重转）
 * 2. 按 sceneNumbers 过滤 phase2 场景边界 → Phase3SceneConverter 只重转这些场景（吃 Task 3 组装器 settingCard）
 * 3. 合并回 phase3Output（按 sceneNumber 替换，未重转场景不动）
 * 4. Phase4 重合并出最终剧本（写回 pipelineState.phase4Output）
 * 5. 重跑身份断言（runIdentityAssessment），验证外科介入是否修复
 * 6. 写回 jobStore（pipelineState + 日志；恢复 convertScenes 触碰的进度展示字段）
 */
export async function reconvertClassicJobScenes(
  jobId: string,
  sceneNumbers: number[],
  options: ReconvertBridgeOptions,
): Promise<ReconvertBridgeResult> {
  const store = options.jobStore ?? defaultJobStore;
  const job = store.get(jobId);
  if (!job) {
    return failResult(jobId, sceneNumbers, `任务 ${jobId} 不存在`);
  }

  const state = job.pipelineState;
  if (!hasReconvertibleState(state)) {
    return failResult(
      jobId,
      sceneNumbers,
      'pipelineState 缺少可重转的结构化输入（phase1 实体 / phase2 场景边界）',
    );
  }

  const phase1 = state.phase1Output!;
  const phase2 = state.phase2Output!;
  const previousPhase3 = state.phase3Output ?? [];

  const targetScenes = phase2.scenes.filter((s) => sceneNumbers.includes(s.sceneIndex));
  if (targetScenes.length === 0) {
    return failResult(jobId, sceneNumbers, '指定的场景号在 phase2 场景边界中不存在');
  }

  // 经典链执行：Phase3SceneConverter + Task 3 组装器（settingCard 驱动主角常驻/滚动摘要/open-threads）
  const converter = new Phase3SceneConverter(
    options.provider,
    options.ctxManager ?? new ContextManager(),
    options.budgetController ?? getBudgetController(),
  );

  // convertScenes 会重置 subProgress/scenesStatus 为本次传入场景子集——快照并在写回时恢复
  const prevSubProgress = job.subProgress;
  const prevScenesStatus = job.scenesStatus;

  const results = await converter.convertScenes(
    targetScenes,
    phase1.characters,
    phase1.locations,
    job.chapterTexts,
    store as Parameters<typeof converter.convertScenes>[4],
    jobId,
    options.abortSignal,
    { settingCard: phase1.settingCard },
  );

  const reconvertedSceneNumbers = results.map((r) => r.sceneNumber);
  // 按 sceneNumber 合并：重转场景替换，未重转场景原样保留
  const newPhase3 = previousPhase3.map(
    (o) => results.find((r) => r.sceneNumber === o.sceneNumber) ?? o,
  );

  // Phase4 重合并（外科式重转后整体校验）
  const phase4 = new Phase4Merger();
  const { screenplay, fixes } = await phase4.merge(
    {
      title: job.config.title ?? '剧本',
      author: job.config.author ?? '',
      sourceNovel: job.config.title ?? '剧本',
    },
    phase1,
    phase2,
    newPhase3,
  );

  // 重跑身份断言：从合并后剧本构建 charIdToName，叠加人工标注
  const charIdToName: Record<string, string> = {};
  for (const c of screenplay.characters) {
    charIdToName[c.characterId] = c.name;
  }
  const annotations = { ...EMPTY_ANNOTATIONS, ...(options.annotations ?? {}) };
  const identityAfter = runIdentityAssessment({
    scenes: screenplay.scenes,
    charIdToName,
    deadCharacters: annotations.deadCharacters,
    reveals: annotations.reveals,
    aliasIndex: annotations.aliasIndex,
  });

  // 写回 pipelineState
  store.update(jobId, (j) => ({
    ...j,
    subProgress: prevSubProgress,
    scenesStatus: prevScenesStatus,
    status: 'completed',
    currentPhase: 4,
    pipelineState: {
      ...j.pipelineState,
      phase3Output: newPhase3,
      phase4Output: screenplay,
    },
    logs: [
      ...j.logs,
      {
        timestamp: Date.now(),
        level: 'info' as const,
        message:
          `外科式重转完成：场景 #${reconvertedSceneNumbers.join(', #')}（` +
          `重跑身份断言 ${identityAfter.passed ? '通过' : `仍失败 ${identityAfter.score}/100`}）`,
      },
    ],
  }));

  return {
    success: true,
    jobId,
    sceneNumbers,
    reconvertedSceneNumbers,
    previousPhase3,
    newPhase3,
    fixes,
    identityAfter,
  };
}

export type TaskReconvertOutcome =
  | { status: 'reconverted'; source: 'classic-job'; result: ReconvertBridgeResult }
  | {
      status: 'needs-manual';
      source: 'agent-task' | 'unavailable';
      reason: string;
    };

/**
 * orchestrator 决策的落地入口（4.4 supervisor / 前端消费 reconvert_decision 后调用）：
 * - classic-job（task.jobId 指向真实经典 job）→ 走 reconvertClassicJobScenes 执行并写回
 * - agent-task / unavailable（无经典 job 可写回）→ 经典链重转不可用 → 需人工介入
 */
export async function executeReconvertForTask(
  task: OrchestratorTask,
  decision: ReconvertDecision,
  options: ReconvertBridgeOptions,
): Promise<TaskReconvertOutcome> {
  const resolution = await resolvePipelineState(
    task,
    options.jobStore ? (id) => options.jobStore!.get(id) : undefined,
  );

  if (resolution.source === 'classic-job' && resolution.jobId) {
    const result = await reconvertClassicJobScenes(
      resolution.jobId,
      decision.reconvertScenes,
      options,
    );
    return { status: 'reconverted', source: 'classic-job', result };
  }

  return {
    status: 'needs-manual',
    source: resolution.source === 'unavailable' ? 'unavailable' : 'agent-task',
    reason:
      resolution.source === 'unavailable'
        ? '无可用 pipelineState（agent 产物与经典 job 均不可得），无法执行经典链重转，需人工介入'
        : 'agent 独立任务未关联经典 job，经典链重转无写回目标，需人工介入',
  };
}
