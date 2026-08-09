import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Phase3SceneConverter } from '@/lib/pipeline/Phase3SceneConverter';
import type { SceneBoundary } from '@/lib/pipeline/Phase2Segmenter';
import type { RawCharacter, RawLocation } from '@/lib/pipeline/Phase1Analyzer';
import type { LLMProvider } from '@/lib/llm/types';
import { ContextManager } from '@/lib/pipeline/ContextManager';

// ── Fixtures ──────────────────────────────────────────────────────────────

const characters: RawCharacter[] = [
  { name: '林墨', aliases: ['小林', '墨公子'], personalityTags: ['冷静'], description: '主角', isMajor: true, sourceChapterIndex: 0 },
  { name: '苏晚', aliases: ['晚儿'], personalityTags: ['温柔'], description: '女主', isMajor: true, sourceChapterIndex: 1 },
  { name: '老者', aliases: ['神秘人'], personalityTags: ['神秘'], description: '配角', isMajor: false, sourceChapterIndex: 2 },
  { name: '围观者甲', aliases: [], personalityTags: [], description: '路人', isMajor: false, sourceChapterIndex: 1 },
];

const locations: RawLocation[] = [
  { name: '青云山顶', type: 'exterior', description: '山顶', sourceChapterIndex: 0 },
  { name: '山腰草庐', type: 'interior', description: '草庐', sourceChapterIndex: 1 },
  { name: '地下密室', type: 'interior', description: '密室', sourceChapterIndex: 2 },
  { name: '通用广场', type: 'exterior', description: '广场', sourceChapterIndex: 1 },
];

const mockProvider: LLMProvider = {
  name: 'test',
  modelId: 'test-model',
  description: 'test',
  contextWindow: 32000,
  supportsJSONMode: () => true,
  estimateTokens: async (text: string) => Math.ceil(text.length * 0.5),
  chat: vi.fn().mockResolvedValue({ content: '{}' }),
  chatStream: vi.fn(),
};

const mockCtxManager = new ContextManager();

// Minimal jobStore mock with update tracking.
// Uses a wrapper object so tests always read the latest state.
function createMockJobStore() {
  const state: { current: Record<string, unknown> } = { current: {} };
  return {
    state,
    update: vi.fn((_id: string, updater: (j: Record<string, unknown>) => Record<string, unknown>) => {
      state.current = updater(state.current);
    }),
    get: vi.fn(() => state.current),
  };
}

