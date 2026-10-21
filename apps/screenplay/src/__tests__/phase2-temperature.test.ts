import { describe, it, expect } from 'vitest';
import { resolvePhase2Temperature } from '@/lib/pipeline/Phase2Segmenter';

/**
 * 温度是切分稳定性的直接来源。这里锁住「默认不变 + 非法值回退」，
 * 避免为了做实验而悄悄改了线上默认。
 */
describe('resolvePhase2Temperature', () => {
  it('未设置时默认 0.3（与历史行为一致）', () => {
    expect(resolvePhase2Temperature({})).toBe(0.3);
  });

  it('显式 0 是合法值（不是 falsy 回退）', () => {
    expect(resolvePhase2Temperature({ PHASE2_TEMPERATURE: '0' })).toBe(0);
  });

  it('支持小数', () => {
    expect(resolvePhase2Temperature({ PHASE2_TEMPERATURE: '0.7' })).toBe(0.7);
  });

  it('非法值回退默认（含越界）', () => {
    expect(resolvePhase2Temperature({ PHASE2_TEMPERATURE: 'abc' })).toBe(0.3);
    expect(resolvePhase2Temperature({ PHASE2_TEMPERATURE: '-1' })).toBe(0.3);
    expect(resolvePhase2Temperature({ PHASE2_TEMPERATURE: '9' })).toBe(0.3);
  });
});
