import { describe, it, expect, vi } from 'vitest';
import { BudgetController } from '@/lib/llm/adapter/budget-controller';
import {
  createPhase1Budget,
  decideAutoMode,
  resolveDefaultPhase1Mode,
  resolvePhase1Mode,
  estimateMapPromptTokens,
  estimateReducePromptTokens,
} from '@/lib/pipeline/phase1-budget';

/** 造一个预算超限的 BudgetController（月度限制极小，一次较大调用即超支） */
function exhaustedBudget(): BudgetController {
  return new BudgetController({ monthlyLimit: 0.000001 });
}

describe('createPhase1Budget', () => {
  it('未启用守卫（enabled=false）→ 一律放行，零影响、不触发 onBlocked', () => {
    const onBlocked = vi.fn();
    const guard = createPhase1Budget({ budget: exhaustedBudget(), modelId: 'm', enabled: false, onBlocked });
    expect(guard.canCall('map', { promptTokens: 1e6, completionTokens: 1e6, totalTokens: 2e6 })).toBe(true);
    expect(guard.blockedCount).toBe(0);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('启用但无 modelId → 无法折算成本，判放行（不误伤）', () => {
    const guard = createPhase1Budget({ budget: exhaustedBudget(), enabled: true });
    expect(guard.canCall('reduce', { promptTokens: 1e6, completionTokens: 1e6, totalTokens: 2e6 })).toBe(true);
  });

  it('启用 + modelId + 预算超限 → 拦截、计数、触发 onBlocked(site, reason)', () => {
    const onBlocked = vi.fn();
    const guard = createPhase1Budget({ budget: exhaustedBudget(), modelId: 'm', enabled: true, onBlocked });
    const allowed = guard.canCall('map', { promptTokens: 1e6, completionTokens: 1e6, totalTokens: 2e6 });
    expect(allowed).toBe(false);
    expect(guard.blockedCount).toBe(1);
    expect(onBlocked).toHaveBeenCalledWith('map', expect.any(String));
  });

  it('启用 + modelId + 预算充足 → 放行不计费', () => {
    const guard = createPhase1Budget({ budget: new BudgetController({ monthlyLimit: 100 }), modelId: 'm', enabled: true });
    expect(guard.canCall('truncate', { promptTokens: 1000, completionTokens: 1000, totalTokens: 2000 })).toBe(true);
    expect(guard.blockedCount).toBe(0);
  });

  it('reset() 清零拦截计数', () => {
    const guard = createPhase1Budget({ budget: exhaustedBudget(), modelId: 'm', enabled: true });
    guard.canCall('map', { promptTokens: 1e6, completionTokens: 1e6, totalTokens: 2e6 });
    expect(guard.blockedCount).toBe(1);
    guard.reset();
    expect(guard.blockedCount).toBe(0);
  });
});

describe('resolveDefaultPhase1Mode', () => {
  it('2026-10-21 起默认翻到 auto（短文仍走 truncate），偏离理由见 flip 记录 §7', () => {
    expect(resolveDefaultPhase1Mode()).toBe('auto');
  });
});

describe('auto 分流', () => {
  it('未超上限 → truncate；超上限 → mapreduce（边界取 >）', () => {
    expect(decideAutoMode(29999, 30000)).toBe('truncate');
    expect(decideAutoMode(30000, 30000)).toBe('truncate');
    expect(decideAutoMode(30001, 30000)).toBe('mapreduce');
  });

  it('env PHASE1_MODE=auto 可解析；空 env 时用默认 auto', () => {
    expect(resolvePhase1Mode(undefined, { PHASE1_MODE: 'auto' })).toBe('auto');
    expect(resolvePhase1Mode(undefined, {})).toBe('auto');
  });

  it('显式 mode 优先于 env', () => {
    expect(resolvePhase1Mode('truncate', { PHASE1_MODE: 'auto' })).toBe('truncate');
  });
});

describe('token 预估', () => {
  it('estimateMapPromptTokens 包含正文字符与模板余量', () => {
    const est = estimateMapPromptTokens('a'.repeat(1000));
    expect(est).toBeGreaterThan(1000 * 1.3);
  });

  it('estimateReducePromptTokens 随清单长度增长', () => {
    expect(estimateReducePromptTokens('x'.repeat(100))).toBeLessThan(estimateReducePromptTokens('x'.repeat(1000)));
  });
});