// 类型化访问 Phase3SceneConverter 的私有方法（避免 as any 触发 no-explicit-any）
function asPrivate(c: Phase3SceneConverter) {
  return c as unknown as {
    buildCharIdMap(characters: RawCharacter[]): Map<string, string>;
    buildSceneContext(
      scene: SceneBoundary,
      characters: RawCharacter[],
      locations: RawLocation[],
      charIdMap: Map<string, string>,
    ): { chars: string; locs: string; charKept: number; charTotal: number; locKept: number; locTotal: number };
    recordUsage(
      jobStore: ReturnType<typeof createMockJobStore>,
      jobId: string,
      usage: { promptTokens?: number; completionTokens?: number },
      inputChars: number,
    ): void;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Phase3SceneConverter - buildSceneContext', () => {
  let converter: Phase3SceneConverter;

  beforeEach(() => {
    vi.clearAllMocks();
    converter = new Phase3SceneConverter(mockProvider, mockCtxManager);
  });

  it('should filter characters by keyCharacterNames (name match)', () => {
    const scene: SceneBoundary = {
      sceneIndex: 1,
      chapterIndex: 0,
      startParagraph: 0,
      endParagraph: 5,
      originalStartOffset: 0,
      originalEndOffset: 500,
      draftSlugline: '外景. 青云山顶 - 日',
      keyCharacterNames: ['林墨'],
      summary: '林墨在山顶',
    };

    const result = asPrivate(converter).buildSceneContext(scene, characters, locations, asPrivate(converter).buildCharIdMap(characters));

    expect(result.charKept).toBe(1);
    expect(result.charTotal).toBe(characters.length);
    expect(result.chars).toContain('林墨');
    expect(result.chars).not.toContain('苏晚');
  });

  it('should filter characters by alias match', () => {
    const scene: SceneBoundary = {
      sceneIndex: 2,
      chapterIndex: 1,
      startParagraph: 0,
      endParagraph: 3,
      originalStartOffset: 0,
      originalEndOffset: 300,
      draftSlugline: '内景. 山腰草庐 - 夜',
      keyCharacterNames: ['晚儿'], // alias of 苏晚
      summary: '苏晚在草庐',
    };

    const result = asPrivate(converter).buildSceneContext(scene, characters, locations, asPrivate(converter).buildCharIdMap(characters));

    // Should match 苏晚 via alias 晚儿
    expect(result.charKept).toBe(1);
    expect(result.chars).toContain('苏晚');
    expect(result.chars).not.toContain('林墨');
  });

  it('should match multiple characters via mixed name+alias', () => {
    const scene: SceneBoundary = {
      sceneIndex: 3,
      chapterIndex: 1,
      startParagraph: 0,
      endParagraph: 5,
      originalStartOffset: 0,
      originalEndOffset: 400,
      draftSlugline: '内景. 山腰草庐 - 日',
      keyCharacterNames: ['小林', '晚儿'], // aliases of 林墨 and 苏晚
      summary: '两人相遇',
    };

    const result = asPrivate(converter).buildSceneContext(scene, characters, locations, asPrivate(converter).buildCharIdMap(characters));

    expect(result.charKept).toBe(2);
    expect(result.chars).toContain('林墨');
    expect(result.chars).toContain('苏晚');
  });

  it('should filter locations by chapterIndex', () => {
    const scene: SceneBoundary = {
      sceneIndex: 1,
      chapterIndex: 0,
      startParagraph: 0,
      endParagraph: 5,
      originalStartOffset: 0,
      originalEndOffset: 500,
      draftSlugline: '外景. 青云山顶 - 日',
      keyCharacterNames: ['林墨'],
      summary: '林墨在山顶',
    };

    const result = asPrivate(converter).buildSceneContext(scene, characters, locations, asPrivate(converter).buildCharIdMap(characters));

    // Chapter 0 only has 青云山顶
    expect(result.locKept).toBe(1);
    expect(result.locTotal).toBe(locations.length);
    expect(result.locs).toContain('青云山顶');
    expect(result.locs).not.toContain('山腰草庐');
  });

  it('should fall back to full character list when filtering yields nothing', () => {
    const scene: SceneBoundary = {
      sceneIndex: 5,
      chapterIndex: 0,
      startParagraph: 0,
      endParagraph: 2,
      originalStartOffset: 0,
      originalEndOffset: 200,
      draftSlugline: '外景. 某处 - 日',
      keyCharacterNames: ['不存在的角色'],
      summary: '未知场景',
    };

    const result = asPrivate(converter).buildSceneContext(scene, characters, locations, asPrivate(converter).buildCharIdMap(characters));

    // No character matched → fallback to full list
    expect(result.charKept).toBe(0);
    expect(result.chars).toContain('林墨');
    expect(result.chars).toContain('苏晚');
    expect(result.chars).toContain('老者');
  });

  it('should fall back to full location list when no locations match chapterIndex', () => {
    const scene: SceneBoundary = {
      sceneIndex: 10,
      chapterIndex: 99, // no locations in this chapter
      startParagraph: 0,
      endParagraph: 2,
      originalStartOffset: 0,
      originalEndOffset: 200,
      draftSlugline: '外景. 某处 - 日',
      keyCharacterNames: ['林墨'],
      summary: '某处',
    };

    const result = asPrivate(converter).buildSceneContext(scene, characters, locations, asPrivate(converter).buildCharIdMap(characters));

    expect(result.locKept).toBe(0);
    expect(result.locs).toContain('青云山顶');
    expect(result.locs).toContain('山腰草庐');
    expect(result.locs).toContain('地下密室');
  });

  it('should handle empty keyCharacterNames gracefully', () => {
    const scene: SceneBoundary = {
      sceneIndex: 1,
      chapterIndex: 0,
      startParagraph: 0,
      endParagraph: 5,
      originalStartOffset: 0,
      originalEndOffset: 500,
      draftSlugline: '外景. 青云山顶 - 日',
      keyCharacterNames: [],
      summary: '空角色列表',
    };

    const result = asPrivate(converter).buildSceneContext(scene, characters, locations, asPrivate(converter).buildCharIdMap(characters));

    // Empty keyCharacterNames → no match → fallback to full list
    expect(result.charKept).toBe(0);
    expect(result.charTotal).toBe(characters.length);
  });

  it('should produce charIdMap with correct ID format', () => {
    const charIdMap = asPrivate(converter).buildCharIdMap(characters);

    expect(charIdMap.get('林墨')).toBe('char_01');
    expect(charIdMap.get('小林')).toBe('char_01'); // alias
    expect(charIdMap.get('墨公子')).toBe('char_01'); // alias
    expect(charIdMap.get('苏晚')).toBe('char_02');
    expect(charIdMap.get('晚儿')).toBe('char_02'); // alias
  });
});

