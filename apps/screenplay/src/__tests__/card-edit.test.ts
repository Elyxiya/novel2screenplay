import { describe, it, expect, beforeEach, vi } from 'vitest';
import { diffCharacters, diffSettingCard, computeInvalidatedScenes } from '@/lib/pipeline/card-edit';
import { getDatabase } from '@/lib/store/sqlite/db';
import { getJobRepository } from '@/lib/store/sqlite/job-repository';
import { jobStore } from '@/lib/store/job-store';
import { PipelineEngine } from '@/lib/pipeline/PipelineEngine';
import type { RawCharacter, SceneBoundary, Phase3Output, SettingCard } from '@novel/contracts/pipeline';
import type { Screenplay } from '@novel/contracts/screenplay';
import type { LLMProvider } from '@/lib/llm/types';

const hoisted = vi.hoisted(() => ({}));
void hoisted;

vi.mock('@/lib/llm/llm-gateway', () => {
  const provider: LLMProvider = {
    name: 'mock', modelId: 'mock', description: 'mock', contextWindow: 32000,
    supportsJSONMode: () => true,
    estimateTokens: async () => 1,
    chat: async () => { throw new Error('mock-halt'); },
    chatStream: async function* () {},
  };
  return { resolveProvider: () => provider, resolveDefaultProvider: () => provider };
});

// ── 纯函数 ────────────────────────────────────────────────────────────────

const char = (over: Partial<RawCharacter> & Pick<RawCharacter, 'name'>): RawCharacter => ({
  aliases: [], personalityTags: [], description: '', isMajor: false, sourceChapterIndex: 0, ...over,
});

describe('diffCharacters（B-03）', () => {
  it('配角字段变化 → changedMinors + token 含新旧别名；主角未动则不触发全量', () => {
    const oldC = [char({ name: '甲', isMajor: true }), char({ name: '乙', aliases: ['小乙'], personalityTags: ['怯懦'] })];
    const newC = [char({ name: '甲', isMajor: true }), char({ name: '乙', aliases: ['乙哥'], personalityTags: ['果决'] })];
    const d = diffCharacters(oldC, newC);
    expect(d.touchedMajor).toBe(false);
    expect(d.changedMinors).toEqual(['乙']);
    expect(d.minorMatchTokens.sort()).toEqual(['乙', '乙哥', '小乙']);
  });

  it('isMajor 翻转 / 新增主角 / 删除主角 → touchedMajor', () => {
    expect(diffCharacters([char({ name: '乙' })], [char({ name: '乙', isMajor: true })]).touchedMajor).toBe(true);
    expect(diffCharacters([], [char({ name: '丙', isMajor: true })]).touchedMajor).toBe(true);
    expect(diffCharacters([char({ name: '丁', isMajor: true })], []).touchedMajor).toBe(true);
  });
});

describe('diffSettingCard（B-03）', () => {
  it('open threads 增删 → 窗口外扩一章；摘要文本变化/删除 → 章列表', () => {
    const oldCard: SettingCard = {
      chapterSummaries: [{ chapterIndex: 1, summary: '旧摘要' }, { chapterIndex: 5, summary: '保留' }],
      openThreads: [{ id: 't1', title: '玉佩', description: '', startChapterIndex: 3, endChapterIndex: 6 }],
    };
    const newCard: SettingCard = {
      chapterSummaries: [{ chapterIndex: 1, summary: '新摘要' }, { chapterIndex: 5, summary: '保留' }],
      openThreads: [{ id: 't2', title: '血仇', description: '', startChapterIndex: 10 }],
    };
    const d = diffSettingCard(oldCard, newCard);
    expect(d.summariesChangedChapters).toEqual([1]);
    expect(d.threadWindows).toEqual([
      { startChapterIndex: 9, endChapterIndex: undefined },
      { startChapterIndex: 2, endChapterIndex: 7 },
    ]);
  });
});

describe('computeInvalidatedScenes（B-03）', () => {
  const scene = (n: number, ch: number, kc: string[]): SceneBoundary => ({
    sceneIndex: n, chapterIndex: ch, startParagraph: 0, endParagraph: 0,
    originalStartOffset: 0, originalEndOffset: 10, draftSlugline: '内景. 客厅 - 夜',
    keyCharacterNames: kc, summary: '',
  });
  const noCard = { threadWindows: [], summariesChangedChapters: [] };

  it('主角变化 → 全部失效', () => {
    const scenes = [scene(1, 0, ['甲']), scene(2, 3, ['乙']), scene(3, 9, [])];
    const d = diffCharacters([char({ name: '甲', isMajor: true, description: 'x' })], [char({ name: '甲', isMajor: true, description: 'y' })]);
    expect(computeInvalidatedScenes(scenes, d, noCard)).toEqual([1, 2, 3]);
  });

  it('配角命中（含别名 token）→ 仅命中场景', () => {
    const scenes = [scene(1, 0, ['甲']), scene(2, 3, ['小乙']), scene(3, 7, ['丙'])];
    const d = diffCharacters([char({ name: '乙', aliases: ['小乙'] })], [char({ name: '乙', aliases: ['小乙'], personalityTags: ['果决'] })]);
    expect(computeInvalidatedScenes(scenes, d, noCard)).toEqual([2]);
  });

  it('线索窗口命中章区间；摘要变化影响其后章节（> ch）', () => {
    const scenes = [scene(1, 2, []), scene(2, 3, []), scene(3, 9, [])];
    const noChar = diffCharacters([], []);
    // 直接传入的窗口不做外扩（外扩在 diffSettingCard 里完成，见上一 describe）→ 仅 ch3 命中
    expect(computeInvalidatedScenes(scenes, noChar, { threadWindows: [{ startChapterIndex: 3, endChapterIndex: 3 }], summariesChangedChapters: [] })).toEqual([2]);
    expect(computeInvalidatedScenes(scenes, noChar, { threadWindows: [], summariesChangedChapters: [0] })).toEqual([1, 2, 3]); // ch>0 全部
    expect(computeInvalidatedScenes(scenes, noChar, noCard)).toEqual([]);
  });
});

