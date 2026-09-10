import { describe, it, expect, vi } from 'vitest';
import {
  applyUserProfile,
  formatUserProfileBlock,
  hashUserProfile,
} from '@/lib/pipeline/user-profile';
import { Phase3SceneConverter } from '@/lib/pipeline/Phase3SceneConverter';
import { ContextManager } from '@/lib/pipeline/ContextManager';
import type { Phase1Output, UserProfile, SceneBoundary, RawCharacter } from '@novel/contracts/pipeline';
import type { LLMProvider } from '@/lib/llm/types';

function basePhase1(): Phase1Output {
  return {
    characters: [
      { name: '白斯', aliases: ['白兄'], personalityTags: ['阴沉'], description: '反派', isMajor: true, sourceChapterIndex: 0 },
      { name: '黎恩·怀特', aliases: ['琼斯·博诺佛尔'], personalityTags: [], description: '主角', isMajor: true, sourceChapterIndex: 0 },
    ],
    locations: [],
    timelineHints: [],
    aliasIndex: { 白兄: '白斯' },
    rawResponse: '{}',
  };
}

describe('applyUserProfile（FIX-13 融合与冲突）', () => {
  it('无 profile → 原样透传、hash 为 null', () => {
    const p1 = basePhase1();
    const { phase1, report } = applyUserProfile(p1);
    expect(phase1).toBe(p1);
    expect(report).toEqual({ applied: [], conflicts: [], profileHash: null });
  });

  it('字段覆盖：用户生效且差异记 conflict；重复应用幂等（二次无新 conflict）', () => {
    const profile: UserProfile = {
      characters: [{ name: '白斯', personalityTags: ['悲情'], description: '被命运碾碎的反派' }],
      appellations: [],
      constraints: [],
    };
    const first = applyUserProfile(basePhase1(), profile);
    const bai = first.phase1.characters.find((c) => c.name === '白斯')!;
    expect(bai.personalityTags).toEqual(['悲情']);
    expect(bai.description).toBe('被命运碾碎的反派');
    expect(first.report.conflicts.length).toBe(2); // tags + description 均与原文不同
    expect(first.report.applied.length).toBeGreaterThan(0);

    const second = applyUserProfile(first.phase1, profile);
    expect(second.report.conflicts).toEqual([]); // 幂等：值已相等
  });

  it('新增角色 + 称谓锁定（别名补齐并 applied）', () => {
    const profile: UserProfile = {
      characters: [{ name: '暗中人', aliases: ['黑衣人'], isMajor: false }],
      appellations: [{ character: '黎恩·怀特', lockedNames: ['琼斯·博诺佛尔', '怀特先生'] }],
      constraints: [],
    };
    const { phase1, report } = applyUserProfile(basePhase1(), profile);
    expect(phase1.characters.map((c) => c.name)).toContain('暗中人');
    const lien = phase1.characters.find((c) => c.name === '黎恩·怀特')!;
    expect(lien.aliases).toContain('怀特先生');
    expect(report.applied.some((a) => a.includes('称谓锁定'))).toBe(true);
    expect(phase1.aliasIndex?.['黑衣人']).toBe('暗中人');
  });

  it('结构化约束映射：require-reveal-at 设 revealAt；forbid-reveal-before 取下限', () => {
    const profile: UserProfile = {
      characters: [],
      appellations: [],
      constraints: [
        { id: 'c1', kind: 'require-reveal-at', character: '黎恩·怀特', chapterIndex: 90, rule: '真名须在 90 章揭示' },
        { id: 'c2', kind: 'forbid-reveal-before', character: '白斯', chapterIndex: 50, rule: '白斯身份不早于 50 章' },
        { id: 'c3', kind: 'forbid-death', character: '白斯', rule: '禁止白斯死亡' },
      ],
    };
    const { phase1, report } = applyUserProfile(basePhase1(), profile);
    expect(phase1.characters.find((c) => c.name === '黎恩·怀特')!.revealAt).toBe(90);
    expect(phase1.characters.find((c) => c.name === '白斯')!.revealAt).toBe(50);
    expect(report.applied.some((a) => a.includes('forbid-death') || a.includes('禁止白斯死亡'))).toBe(true);
  });

  it('约束目标未匹配 → 记 conflict（不静默）', () => {
    const profile: UserProfile = {
      characters: [],
      appellations: [{ character: '不存在的人', lockedNames: ['X'] }],
      constraints: [{ kind: 'forbid-death', character: '幽灵角色', rule: '禁止幽灵角色死亡' }],
    };
    const { report } = applyUserProfile(basePhase1(), profile);
    expect(report.conflicts.some((c) => c.includes('称谓锁定目标未匹配'))).toBe(true);
  });
});