describe('Phase3SceneConverter - recordUsage', () => {
  let converter: Phase3SceneConverter;
  let mockJobStore: ReturnType<typeof createMockJobStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    converter = new Phase3SceneConverter(mockProvider, mockCtxManager);
    mockJobStore = createMockJobStore();
    // Initialize with empty metadata
    mockJobStore.state.current = { id: 'job-1', metadata: {} };
  });

  it('should accumulate promptTokens and completionTokens', () => {
    asPrivate(converter).recordUsage(mockJobStore, 'job-1', { promptTokens: 100, completionTokens: 50 }, 500);
    asPrivate(converter).recordUsage(mockJobStore, 'job-1', { promptTokens: 200, completionTokens: 80 }, 800);

    const meta = mockJobStore.state.current.metadata as { usage: { promptTokens: number; completionTokens: number; inputChars: number; calls: number } };
    expect(meta.usage.promptTokens).toBe(300);
    expect(meta.usage.completionTokens).toBe(130);
    expect(meta.usage.inputChars).toBe(1300);
    expect(meta.usage.calls).toBe(2);
  });

  it('should handle missing usage fields gracefully', () => {
    // Only promptTokens provided, completionTokens missing → should default to 0
    asPrivate(converter).recordUsage(mockJobStore, 'job-1', { promptTokens: 100 }, 500);

    const meta = mockJobStore.state.current.metadata as { usage: { promptTokens: number; completionTokens: number; inputChars: number; calls: number } };
    expect(meta.usage.promptTokens).toBe(100);
    expect(meta.usage.completionTokens).toBe(0);
    expect(meta.usage.calls).toBe(1);
  });

  it('should skip when both promptTokens and completionTokens are absent', () => {
    asPrivate(converter).recordUsage(mockJobStore, 'job-1', { promptTokens: 0, completionTokens: 0 }, 500);

    const meta = mockJobStore.state.current.metadata as { usage: { promptTokens: number; completionTokens: number; inputChars: number; calls: number } };
    // Both are 0 → early return, no usage recorded
    expect(meta.usage).toBeUndefined();
  });

  it('should handle missing metadata on job', () => {
    mockJobStore.state.current = { id: 'job-1' }; // no metadata field

    asPrivate(converter).recordUsage(mockJobStore, 'job-1', { promptTokens: 100, completionTokens: 50 }, 500);

    const meta = mockJobStore.state.current.metadata as { usage: { promptTokens: number; completionTokens: number; inputChars: number; calls: number } };
    expect(meta.usage.promptTokens).toBe(100);
    expect(meta.usage.completionTokens).toBe(50);
  });
});
