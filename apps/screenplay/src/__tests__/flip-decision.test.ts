/**
 * Phase1 翻默认决策规则（flip-decision.ts）单元测试
 *
 * 覆盖口径：
 * - R1：无 judge 复跑方差（Δ_tail 未填充）→ 不翻默认
 * - R2：尾段差落进噪声带（< Δ_tail）→ 不翻
 * - R3：满足"尾段差 ≥ Δ_tail 且 总分不劣"才翻；任一不满足不翻
 * - 边界：尾段差恰等于 Δ_tail（≥ 含等）→ 允许翻
 */

import { describe, it, expect } from 'vitest';
import { decidePhase1Flip } from '@/lib/eval/flip-decision';

describe('decidePhase1Flip', () => {
  it('R1：Δ_tail 未填充（null）→ 不翻默认，理由含缺数据', () => {
    const d = decidePhase1Flip({ tailDropPct: 20, totalNotWorse: true, deltaTail: null });
    expect(d.flip).toBe(false);
    expect(d.reasons.join(' ')).toContain('R1');
    expect(d.evaluatedRules.length).toBeGreaterThanOrEqual(1);
  });

  it('R1：Δ_tail 未填充（undefined）→ 不翻默认', () => {
    const d = decidePhase1Flip({ tailDropPct: 20, totalNotWorse: true, deltaTail: undefined });
    expect(d.flip).toBe(false);
  });

  it('R1：Δ_tail 非有限数（NaN/Infinity）→ 视为未就绪，不翻默认', () => {
    expect(decidePhase1Flip({ tailDropPct: 20, totalNotWorse: true, deltaTail: Number.NaN }).flip).toBe(false);
    expect(decidePhase1Flip({ tailDropPct: 20, totalNotWorse: true, deltaTail: Number.POSITIVE_INFINITY }).flip).toBe(false);
  });

  it('R3 满足：尾段差 ≥ Δ_tail 且 总分不劣 → 翻默认', () => {
    const d = decidePhase1Flip({ tailDropPct: 18, totalNotWorse: true, deltaTail: 12 });
    expect(d.flip).toBe(true);
    expect(d.reasons.join(' ')).toContain('R3');
  });

  it('R3 满足（边界）：尾段差恰等于 Δ_tail → 翻默认（≥ 含等）', () => {
    const d = decidePhase1Flip({ tailDropPct: 12, totalNotWorse: true, deltaTail: 12 });
    expect(d.flip).toBe(true);
  });

  it('R2：尾段差 < Δ_tail → 不翻（差值落噪声带，无法裁决）', () => {
    const d = decidePhase1Flip({ tailDropPct: 5, totalNotWorse: true, deltaTail: 12 });
    expect(d.flip).toBe(false);
    expect(d.reasons.join(' ')).toContain('R2');
  });

  it('R3：总分劣化 → 即使尾段达标也不翻', () => {
    const d = decidePhase1Flip({ tailDropPct: 18, totalNotWorse: false, deltaTail: 12 });
    expect(d.flip).toBe(false);
    expect(d.reasons.join(' ')).toContain('总分劣化');
  });

  it('R3：尾段差不足 且 总分劣化 → 双原因均落，不翻', () => {
    const d = decidePhase1Flip({ tailDropPct: 3, totalNotWorse: false, deltaTail: 12 });
    expect(d.flip).toBe(false);
    expect(d.reasons.length).toBe(2);
  });

  it('Δ_tail=0 且尾段差 0 → 边界：0 ≥ 0 且不劣 → 允许翻（阈值被推平）', () => {
    const d = decidePhase1Flip({ tailDropPct: 0, totalNotWorse: true, deltaTail: 0 });
    expect(d.flip).toBe(true);
  });
});