import { describe, it, expect } from 'vitest';
import { Phase3SceneConverter } from '@/lib/pipeline/Phase3SceneConverter';
import { ContextManager } from '@/lib/pipeline/ContextManager';
import { resolveCardView, isTrueNameAllowedAt } from '@/lib/pipeline/phase3-context';
import type { RawCharacter, SceneBoundary, SettingCard } from '@novel/contracts/pipeline';
import type { LLMProvider } from '@/lib/llm/types';

const mockProvider: LLMProvider = {
  name: 'test',
  modelId: 'test-model',
  description: 't',
  contextWindow: 32000,
  supportsJSONMode: () => true,
  estimateTokens: async (t: string) => Math.ceil(t.length * 0.5),
  chat: async () => ({ content: '{}', model: 'test-model' }),
  chatStream: async function* () {},
};

const baseChar: RawCharacter = {
  name: '主角',
  aliases: ['小名'],
  personalityTags: ['冷静'],
  description: '开局少年',
  isMajor: true,
  sourceChapterIndex: 0,
};

describe('resolveCardView（FIX-21 区间取卡）', () => {
  it('无 cardSegments → 基础卡（向后兼容）', () => {
    const v = resolveCardView(baseChar, 5);
    expect(v).toEqual({ personalityTags: ['冷静'], description: '开局少年' });
    expect(v.segment).toBeUndefined();
  });

  it('命中段覆盖字段；未命中回退基础', () => {
    const char: RawCharacter = {
      ...baseChar,
      cardSegments: [
        { fromChapterIndex: 5, toChapterIndex: 9, personalityTags: ['沉稳'], description: '成名之后', status: '继任宗主' },
      ],
    };
    const inside = resolveCardView(char, 7);
    expect(inside.personalityTags).toEqual(['沉稳']);
    expect(inside.description).toBe('成名之后');
    expect(inside.status).toBe('继任宗主');

    const before = resolveCardView(char, 4);
    expect(before.description).toBe('开局少年');
    const after = resolveCardView(char, 10);
    expect(after.description).toBe('开局少年');
  });

  it('边界含端点；开放段（无 to）延伸至结尾', () => {
    const char: RawCharacter = {
      ...baseChar,
      cardSegments: [{ fromChapterIndex: 3, status: '重伤' }],
    };
    expect(resolveCardView(char, 2).status).toBeUndefined();
    expect(resolveCardView(char, 3).status).toBe('重伤');
    expect(resolveCardView(char, 99).status).toBe('重伤');
  });

  it('多段命中取最晚开始者', () => {
    const char: RawCharacter = {
      ...baseChar,
      cardSegments: [
        { fromChapterIndex: 0, status: '少年' },
        { fromChapterIndex: 10, status: '宗师' },
      ],
    };
    expect(resolveCardView(char, 12).status).toBe('宗师');
    expect(resolveCardView(char, 5).status).toBe('少年');
  });
});

describe('isTrueNameAllowedAt（FIX-21 称谓揭示）', () => {
  it('无 revealAt 恒放行；有则按章号放行', () => {
    expect(isTrueNameAllowedAt(baseChar, 0)).toBe(true);
    const revealed: RawCharacter = { ...baseChar, revealAt: 90 };
    expect(isTrueNameAllowedAt(revealed, 89)).toBe(false);
    expect(isTrueNameAllowedAt(revealed, 90)).toBe(true);
  });
});

describe('Phase3 注入集成：按章取卡进入角色上下文', () => {
  function asPrivate(c: Phase3SceneConverter) {
    return c as unknown as {
      buildSceneContext(
        scene: SceneBoundary,
        characters: RawCharacter[],
        locations: [],
        charIdMap: Map<string, string>,
        settingCard?: SettingCard,
      ): { chars: string };
    };
  }

  const char: RawCharacter = {
    ...baseChar,
    cardSegments: [{ fromChapterIndex: 5, description: '重伤未愈', status: '重伤' }],
  };
  const settingCard: SettingCard = { chapterSummaries: [], openThreads: [] };

  it('第 5 章场景注入段内状态；第 1 章场景仍为基础卡', () => {
    const conv = new Phase3SceneConverter(mockProvider, new ContextManager());
    const map = new Map([['主角', 'char_01'], ['小名', 'char_01']]);

    const late: SceneBoundary = {
      sceneIndex: 1, chapterIndex: 5, startParagraph: 0, endParagraph: 1,
      originalStartOffset: 0, originalEndOffset: 100, draftSlugline: '内景. 洞府 - 夜',
      keyCharacterNames: ['主角'], summary: '疗伤',
    };
    const early: SceneBoundary = { ...late, chapterIndex: 1, sceneIndex: 2 };

    const lateChars = asPrivate(conv).buildSceneContext(late, [char], [], map, settingCard).chars;
    const earlyChars = asPrivate(conv).buildSceneContext(early, [char], [], map, settingCard).chars;

    expect(lateChars).toContain('重伤未愈');
    expect(lateChars).toContain('状态:重伤');
    expect(earlyChars).toContain('开局少年');
    expect(earlyChars).not.toContain('重伤未愈');
  });
});
