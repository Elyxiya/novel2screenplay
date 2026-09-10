import { describe, it, expect } from 'vitest';
import { Phase2Segmenter } from '@/lib/pipeline/Phase2Segmenter';
import { ContextManager } from '@/lib/pipeline/ContextManager';
import type { SceneBoundary } from '@novel/contracts/pipeline';
import type { LLMProvider } from '@/lib/llm/types';

const mockProvider: LLMProvider = {
  name: 'test',
  modelId: 'test-model',
  description: 'test',
  contextWindow: 32000,
  supportsJSONMode: () => true,
  estimateTokens: async (text: string) => Math.ceil(text.length * 0.5),
  chat: async () => ({ content: '[]', model: 'test-model' }),
  chatStream: async function* () {},
};

/** 私有成员类型化访问（沿用 Phase3 测试的 asPrivate 模式） */
function asPrivate(c: Phase2Segmenter) {
  return c as unknown as {
    postProcessStats: { mergedPairs: number; overlapFixes: number };
    mergeAdjacentScenes(scenes: SceneBoundary[]): SceneBoundary[];
    resolveOverlappingPerChapter(scenes: SceneBoundary[]): SceneBoundary[];
  };
}

function mkScene(over: Partial<SceneBoundary> & Pick<SceneBoundary, 'sceneIndex' | 'originalStartOffset' | 'originalEndOffset'>): SceneBoundary {
  return {
    chapterIndex: 0,
    startParagraph: 0,
    endParagraph: 0,
    draftSlugline: '内景. 客厅 - 夜',
    keyCharacterNames: [],
    summary: '',
    ...over,
  } as SceneBoundary;
}

describe('Phase2 后处理事件计数（FIX-03）', () => {
  it('可合并的短场景对 → mergedPairs 计数且并入一条', () => {
    const conv = new Phase2Segmenter(mockProvider, new ContextManager());
    const priv = asPrivate(conv);

    const result = priv.mergeAdjacentScenes([
      mkScene({ sceneIndex: 1, originalStartOffset: 0, originalEndOffset: 500 }),
      mkScene({ sceneIndex: 2, originalStartOffset: 500, originalEndOffset: 900 }),
      mkScene({ sceneIndex: 3, originalStartOffset: 900, originalEndOffset: 2000, draftSlugline: '外景. 街道 - 日' }),
    ]);

    expect(result).toHaveLength(2);
    expect(priv.postProcessStats.mergedPairs).toBe(1);
    // 合并后场景索引重排
    expect(result.map((s) => s.sceneIndex)).toEqual([1, 2]);
  });

  it('不同地点/时间的短场景不合并 → 计数保持 0', () => {
    const conv = new Phase2Segmenter(mockProvider, new ContextManager());
    const priv = asPrivate(conv);

    const result = priv.mergeAdjacentScenes([
      mkScene({ sceneIndex: 1, originalStartOffset: 0, originalEndOffset: 500 }),
      mkScene({ sceneIndex: 2, originalStartOffset: 500, originalEndOffset: 900, draftSlugline: '外景. 街道 - 日' }),
    ]);

    expect(result).toHaveLength(2);
    expect(priv.postProcessStats.mergedPairs).toBe(0);
  });

  it('重叠修正：部分重叠计 1 次、完全覆盖再计 1 次（同章局部处理）', () => {
    const conv = new Phase2Segmenter(mockProvider, new ContextManager());
    const priv = asPrivate(conv);

    const result = priv.resolveOverlappingPerChapter([
      mkScene({ sceneIndex: 1, originalStartOffset: 0, originalEndOffset: 1000 }),
      mkScene({ sceneIndex: 2, originalStartOffset: 500, originalEndOffset: 1500 }),
      mkScene({ sceneIndex: 3, originalStartOffset: 200, originalEndOffset: 800 }),
    ]);

    expect(result).toHaveLength(2); // 场景 3 被完全覆盖丢弃
    expect(priv.postProcessStats.overlapFixes).toBe(2);
    expect(result.map((s) => s.sceneIndex)).toEqual([1, 2]);
  });

  it('跨章不误判重叠（章间 offset 各自从 0 起）', () => {
    const conv = new Phase2Segmenter(mockProvider, new ContextManager());
    const priv = asPrivate(conv);

    const result = priv.resolveOverlappingPerChapter([
      mkScene({ sceneIndex: 1, chapterIndex: 0, originalStartOffset: 0, originalEndOffset: 1000 }),
      mkScene({ sceneIndex: 2, chapterIndex: 1, originalStartOffset: 0, originalEndOffset: 800 }),
    ]);

    expect(result).toHaveLength(2);
    expect(priv.postProcessStats.overlapFixes).toBe(0);
  });
});
