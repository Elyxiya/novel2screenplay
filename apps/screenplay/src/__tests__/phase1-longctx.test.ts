import { describe, it, expect, vi } from 'vitest';
import { Phase1Analyzer } from '@/lib/pipeline/Phase1Analyzer';
import { ContextManager } from '@/lib/pipeline/ContextManager';
import { resolvePhase1Mode, type Phase1BudgetController } from '@/lib/pipeline/phase1-budget';
import type { LLMProvider } from '@/lib/llm/types';

const chapters = [{ index: 0, title: '第一章 开端', text: '正文内容。'.repeat(30) }];

function mockProvider(over: Partial<LLMProvider> = {}): LLMProvider {
  return {
    name: 'test',
    modelId: 'test-model',
    description: 't',
    contextWindow: 32000,
    supportsJSONMode: () => true,
    estimateTokens: async (t: string) => Math.ceil(t.length * 0.5),
    chat: vi.fn(async () => ({
      model: 'test-model',
      content: JSON.stringify({ characters: [{ name: '林墨' }], locations: [], timelineHints: [] }),
    })),
    chatStream: async function* () {},
    ...over,
  };
}

describe('resolvePhase1Mode（B-01 三模式）', () => {
  it('显式参数优先于环境变量', () => {
    expect(resolvePhase1Mode('longctx', { PHASE1_MODE: 'mapreduce' })).toBe('longctx');
  });

  it('环境变量支持 truncate / mapreduce / longctx', () => {
    expect(resolvePhase1Mode(undefined, { PHASE1_MODE: 'longctx' })).toBe('longctx');
    expect(resolvePhase1Mode(undefined, { PHASE1_MODE: 'mapreduce' })).toBe('mapreduce');
    expect(resolvePhase1Mode(undefined, { PHASE1_MODE: 'truncate' })).toBe('truncate');
  });

  it('非法值/缺省 → 单点默认 truncate', () => {
    expect(resolvePhase1Mode(undefined, { PHASE1_MODE: 'bogus' })).toBe('truncate');
    expect(resolvePhase1Mode(undefined, {})).toBe('truncate');
    expect(resolvePhase1Mode()).toBe('truncate');
  });
});

describe('Phase1 longctx 路径', () => {
  it('窗口充足：不截断（truncateToTokens 零调用），全文进入 messages', async () => {
    const ctx = new ContextManager();
    const spy = vi.spyOn(ctx, 'truncateToTokens');
    const provider = mockProvider();
    const analyzer = new Phase1Analyzer(provider, ctx);

    const out = await analyzer.analyze(chapters, { mode: 'longctx' });

    expect(spy).not.toHaveBeenCalled();
    expect(out.characters[0]?.name).toBe('林墨');
    const messages = vi.mocked(provider.chat).mock.calls[0][0];
    expect(String(messages[1].content)).toContain('正文内容。');
  });

  it('窗口不足（>90%）→ 降级 truncate 路径', async () => {
    const ctx = new ContextManager();
    const spy = vi.spyOn(ctx, 'truncateToTokens');
    const provider = mockProvider({ contextWindow: 50 });
    const analyzer = new Phase1Analyzer(provider, ctx);

    const out = await analyzer.analyze(chapters, { mode: 'longctx' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(out.characters[0]?.name).toBe('林墨'); // 降级后仍完成分析
  });

  it('预算门拦截 longctx → 降级 truncate', async () => {
    const ctx = new ContextManager();
    const spy = vi.spyOn(ctx, 'truncateToTokens');
    const budget = {
      canCall: vi.fn((site: string) => site !== 'longctx'),
      blockedCount: 0,
      reset: () => {},
    } as unknown as Phase1BudgetController;
    const analyzer = new Phase1Analyzer(mockProvider(), ctx, budget);

    await analyzer.analyze(chapters, { mode: 'longctx' });

    expect(budget.canCall).toHaveBeenCalledWith('longctx', expect.anything());
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
