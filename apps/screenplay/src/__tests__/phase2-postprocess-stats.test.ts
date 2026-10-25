import { describe, it, expect } from 'vitest';
import { Phase2Segmenter, SHORT_SCENE_CHARS } from '@/lib/pipeline/Phase2Segmenter';
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
    postProcessStats: { mergedPairs: number; overlapFixes: number; shortMerged: number };
    mergeAdjacentScenes(scenes: SceneBoundary[]): SceneBoundary[];
    resolveOverlappingPerChapter(scenes: SceneBoundary[]): SceneBoundary[];
    mergeShortScenes(scenes: SceneBoundary[]): SceneBoundary[];
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

describe('Phase2 短场合并（P3-b · B 方案）', () => {
  it('阈值常量为 300（与离线重放结论一致）', () => {
    expect(SHORT_SCENE_CHARS).toBe(300);
  });

  it('单段落短场优先并入后场：区间扩展、摘要与角色名取并集、保留后场 slugline', () => {
    const conv = new Phase2Segmenter(mockProvider, new ContextManager());
    const priv = asPrivate(conv);

    const result = priv.mergeShortScenes([
      mkScene({
        sceneIndex: 1,
        startParagraph: 0,
        endParagraph: 0,
        originalStartOffset: 0,
        originalEndOffset: 80,
        summary: '短场',
        keyCharacterNames: ['林'],
      }),
      mkScene({
        sceneIndex: 2,
        startParagraph: 1,
        endParagraph: 4,
        originalStartOffset: 80,
        originalEndOffset: 900,
        draftSlugline: '外景. 街道 - 日',
        summary: '后场',
        keyCharacterNames: ['苏'],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sceneIndex: 1,
      startParagraph: 0,
      endParagraph: 4,
      originalStartOffset: 0,
      originalEndOffset: 900,
      draftSlugline: '外景. 街道 - 日',
      summary: '短场 | 后场',
    });
    expect(result[0].keyCharacterNames.sort()).toEqual(['林', '苏']);
    expect(priv.postProcessStats.shortMerged).toBe(1);
  });

  it('无后场时并入前场（仅同章）', () => {
    const conv = new Phase2Segmenter(mockProvider, new ContextManager());
    const priv = asPrivate(conv);

    const result = priv.mergeShortScenes([
      mkScene({ sceneIndex: 1, startParagraph: 0, endParagraph: 2, originalStartOffset: 0, originalEndOffset: 1000, summary: '前场' }),
      mkScene({ sceneIndex: 2, startParagraph: 3, endParagraph: 3, originalStartOffset: 1000, originalEndOffset: 1050, summary: '尾巴' }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      startParagraph: 0,
      endParagraph: 3,
      originalStartOffset: 0,
      originalEndOffset: 1050,
      summary: '前场 | 尾巴',
    });
    expect(priv.postProcessStats.shortMerged).toBe(1);
  });

  it('跨章不合并（章内坐标独立）', () => {
    const conv = new Phase2Segmenter(mockProvider, new ContextManager());
    const priv = asPrivate(conv);

    const result = priv.mergeShortScenes([
      mkScene({ sceneIndex: 1, chapterIndex: 0, startParagraph: 0, endParagraph: 0, originalStartOffset: 0, originalEndOffset: 50 }),
      mkScene({ sceneIndex: 2, chapterIndex: 1, startParagraph: 0, endParagraph: 0, originalStartOffset: 0, originalEndOffset: 50 }),
    ]);

    expect(result).toHaveLength(2);
    expect(priv.postProcessStats.shortMerged).toBe(0);
  });

  it('阈值边界：299 字并入、300 字不并入（严格小于）', () => {
    const build = (len: number) => {
      const conv = new Phase2Segmenter(mockProvider, new ContextManager());
      const priv = asPrivate(conv);
      const result = priv.mergeShortScenes([
        mkScene({ sceneIndex: 1, startParagraph: 0, endParagraph: 0, originalStartOffset: 0, originalEndOffset: len }),
        mkScene({ sceneIndex: 2, startParagraph: 1, endParagraph: 2, originalStartOffset: len, originalEndOffset: len + 500 }),
      ]);
      return { result, shortMerged: priv.postProcessStats.shortMerged };
    };

    expect(build(299).result).toHaveLength(1);
    expect(build(299).shortMerged).toBe(1);
    expect(build(300).result).toHaveLength(2);
    expect(build(300).shortMerged).toBe(0);
  });

  it('长单段落场景（≥ 阈值）不合并', () => {
    const conv = new Phase2Segmenter(mockProvider, new ContextManager());
    const priv = asPrivate(conv);

    const result = priv.mergeShortScenes([
      mkScene({ sceneIndex: 1, startParagraph: 0, endParagraph: 0, originalStartOffset: 0, originalEndOffset: 350 }),
      mkScene({ sceneIndex: 2, startParagraph: 1, endParagraph: 2, originalStartOffset: 350, originalEndOffset: 900 }),
    ]);

    expect(result).toHaveLength(2);
    expect(priv.postProcessStats.shortMerged).toBe(0);
  });

  it('合并后按全局顺序重排 sceneIndex', () => {
    const conv = new Phase2Segmenter(mockProvider, new ContextManager());
    const priv = asPrivate(conv);

    const result = priv.mergeShortScenes([
      mkScene({ sceneIndex: 1, chapterIndex: 0, startParagraph: 0, endParagraph: 0, originalStartOffset: 0, originalEndOffset: 40 }),
      mkScene({ sceneIndex: 2, chapterIndex: 0, startParagraph: 1, endParagraph: 2, originalStartOffset: 40, originalEndOffset: 800 }),
      mkScene({ sceneIndex: 3, chapterIndex: 1, startParagraph: 0, endParagraph: 0, originalStartOffset: 0, originalEndOffset: 60 }),
      mkScene({ sceneIndex: 4, chapterIndex: 1, startParagraph: 1, endParagraph: 3, originalStartOffset: 60, originalEndOffset: 900 }),
    ]);

    expect(result.map((s) => s.sceneIndex)).toEqual([1, 2]);
    expect(result.map((s) => s.chapterIndex)).toEqual([0, 1]);
    expect(priv.postProcessStats.shortMerged).toBe(2);
  });
});
