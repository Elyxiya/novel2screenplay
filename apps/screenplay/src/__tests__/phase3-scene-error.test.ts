import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Phase3SceneConverter } from '@/lib/pipeline/Phase3SceneConverter';
import { ContextManager } from '@/lib/pipeline/ContextManager';
import { BudgetController } from '@/lib/llm/adapter/budget-controller';
import type { SceneBoundary, RawCharacter } from '@novel/contracts/pipeline';
import type { LLMProvider } from '@/lib/llm/types';
import type { JobStore } from '@/lib/store/job-store';

function mockChatProvider(impl: LLMProvider['chat']): LLMProvider {
  return {
    name: 'test',
    modelId: 'test-model',
    description: 'test',
    contextWindow: 32000,
    supportsJSONMode: () => true,
    estimateTokens: async (text: string) => Math.ceil(text.length * 0.5),
    chat: vi.fn(impl),
    chatStream: async function* () {},
  };
}

function createMockJobStore() {
  const state: { current: Record<string, unknown> } = { current: { id: 'job-1', logs: [], scenesStatus: [] } };
  return {
    state,
    update: vi.fn((_id: string, updater: (j: Record<string, unknown>) => Record<string, unknown>) => {
      state.current = updater(state.current);
    }),
    get: vi.fn(() => state.current),
  };
}

function asJobStore(m: ReturnType<typeof createMockJobStore>): JobStore {
  return m as unknown as JobStore;
}

const scene: SceneBoundary = {
  sceneIndex: 1,
  chapterIndex: 0,
  startParagraph: 0,
  endParagraph: 3,
  originalStartOffset: 0,
  originalEndOffset: 200,
  draftSlugline: '外景. 青云山顶 - 日',
  keyCharacterNames: ['林墨'],
  summary: '林墨在山顶',
};

const characters: RawCharacter[] = [
  { name: '林墨', aliases: [], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 0 },
];

describe('Phase3 场景级失败明细（FIX-03/FIX-22）', () => {
  let mockJobStore: ReturnType<typeof createMockJobStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockJobStore = createMockJobStore();
  });

  it('重试耗尽 → 降级场景携带 error.code/message/attempts', async () => {
    // 把重试退避（1s/2s）压到 0ms：spy 替换 setTimeout，不影响 Promise 语义
    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      ((fn: () => void) => realSetTimeout(fn, 0)) as unknown as typeof setTimeout,
    );
    try {
      const provider = mockChatProvider(() => Promise.reject(new Error('boom')));
      const conv = new Phase3SceneConverter(provider, new ContextManager());

      const results = await conv.convertScenes(
        [scene], characters, [], ['第一章文本'], asJobStore(mockJobStore), 'job-1',
      );

      expect(vi.mocked(provider.chat)).toHaveBeenCalledTimes(3);
      expect(results[0].confidence).toBe(0.1);
      expect(results[0].error).toBeDefined();
      expect(results[0].error?.code).toBe('internal');
      expect(results[0].error?.message).toContain('转换失败: boom');
      expect(results[0].error?.attempts).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('预算拦截 → error.code=budget_blocked（不调用 LLM）', async () => {
    const provider = mockChatProvider(async () => ({ content: '{}', model: 'test-model' }));
    const tinyBudget = new BudgetController({ minuteLimit: 1e-9, hourlyLimit: 1e-9, monthlyLimit: 1e-9 });
    const conv = new Phase3SceneConverter(provider, new ContextManager(), tinyBudget);

    const results = await conv.convertScenes(
      [scene], characters, [], ['第一章文本'], asJobStore(mockJobStore), 'job-1',
    );

    expect(vi.mocked(provider.chat)).not.toHaveBeenCalled();
    expect(results[0].error?.code).toBe('budget_blocked');
    expect(results[0].error?.message).toContain('预算超限');
    expect(results[0].error?.attempts).toBeUndefined();
  });

  it('正常转换 → 无 error 字段（不污染成功产物）', async () => {
    const provider = mockChatProvider(async () => ({
      model: 'test-model',
      content: JSON.stringify({
        summary: '测试',
        timeOfDay: 'day',
        confidence: 0.9,
        content: [{ type: 'action', description: '他抬头。', sourceRefs: [] }],
      }),
    }));
    const conv = new Phase3SceneConverter(provider, new ContextManager());

    const results = await conv.convertScenes(
      [scene], characters, [], ['第一章文本'], asJobStore(mockJobStore), 'job-1',
    );

    expect(results[0].confidence).toBeGreaterThan(0.5);
    expect(results[0].error).toBeUndefined();
  });
});
