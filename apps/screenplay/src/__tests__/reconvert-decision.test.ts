/**
 * Reconvert 决策层（Task 4.2）单元测试
 *
 * 覆盖 makeReconvertDecision 纯决策逻辑：
 * - identity 通过 → 空决策 / 零请求
 * - identity 未达标 → 标记待重转场景（只决策不执行）
 * - escalation 预算 K（默认 3）：同一场景被请求重转达到 K 次 → 升级 manual_review
 * - 混合场景分流（部分重转 / 部分升级）
 * - 自定义预算 / 历史含升级记录
 */

import { describe, it, expect } from 'vitest';
import {
  makeReconvertDecision,
  countReconvertsForScene,
  EMPTY_RECONVERT_DECISION,
  type ReconvertRequest,
} from '@/lib/multi-agent/reconvert-decision';
import type { IdentitySignal } from '@/lib/multi-agent/handoff-protocol';

// ── helpers ───────────────────────────────────────────────────────────────────

function failingIdentity(sceneNumbers: number[]): IdentitySignal {
  return {
    passed: false,
    score: Math.max(0, 100 - sceneNumbers.length * 20),
    failures: sceneNumbers.map((sceneNumber) => ({
      ruleId: 'dead-character-no-speak',
      sceneNumber,
      message: `已死角色在场景 #${sceneNumber} 仍有对白`,
    })),
  };
}

const passingIdentity: IdentitySignal = { passed: true, score: 100, failures: [] };

function makeHistory(entries: Array<{ sceneNumbers: number[]; escalated?: boolean }>): ReconvertRequest[] {
  return entries.map((e, i) => ({
    taskId: 't1',
    sceneNumbers: e.sceneNumbers,
    reasons: e.sceneNumbers.map((sceneNumber) => ({
      ruleId: 'reveal-before-chapter',
      sceneNumber,
      message: `提前点名 #${sceneNumber}`,
    })),
    createdAt: i,
    escalated: e.escalated ?? false,
  }));
}

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe('makeReconvertDecision', () => {
  it('identity 通过 → 空决策、零请求', () => {
    const { decision, requests } = makeReconvertDecision('t1', passingIdentity, []);
    expect(decision).toEqual(EMPTY_RECONVERT_DECISION);
    expect(decision.shouldReconvert).toBe(false);
    expect(decision.shouldEscalate).toBe(false);
    expect(requests).toEqual([]);
  });

  it('identity 未达标 → 标记待重转场景（只决策不执行），请求 escalated=false', () => {
    const { decision, requests } = makeReconvertDecision('t1', failingIdentity([3]), []);
    expect(decision.shouldReconvert).toBe(true);
    expect(decision.shouldEscalate).toBe(false);
    expect(decision.reconvertScenes).toEqual([3]);
    expect(decision.escalatedScenes).toEqual([]);
    expect(decision.reasons).toHaveLength(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].sceneNumbers).toEqual([3]);
    expect(requests[0].escalated).toBe(false);
  });

  it('场景去重并按升序排列', () => {
    const { decision } = makeReconvertDecision('t1', failingIdentity([5, 2, 5, 2]), []);
    expect(decision.reconvertScenes).toEqual([2, 5]);
  });

  it('同一场景请求重转未达 K=3 时继续重转（累计 2 次仍重转）', () => {
    const history = makeHistory([{ sceneNumbers: [1] }, { sceneNumbers: [1] }]);
    const { decision } = makeReconvertDecision('t1', failingIdentity([1]), history);
    expect(decision.shouldReconvert).toBe(true);
    expect(decision.shouldEscalate).toBe(false);
  });

  it('同一场景请求重转达到 K=3 后第 4 次升级 manual_review（escalated=true）', () => {
    const history = makeHistory([
      { sceneNumbers: [1] },
      { sceneNumbers: [1] },
      { sceneNumbers: [1] },
    ]);
    const { decision, requests } = makeReconvertDecision('t1', failingIdentity([1]), history);
    expect(decision.shouldReconvert).toBe(false);
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.escalatedScenes).toEqual([1]);
    expect(decision.reconvertScenes).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].escalated).toBe(true);
    expect(requests[0].sceneNumbers).toEqual([1]);
  });

  it('混合场景分流：未超预算的标记重转，超预算的升级人工', () => {
    const history = makeHistory([
      { sceneNumbers: [1] },
      { sceneNumbers: [1] },
      { sceneNumbers: [1] }, // 场景 1 已重转 3 次 → 超预算
      { sceneNumbers: [2] }, // 场景 2 仅 1 次 → 未超
    ]);
    const { decision, requests } = makeReconvertDecision(
      't1',
      failingIdentity([1, 2]),
      history,
    );
    expect(decision.shouldReconvert).toBe(true);
    expect(decision.shouldEscalate).toBe(true);
    expect(decision.reconvertScenes).toEqual([2]);
    expect(decision.escalatedScenes).toEqual([1]);
    // 两类请求分开下发
    expect(requests).toHaveLength(2);
    const normal = requests.find((r) => !r.escalated);
    const escalated = requests.find((r) => r.escalated);
    expect(normal?.sceneNumbers).toEqual([2]);
    expect(escalated?.sceneNumbers).toEqual([1]);
  });

  it('自定义 escalation 预算（K=1）生效', () => {
    const history = makeHistory([{ sceneNumbers: [7] }]);
    const { decision } = makeReconvertDecision('t1', failingIdentity([7]), history, {
      maxEscalationsPerScene: 1,
    });
    expect(decision.shouldReconvert).toBe(false);
    expect(decision.shouldEscalate).toBe(true);
  });

  it('历史中的升级记录也计入次数（升级代表已尝试过）', () => {
    const history = makeHistory([
      { sceneNumbers: [1] },
      { sceneNumbers: [1] },
      { sceneNumbers: [1], escalated: true },
    ]);
    const { decision } = makeReconvertDecision('t1', failingIdentity([1]), history);
    expect(decision.shouldEscalate).toBe(true);
  });

  it('reasons 完整携带身份失败明细', () => {
    const identity = failingIdentity([2, 4]);
    const { decision } = makeReconvertDecision('t1', identity, []);
    expect(decision.reasons).toEqual(identity.failures);
  });
});

describe('countReconvertsForScene', () => {
  it('统计某场景被请求重转的总次数（含升级记录）', () => {
    const history = makeHistory([
      { sceneNumbers: [1, 2] },
      { sceneNumbers: [2] },
      { sceneNumbers: [2], escalated: true },
    ]);
    expect(countReconvertsForScene(history, 1)).toBe(1);
    expect(countReconvertsForScene(history, 2)).toBe(3);
    expect(countReconvertsForScene(history, 9)).toBe(0);
  });
});
