import { describe, it, expect, vi } from 'vitest';
import { detectNameConflicts, type ConflictCharLike } from '@/lib/pipeline/phase1-name-conflicts';
import { reduceSetting } from '@/lib/pipeline/phase1-reduce';
import type { ChapterExtraction } from '@/lib/pipeline/phase1-map';
import type { Phase1BudgetController } from '@/lib/pipeline/phase1-budget';
import type { LLMProvider } from '@/lib/llm/types';

function ch(over: Partial<ConflictCharLike> & Pick<ConflictCharLike, 'name' | 'sourceChapterIndex'>): ConflictCharLike {
  return { aliases: [], personalityTags: [], description: '', isMajor: false, ...over };
}

describe('detectNameConflicts（FIX-14）', () => {
  it('别名冲突：同一别名指向两个实体 → alias-collision', () => {
    const conflicts = detectNameConflicts([
      ch({ name: '张三', aliases: ['老秦'], sourceChapterIndex: 1 }),
      ch({ name: '李四', aliases: ['老秦'], sourceChapterIndex: 20 }),
    ]);
    const hit = conflicts.find((c) => c.kind === 'alias-collision');
    expect(hit).toBeDefined();
    expect(hit!.names.sort()).toEqual(['张三', '李四']);
    expect(hit!.message).toContain('老秦');
  });

  it('别名撞他人主名 → alias-collision', () => {
    const conflicts = detectNameConflicts([
      ch({ name: '张三', aliases: ['老秦'], sourceChapterIndex: 1 }),
      ch({ name: '老秦', aliases: [], sourceChapterIndex: 8 }),
    ]);
    expect(conflicts.some((c) => c.kind === 'alias-collision' && c.names.includes('老秦'))).toBe(true);
  });

  it('循环别名 → circular-alias', () => {
    const conflicts = detectNameConflicts([
      ch({ name: '甲', aliases: ['乙'], sourceChapterIndex: 1 }),
      ch({ name: '乙', aliases: ['甲'], sourceChapterIndex: 2 }),
    ]);
    expect(conflicts.some((c) => c.kind === 'circular-alias')).toBe(true);
  });

  it('远距同名 + 标签无交集 → far-apart-same-name；近距/标签相交/缺标签均不报', () => {
    const far = detectNameConflicts([
      ch({ name: '陈默', personalityTags: ['冷静'], sourceChapterIndex: 3 }),
      ch({ name: '陈默', personalityTags: ['暴戾'], sourceChapterIndex: 40 }),
    ]);
    expect(far.some((c) => c.kind === 'far-apart-same-name')).toBe(true);

    const near = detectNameConflicts([
      ch({ name: '陈默', personalityTags: ['冷静'], sourceChapterIndex: 30 }),
      ch({ name: '陈默', personalityTags: ['暴戾'], sourceChapterIndex: 40 }),
    ]);
    expect(near.some((c) => c.kind === 'far-apart-same-name')).toBe(false);

    const overlap = detectNameConflicts([
      ch({ name: '陈默', personalityTags: ['冷静', '果决'], sourceChapterIndex: 3 }),
      ch({ name: '陈默', personalityTags: ['冷静'], sourceChapterIndex: 40 }),
    ]);
    expect(overlap.some((c) => c.kind === 'far-apart-same-name')).toBe(false);

    const noTags = detectNameConflicts([
      ch({ name: '陈默', sourceChapterIndex: 3 }),
      ch({ name: '陈默', sourceChapterIndex: 40 }),
    ]);
    expect(noTags.length).toBe(0); // 证据不足 → 不误报
  });
});

describe('reduceSetting 集成（FIX-14）：预算拦截路径（零 LLM）也产出冲突候选', () => {
  const neverProvider: LLMProvider = {
    name: 'never', modelId: 'never', description: 't', contextWindow: 1000,
    supportsJSONMode: () => true,
    estimateTokens: async () => 1,
    chat: vi.fn(async () => { throw new Error('不应被调用'); }),
    chatStream: async function* () {},
  };
  const blockedBudget = { canCall: () => false, blockedCount: 0, reset: () => {} } as unknown as Phase1BudgetController;

  it('同名跨章反差 + 别名冲突进入 nameConflicts，且朴素 merge 正常完成', async () => {
    const results: ChapterExtraction[] = [
      {
        chapterIndex: 5,
        characters: [ch({ name: '老秦', aliases: ['秦爷'], personalityTags: ['豪爽'], sourceChapterIndex: 5 }) as never],
        locations: [], timelineHints: [], summary: 's5', openThreads: [],
      },
      {
        chapterIndex: 45,
        characters: [
          ch({ name: '老秦', aliases: [], personalityTags: ['阴狠'], sourceChapterIndex: 45 }) as never,
          ch({ name: '路人甲', aliases: ['秦爷'], sourceChapterIndex: 45 }) as never,
        ],
        locations: [], timelineHints: [], summary: 's45', openThreads: [],
      },
    ];

    const reduced = await reduceSetting(neverProvider, results, [], { budget: blockedBudget });

    expect(vi.mocked(neverProvider.chat)).not.toHaveBeenCalled();
    expect(reduced.characters.map((c) => c.name)).toContain('老秦');
    expect(reduced.nameConflicts.some((c) => c.kind === 'far-apart-same-name')).toBe(true);
    expect(reduced.nameConflicts.some((c) => c.kind === 'alias-collision')).toBe(true); // 秦爷既是老秦别名、又属路人甲
  });
});
