/**
 * Reconvert 决策层（Task 4.2）
 *
 * orchestrator「只决策不执行」的 identity 重转决策：
 * - identity 未达标 → 发 re-convert 请求（只标记场景，不执行转换）
 * - 单场景 escalation 预算 K（默认 3）：同一场景被请求重转达到 K 次仍未解决 → 升级 manual_review
 * - 实际执行交给经典链重转桥接器（Task 4.3），本模块零执行副作用（纯函数）
 */

import type { IdentityFailure, IdentitySignal } from './handoff-protocol';

/** re-convert 请求（只标记目标场景，供 Task 4.3 执行层消费） */
export interface ReconvertRequest {
  taskId: string;
  /** 目标场景号（去重、升序） */
  sceneNumbers: number[];
  /** 触发原因（identity 规则失败明细） */
  reasons: IdentityFailure[];
  createdAt: number;
  /** 是否已升级人工介入（超出 escalation 预算；此请求不供自动执行） */
  escalated: boolean;
}

/** 一次 identity 未达标后的决策结果 */
export interface ReconvertDecision {
  /** 待外科式重转的场景（未超预算） */
  reconvertScenes: number[];
  /** 超预算需升级人工介入的场景 */
  escalatedScenes: number[];
  /** 是否发出可执行重转请求 */
  shouldReconvert: boolean;
  /** 是否需要升级人工介入 */
  shouldEscalate: boolean;
  /** 全部身份失败明细（携带具体场景与规则） */
  reasons: IdentityFailure[];
}

export interface ReconvertOptions {
  /** 单场景最多被请求重转次数（默认 3，超之升级人工） */
  maxEscalationsPerScene?: number;
}

export const DEFAULT_MAX_ESCALATIONS_PER_SCENE = 3;

/** 空决策（identity 通过 / flag 关闭时返回，保持主链零变化） */
export const EMPTY_RECONVERT_DECISION: ReconvertDecision = {
  reconvertScenes: [],
  escalatedScenes: [],
  shouldReconvert: false,
  shouldEscalate: false,
  reasons: [],
};

/**
 * 统计某场景此前被请求重转的次数（含已升级记录——升级也代表已尝试过）。
 */
export function countReconvertsForScene(
  history: ReconvertRequest[],
  sceneNumber: number,
): number {
  return history.filter((r) => r.sceneNumbers.includes(sceneNumber)).length;
}

/**
 * 决策：identity 未达标 → 按 escalation 预算分流「重转 / 升级人工」。
 * - 返回 decision（供 orchestrator 路由）与 requests（待 4.3 执行 / 审计记录）。
 * - identity 通过 → 空决策、零请求。
 */
export function makeReconvertDecision(
  taskId: string,
  identity: IdentitySignal,
  history: ReconvertRequest[],
  options: ReconvertOptions = {},
): { decision: ReconvertDecision; requests: ReconvertRequest[] } {
  const maxEscalations = options.maxEscalationsPerScene ?? DEFAULT_MAX_ESCALATIONS_PER_SCENE;
  if (identity.passed) {
    return { decision: EMPTY_RECONVERT_DECISION, requests: [] };
  }

  const sceneNumbers = [...new Set(identity.failures.map((f) => f.sceneNumber))].sort(
    (a, b) => a - b,
  );
  const reasons: IdentityFailure[] = identity.failures;

  const reconvertScenes: number[] = [];
  const escalatedScenes: number[] = [];
  for (const sn of sceneNumbers) {
    if (countReconvertsForScene(history, sn) >= maxEscalations) {
      escalatedScenes.push(sn);
    } else {
      reconvertScenes.push(sn);
    }
  }

  const decision: ReconvertDecision = {
    reconvertScenes,
    escalatedScenes,
    shouldReconvert: reconvertScenes.length > 0,
    shouldEscalate: escalatedScenes.length > 0,
    reasons,
  };

  const now = Date.now();
  const requests: ReconvertRequest[] = [];
  if (reconvertScenes.length > 0) {
    requests.push({ taskId, sceneNumbers: reconvertScenes, reasons, createdAt: now, escalated: false });
  }
  if (escalatedScenes.length > 0) {
    requests.push({ taskId, sceneNumbers: escalatedScenes, reasons, createdAt: now, escalated: true });
  }
  return { decision, requests };
}