// ── 引擎集成（零真实 LLM：provider 被 mock 且一律拒绝 → 降级场景） ─────────

function phase3Out(n: number, conf = 0.9, desc = '原动作'): Phase3Output {
  return {
    sceneNumber: n, slugline: '内景. 客厅 - 夜', timeOfDay: 'night', locationId: 'loc_00',
    characterIds: [], content: [{ type: 'action', description: desc, sourceRefs: [] }], summary: `s${n}`, confidence: conf,
  };
}

function minimalScreenplay(): Screenplay {
  return {
    formatVersion: 'novel2screenplay-v1',
    metadata: { title: '测试剧本', author: '', sourceNovel: '', version: '1.0.0', createdAt: '2026-09-11T00:00:00.000Z', totalScenes: 2, totalCharacters: 1, totalLocations: 0 },
    characters: [{ characterId: 'char_01', name: '甲', aliases: [], personalityTags: [], description: '', isMajor: true, sourceRef: { chapterIndex: 0, paragraphIndex: 0, excerpt: '' } }],
    locations: [],
    scenes: [
      { sceneNumber: 1, slugline: '内景. 客厅 - 夜', timeOfDay: 'night', locationId: 'loc_00', characterIds: ['char_01'], content: [{ type: 'action', description: '原动作', sourceRefs: [] }], summary: 's1' },
      { sceneNumber: 2, slugline: '内景. 客厅 - 夜', timeOfDay: 'night', locationId: 'loc_00', characterIds: ['char_01'], content: [{ type: 'action', description: '原动作', sourceRefs: [] }], summary: 's2' },
    ],
  };
}

describe('PipelineEngine.applyCardEdit 集成（B-03）', () => {
  const repo = getJobRepository();
  const engine = new PipelineEngine();
  let jobId: string;

  beforeEach(() => {
    getDatabase();
    jobId = repo.create({ novelText: '第 一 章 文本', chapterTexts: ['第一章文本'], modelId: 'mock', selectedChapters: [0], temperature: 0.5, userId: 'u1' });
    repo.update(jobId, {
      status: 'completed',
      pipelineState: {
        phase1Output: {
          characters: [
            char({ name: '甲', isMajor: true }),
            char({ name: '乙', aliases: ['小乙'], personalityTags: ['怯懦'] }),
          ],
          locations: [], timelineHints: [], rawResponse: '{}',
        },
        phase2Output: {
          scenes: [
            { sceneIndex: 1, chapterIndex: 0, startParagraph: 0, endParagraph: 0, originalStartOffset: 0, originalEndOffset: 5, draftSlugline: '内景. 客厅 - 夜', keyCharacterNames: ['甲'], summary: 's1' },
            { sceneIndex: 2, chapterIndex: 0, startParagraph: 0, endParagraph: 0, originalStartOffset: 5, originalEndOffset: 10, draftSlugline: '内景. 客厅 - 夜', keyCharacterNames: ['小乙'], summary: 's2' },
          ],
          rawResponses: [],
        },
        phase3Output: [phase3Out(1), phase3Out(2)],
        phase4Output: minimalScreenplay(),
      },
    });
  });

  it('仅配角命中场景被重转；其余产物原样；cardEditLog 落库', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout,
    );
    try {
      const result = await engine.applyCardEdit(jobId, {
        characters: [
          char({ name: '甲', isMajor: true }),
          char({ name: '乙', aliases: ['小乙'], personalityTags: ['果决'] }),
        ],
      });

      expect(result.invalidatedScenes).toEqual([2]);
      expect(result.reconvertedScenes).toEqual([2]);

      const job = jobStore.get(jobId)!;
      const outputs = job.pipelineState.phase3Output!;
      expect(outputs.find((o) => o.sceneNumber === 1)!.confidence).toBe(0.9); // 未动
      expect(outputs.find((o) => o.sceneNumber === 2)!.confidence).toBe(0.1); // 重转失败 → 降级
      expect(job.pipelineState.cardEditLog).toMatchObject({ invalidatedCount: 1, reconvertedScenes: [2], touchedMajor: false });
      expect(job.status).toBe('completed');
    } finally {
      spy.mockRestore();
    }
  });

  it('新增与场景无关的次要角色 → 无失效，Phase3 产物原样但编辑已留痕', async () => {
    const before = jobStore.get(jobId)!.pipelineState.phase3Output!.map((o) => o.confidence);

    const result = await engine.applyCardEdit(jobId, {
      characters: [
        char({ name: '甲', isMajor: true }),
        char({ name: '乙', aliases: ['小乙'], personalityTags: ['怯懦'] }), // 保持原样
        char({ name: '丙' }), // 新增：未出现在任何 keyCharacterNames
      ],
    });

    expect(result.invalidatedScenes).toEqual([]);
    const job = jobStore.get(jobId)!;
    expect(job.pipelineState.phase3Output!.map((o) => o.confidence)).toEqual(before);
    expect(job.pipelineState.phase1Output!.characters.map((c) => c.name)).toContain('丙'); // 编辑已持久化
  });
});