describe('hashUserProfile（指纹稳定性）', () => {
  it('键序无关；值变化则变', () => {
    const a: UserProfile = { characters: [{ name: 'A', description: 'x' }], appellations: [], constraints: [{ rule: 'r', kind: 'custom' }] };
    const b: UserProfile = { constraints: [{ kind: 'custom', rule: 'r' }], appellations: [], characters: [{ description: 'x', name: 'A' }] };
    expect(hashUserProfile(a)).toBe(hashUserProfile(b));
    expect(hashUserProfile(a)).not.toBe(hashUserProfile({ ...a, targetFormat: 'short-drama' }));
    expect(hashUserProfile(undefined)).toBeNull();
  });
});

describe('formatUserProfileBlock（注入格式化）', () => {
  it('包含约束/称谓锁定；空 profile 返回空串；超长截断 ≤500', () => {
    const full: UserProfile = {
      characters: [{ name: '白斯', description: '被命运碾碎的反派', personalityTags: ['悲情'], isMajor: true }],
      appellations: [{ character: '黎恩·怀特', lockedNames: ['琼斯·博诺佛尔'] }],
      constraints: [{ rule: '禁止白斯死亡', kind: 'forbid-death' }],
    };
    const block = formatUserProfileBlock(full);
    expect(block).toContain('用户设定');
    expect(block).toContain('禁止白斯死亡');
    expect(block).toContain('称谓锁定: 黎恩·怀特 仅用 琼斯·博诺佛尔');

    expect(formatUserProfileBlock({ characters: [], appellations: [], constraints: [] })).toBe('');

    const many: UserProfile = {
      characters: [],
      appellations: [],
      constraints: Array.from({ length: 40 }, (_, i) => ({ rule: `约束${i}`.repeat(6), kind: 'custom' as const })),
    };
    const truncated = formatUserProfileBlock(many, 500);
    expect(truncated.length).toBeLessThanOrEqual(500);
    expect(truncated).toContain('截断');
  });
});

describe('Phase3 注入集成：用户设定块常驻 messages', () => {
  const mockProvider: LLMProvider = {
    name: 'test', modelId: 'test-model', description: 't', contextWindow: 32000,
    supportsJSONMode: () => true,
    estimateTokens: async (t: string) => Math.ceil(t.length * 0.5),
    chat: vi.fn(async () => ({
      model: 'test-model',
      content: JSON.stringify({ summary: 's', timeOfDay: 'day', confidence: 0.9, content: [{ type: 'action', description: '他抬头。', sourceRefs: [] }] }),
    })),
    chatStream: async function* () {},
  };

  const scene: SceneBoundary = {
    sceneIndex: 1, chapterIndex: 0, startParagraph: 0, endParagraph: 1,
    originalStartOffset: 0, originalEndOffset: 100, draftSlugline: '内景. 客厅 - 日',
    keyCharacterNames: ['白斯'], summary: '对峙',
  };
  const characters: RawCharacter[] = [
    { name: '白斯', aliases: [], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 0 },
  ];

  it('传入 userProfile → 首个调用上下文包含该块；未传 → 不含', async () => {
    const conv = new Phase3SceneConverter(mockProvider, new ContextManager());
    const jobStoreMock = {
      update: vi.fn(),
      get: vi.fn(() => ({ id: 'job-1', logs: [], scenesStatus: [] })),
    } as unknown as Parameters<typeof conv.convertScenes>[4];

    await conv.convertScenes([scene], characters, [], ['原文'], jobStoreMock, 'job-1', undefined, {
      userProfile: { characters: [], appellations: [], constraints: [{ rule: '禁止白斯死亡', kind: 'forbid-death' }] },
    });
    const withProfile = String(vi.mocked(mockProvider.chat).mock.calls[0][0][1].content);
    expect(withProfile).toContain('【用户设定（必须遵守，优先级高于原文推断）】');
    expect(withProfile).toContain('禁止白斯死亡');
  });
});
