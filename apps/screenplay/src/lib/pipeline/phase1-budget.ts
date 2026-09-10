/**
 * Phase1 预算守卫 + 默认模式决策点（Task 5：翻默认）
 *
 * 目的：把 `canRequest`（BudgetController）接到 Phase1 调用点——真实成本尖峰是
 * map-reduce 本身（全书 N 章各一次调用），翻默认后若无守卫即为无守卫窗口。
 *
 * 职责分离：
 *  - `BudgetController.canRequest` 负责按成本预算判「能否发请求」；
 *  - 本模块负责在每次 Phase1 LLM 调用前查 `canRequest`，超限则优雅降级
 *    （跳过该次调用并计数，不静默崩管线），与 Phase3 `recordBudgetBlocked` 语义一致。
 *
 * 翻默认纪律（对应 flip-decision.ts 的 R1/R2/R3）：
 *  默认模式由 `resolveDefaultPhase1Mode()` 单一决策点给出。数据门槛未过
 *  （Task 2.4《judge 稳定性报告》/ Task 2.5 分层曲线未出数）前保持 `truncate`；
 *  翻默认 = 把该函数改为返回 `mapreduce`（配合本守卫 + Task 5.3 决策记录），
 *  不靠随手改 env。
 */

import { BudgetController, getBudgetController } from '../llm/adapter/budget-controller';

export type Phase1Mode = 'truncate' | 'mapreduce' | 'longctx';

export type Phase1CallSite = 'map' | 'reduce' | 'truncate' | 'longctx';

export interface TokenEstimate {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Phase1BudgetOptions {
  /** 预算控制器（缺省全局单例）。 */
  budget?: BudgetController;
  /** 模型 id（缺省由调用方绑定 provider.modelId）。 */
  modelId?: string;
  /** 守卫开关。翻默认后为 true；缺省 false —— 保持现状零影响。 */
  enabled?: boolean;
  /** 预算超限回调（供 caller 记录 jobStore.metadata.budgetBlocked / 日志）。 */
  onBlocked?: (site: Phase1CallSite, reason?: string) => void;
}

export interface Phase1BudgetController {
  /** 调用前守卫：返回 false = 预算超限应降级跳过；未启用/无模型 id 视为放行。 */
  canCall(site: Phase1CallSite, usage: TokenEstimate): boolean;
  readonly blockedCount: number;
  reset(): void;
}

export function createPhase1Budget(options: Phase1BudgetOptions = {}): Phase1BudgetController {
  const budget = options.budget ?? getBudgetController();
  const modelId = options.modelId ?? '';
  const enabled = options.enabled ?? false;
  let blockedCount = 0;

  return {
    canCall(site, usage) {
      // 未启用守卫 → 零影响（现状）；无模型 id 无法折算成本 → 不误伤判放行
      if (!enabled || !modelId) return true;
      const check = budget.canRequest(modelId, usage);
      if (!check.allowed) {
        blockedCount++;
        options.onBlocked?.(site, check.reason);
        return false;
      }
      return true;
    },
    get blockedCount() {
      return blockedCount;
    },
    reset() {
      blockedCount = 0;
    },
  };
}

/** map 单次抽取输入 token 预估（正文按 ~1.3 字/token + system/user 模板余量）。 */
export function estimateMapPromptTokens(text: string): number {
  return Math.ceil(text.length * 1.3) + 400;
}

/** reduce 合并决策输入 token 预估（角色清单 ~1.3 字/token + 模板余量）。 */
export function estimateReducePromptTokens(listing: string): number {
  return Math.ceil(listing.length * 1.3) + 400;
}

/**
 * Phase1 默认模式单一决策点（翻默认的开关）。
 *
 * 触发门槛 = data（Tail 2.4/2.5），出数后由 `decidePhase1Flip` 判定通过才在此翻；
 * 数据未出前保持 `truncate`（**不许**在未过门槛时切）。翻默认时为 `mapreduce`，
 * 且必须已接 canRequest 守卫（本文件）堵住无守卫窗口。
 */
export function resolveDefaultPhase1Mode(): Phase1Mode {
  return 'truncate';
}

/**
 * 解析有效 Phase1 模式（B-01 三模式）：
 *  显式 options.mode > 环境变量 PHASE1_MODE（truncate/mapreduce/longctx）> 单点默认（truncate）。
 * longctx = 长上下文单次分析（不截断，依赖大窗口模型）；仅作实验/评估路径，
 * 不改变默认（翻默认仍由 resolveDefaultPhase1Mode 单一决策点把守）。
 */
export function resolvePhase1Mode(
  explicit?: Phase1Mode,
  env: Record<string, string | undefined> = process.env,
): Phase1Mode {
  if (explicit) return explicit;
  const envMode = env.PHASE1_MODE;
  if (envMode === 'truncate' || envMode === 'mapreduce' || envMode === 'longctx') return envMode;
  return resolveDefaultPhase1Mode();
}