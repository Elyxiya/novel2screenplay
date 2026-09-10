import { describe, it, expect, vi } from 'vitest';
import { warnIfMultiInstance } from '@/lib/llm/adapter/budget-controller';

describe('预算单实例边界告警（FIX-06 / ADR-0001）', () => {
  it('INSTANCE_COUNT>1 → 告警一次并指向 ADR', () => {
    const warn = vi.fn();
    const warned = warnIfMultiInstance({ INSTANCE_COUNT: '3' }, warn);

    expect(warned).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('INSTANCE_COUNT=3');
    expect(message).toContain('单实例内存态');
    expect(message).toContain('docs/adr/0001-budget-accounting-scope.md');
  });

  it('缺省/为 1/非法值 → 不告警', () => {
    const warn = vi.fn();
    expect(warnIfMultiInstance({}, warn)).toBe(false);
    expect(warnIfMultiInstance({ INSTANCE_COUNT: '1' }, warn)).toBe(false);
    expect(warnIfMultiInstance({ INSTANCE_COUNT: 'abc' }, warn)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
