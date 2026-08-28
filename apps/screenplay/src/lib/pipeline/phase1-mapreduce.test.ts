import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider, LLMMessage } from '@/lib/llm/types';
import { ContextManager } from '@/lib/pipeline/ContextManager';
import {
  mapChapters,
  MAP_MAX_CHAPTERS,
  type ChapterExtraction,
} from '@/lib/pipeline/phase1-map';
import {
  reduceSetting,
  fragmentationSelfConsistency,
  mergeOpenThreads,
} from '@/lib/pipeline/phase1-reduce';
import { Phase1Analyzer } from '@/lib/pipeline/Phase1Analyzer';
import { buildAliasIndex, resolveNameToCharId } from '@/lib/pipeline/setting-card';
import { buildOversizeChapter, buildMultiChapterPiece } from '@/lib/pipeline/__fixtures__/mapreduce';
import { autoFixScreenplay } from '@novel/contracts/validator';
import type { Screenplay } from '@novel/contracts/screenplay';

// ── Stub LLMProvider ──────────────────────────────────────────────────────

/** 规范名映射：秦爷 与 老秦 指同一人（确定性，不依赖输入顺序） */
function canonicalName(n: string): string {
  return n === '秦爷' ? '老秦' : n;
}

/** map 抽取决策：按章节文本内容返回固定 JSON（sourceChapterIndex 由 map 层覆盖） */
function stubMapDecision(userContent: string): unknown {
  const m = userContent.match(/章节 #(\d+)/);
  const idx = m ? Number(m[1]) : 0;
  const characters: Array<Record<string, unknown>> = [];
  if (userContent.includes('老秦')) {
    characters.push({ name: '老秦', aliases: ['老铁匠'], personalityTags: ['沉稳'], description: '铁匠铺的老把式', isMajor: true });
  }
  if (userContent.includes('秦爷')) {
    characters.push({ name: '秦爷', aliases: ['秦老爷子'], personalityTags: ['威严'], description: '归乡的旧识', isMajor: true });
  }
  if (characters.length === 0) {
    characters.push({ name: '路人', aliases: [], personalityTags: [], description: '过路之人', isMajor: false });
  }
  return {
    characters,
    locations: [{ name: '青石镇集市', type: 'exterior', description: '小镇集市' }],
    timelineHints: [{ timeCue: '清晨', type: 'time-of-day' }],
    summary: `第${idx}章摘要：本章推进了主线，交代了人物的去向。`,
    openThreads: [
      { id: 'thread_x', title: '失踪的账本', description: '账本下落成谜', ...(idx === 12 ? { endChapterIndex: 12 } : {}) },
    ],
  };
}

/** reduce 合并决策：按 name 确定性分组（含 老秦/秦爷 → 老秦 的归并规则） */
function stubReduceDecision(userContent: string): unknown {
  const lines = userContent.split('\n').filter((l) => l.includes('|'));
  const entries = lines.map((line) => {
    const [chapterIndex, name, aliases, description, major] = line.split('|');
    return {
      name,
      aliases: aliases.split(',').filter(Boolean),
      description,
      isMajor: major === 'major',
      chapterIndex: Number(chapterIndex),
    };
  });
  const byCanonical = new Map<string, typeof entries>();
  for (const e of entries) {
    const c = canonicalName(e.name);
    const arr = byCanonical.get(c) ?? [];
    arr.push(e);
    byCanonical.set(c, arr);
  }
  const mergeGroups = [...byCanonical.entries()].map(([name, es]) => ({
    canonicalName: name,
    members: es.map((e) => ({ name: e.name, chapterIndex: e.chapterIndex })),
    aliases: [...new Set(es.flatMap((e) => [e.name, ...e.aliases]))],
    description: es.find((e) => e.description)?.description ?? '',
    isMajor: es.some((e) => e.isMajor),
  }));
  return { mergeGroups };
}

function createStubProvider() {
  let callCount = 0;
  const chat = vi.fn(async (messages: LLMMessage[]) => {
    callCount++;
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    if (user.startsWith('请分析以下章节')) {
      return { content: JSON.stringify(stubMapDecision(user)), model: 'test' };
    }
    if (user.startsWith('请对以下各章提取的角色做合并决策')) {
      return { content: JSON.stringify(stubReduceDecision(user)), model: 'test' };
    }
    if (user.startsWith('请分析以下小说文本')) {
      return {
        content: JSON.stringify({
          characters: [{ name: '林墨', aliases: [], personalityTags: [], description: '主角', isMajor: true }],
          locations: [],
          timelineHints: [],
        }),
        model: 'test',
      };
    }
    throw new Error(`未知的 LLM 调用: ${user.slice(0, 40)}`);
  });
  const provider: LLMProvider = {
    name: 'test',
    modelId: 'test-model',
    description: 'test',
    contextWindow: 32000,
    supportsJSONMode: () => true,
    estimateTokens: async (t: string) => Math.ceil(t.length * 0.5),
    chat,
    chatStream: vi.fn(async function* () {}),
  };
  return { provider, chatCalls: () => callCount };
}

const ctxManager = new ContextManager();

// ── Helpers ───────────────────────────────────────────────────────────────

function extractionFor(
  chapterIndex: number,
  chars: Array<Partial<ChapterExtraction['characters'][number]>>,
  opts: Partial<ChapterExtraction> = {},
): ChapterExtraction {
  return {
    chapterIndex,
    characters: chars.map((c, i) => ({
      name: `char${i}`,
      aliases: [],
      personalityTags: [],
      description: '',
      isMajor: false,
      sourceChapterIndex: chapterIndex,
      ...c,
    })),
    locations: [],
    timelineHints: [],
    summary: '',
    openThreads: [],
    ...opts,
  };
}

// ── 分块 ──────────────────────────────────────────────────────────────────

describe('phase1 mapChapters - 超长单章二次分块', () => {
  it('超过 token 阈值的单章被切分，两块产物都带 sourceChapterIndex', async () => {
    const { provider, chatCalls } = createStubProvider();
    const chapter = buildOversizeChapter();
    expect(chapter.text.length).toBeGreaterThanOrEqual(46000);

    const result = await mapChapters(provider, ctxManager, [chapter]);

    expect(result.results).toHaveLength(1);
    const [ext] = result.results;
    // 每块各产出一个"路人" → 合并后该章有 >=2 个角色，全部指向本章
    expect(ext.characters.length).toBeGreaterThanOrEqual(2);
    for (const c of ext.characters) {
      expect(c.sourceChapterIndex).toBe(chapter.index);
    }
    // 确实发生了分块：抽取调用数 >= 2（每块一次）
    expect(result.rawResponses.length).toBeGreaterThanOrEqual(2);
    expect(chatCalls()).toBe(result.rawResponses.length);
  });
});

// ── cap ───────────────────────────────────────────────────────────────────

describe('phase1 mapChapters - 内置廉价 cap', () => {
  it('章节数超过 MAP_MAX_CHAPTERS 时 degraded=true，只处理前 cap 章', async () => {
    const { provider, chatCalls } = createStubProvider();
    const chapters = Array.from({ length: MAP_MAX_CHAPTERS + 1 }, (_, i) => ({
      index: i,
      title: `章${i}`,
      text: `第${i}章正文内容`,
    }));

    const result = await mapChapters(provider, ctxManager, chapters);

    expect(result.degraded).toBe(true);
    expect(result.results).toHaveLength(MAP_MAX_CHAPTERS);
    expect(chatCalls()).toBe(MAP_MAX_CHAPTERS);
    // 只处理前 cap 章
    expect(result.results[MAP_MAX_CHAPTERS - 1].chapterIndex).toBe(MAP_MAX_CHAPTERS - 1);
  });

  it('未超限时 degraded=false', async () => {
    const { provider } = createStubProvider();
    const result = await mapChapters(provider, ctxManager, buildMultiChapterPiece());
    expect(result.degraded).toBe(false);
    expect(result.results).toHaveLength(3);
  });
});

// ── reduce 归并 ───────────────────────────────────────────────────────────

describe('phase1 reduceSetting - 字符合并落数据', () => {
  it('老秦(第5章)/秦爷(第12章)归并为同实体，mergeProvenance/aliases/aliasIndex 均可回溯', async () => {
    const { provider } = createStubProvider();
    const results: ChapterExtraction[] = [
      extractionFor(5, [{ name: '老秦', aliases: ['老铁匠'], personalityTags: ['沉稳'], description: '铁匠铺的老把式', isMajor: true, sourceChapterIndex: 5 }]),
      extractionFor(12, [{ name: '秦爷', aliases: ['秦老爷子'], personalityTags: ['威严'], description: '归乡的旧识', isMajor: true, sourceChapterIndex: 12 }]),
    ];

    const reduced = await reduceSetting(provider, results, []);

    expect(reduced.characters).toHaveLength(1);
    const merged = reduced.characters[0];
    expect(merged.name).toBe('老秦');
    // 可回溯：两个被归并的别名+出处
    expect(merged.mergeProvenance).toEqual([
      { name: '老秦', chapterIndex: 5 },
      { name: '秦爷', chapterIndex: 12 },
    ]);
    // aliases 并集含两者
    expect(merged.aliases).toEqual(expect.arrayContaining(['老秦', '秦爷']));
    // 最早章
    expect(merged.sourceChapterIndex).toBe(5);
    // aliasIndex 两个称呼映射同一 charId
    const idA = reduced.aliasIndex.get('老秦');
    const idB = reduced.aliasIndex.get('秦爷');
    expect(idA).toBeDefined();
    expect(idB).toBeDefined();
    expect(idA).toBe(idB);
    // mergeLog 落数据
    expect(reduced.mergeLog).toHaveLength(1);
    expect(reduced.mergeLog[0].members).toEqual([
      { name: '老秦', chapterIndex: 5 },
      { name: '秦爷', chapterIndex: 12 },
    ]);
  });

  it('LLM 合并失败时优雅降级为朴素 merge，不崩管线', { timeout: 10000 }, async () => {
    const chat = vi.fn(async (messages: LLMMessage[]) => {
      const user = messages.find((m) => m.role === 'user')?.content ?? '';
      if (user.startsWith('请对以下各章提取的角色做合并决策')) {
        throw new Error('LLM 超时');
      }
      return { content: JSON.stringify(stubReduceDecision(user)), model: 'test' };
    });
    const provider: LLMProvider = {
      name: 'test',
      modelId: 'test-model',
      description: 'test',
      contextWindow: 32000,
      supportsJSONMode: () => true,
      estimateTokens: async (t: string) => t.length,
      chat,
      chatStream: vi.fn(async function* () {}),
    };
    const results: ChapterExtraction[] = [
      extractionFor(5, [{ name: '老秦', isMajor: true, sourceChapterIndex: 5 }]),
      extractionFor(12, [{ name: '老秦', isMajor: true, sourceChapterIndex: 12 }]),
    ];

    const reduced = await reduceSetting(provider, results, []);

    // 降级为按 name 精确匹配：同名"老秦"两章条目合并
    expect(reduced.characters).toHaveLength(1);
    expect(reduced.characters[0].name).toBe('老秦');
    expect(reduced.characters[0].mergeProvenance).toHaveLength(2);
    // 重试 2 次 + 首次 = 3 次 LLM 调用
    expect(chat.mock.calls.length).toBe(3);
  });

  it('summary 落到 settingCard.chapterSummaries 并按章排序', async () => {
    const { provider } = createStubProvider();
    const results: ChapterExtraction[] = [
      extractionFor(12, [{ name: '秦爷', sourceChapterIndex: 12 }], { summary: '第12章摘要' }),
      extractionFor(5, [{ name: '老秦', sourceChapterIndex: 5 }], { summary: '第5章摘要' }),
      extractionFor(3, [], { summary: '第3章摘要' }),
    ];

    const reduced = await reduceSetting(provider, results, []);

    expect(reduced.settingCard?.chapterSummaries).toEqual([
      { chapterIndex: 3, summary: '第3章摘要' },
      { chapterIndex: 5, summary: '第5章摘要' },
      { chapterIndex: 12, summary: '第12章摘要' },
    ]);
  });

  it('openThreads 跨章合并 span（最早 start、最晚 end）', async () => {
    const { provider } = createStubProvider();
    const results: ChapterExtraction[] = [
      extractionFor(5, [], {
        openThreads: [{ id: 'thread_x', title: '失踪的账本', description: '账本下落成谜', startChapterIndex: 5 }],
      }),
      extractionFor(12, [], {
        openThreads: [{ id: 'thread_x', title: '失踪的账本', description: '', startChapterIndex: 12, endChapterIndex: 12 }],
      }),
    ];

    const reduced = await reduceSetting(provider, results, []);

    expect(reduced.settingCard?.openThreads).toHaveLength(1);
    expect(reduced.settingCard?.openThreads[0]).toMatchObject({
      id: 'thread_x',
      title: '失踪的账本',
      startChapterIndex: 5,
      endChapterIndex: 12,
    });
  });

  it('mergeOpenThreads 去重且无 key 的线索被丢弃', () => {
    const merged = mergeOpenThreads([
      { id: 'a', title: '线索A', description: '', startChapterIndex: 1, endChapterIndex: 3 },
      { id: 'a', title: '线索A', description: '推进', startChapterIndex: 1 },
      { id: '', title: '', description: '无键', startChapterIndex: 2 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'a', startChapterIndex: 1, endChapterIndex: 3, description: '推进' });
  });
});

// ── 自洽性代理 ────────────────────────────────────────────────────────────

describe('fragmentationSelfConsistency - 自洽性代理', () => {
  it('顺序无关的合并两切序实体集差为 0', async () => {
    const { provider } = createStubProvider();
    const results = buildMultiChapterPiece();
    // 通过真实 map 得到各章抽取（含老秦/秦爷）
    const mapped = await mapChapters(provider, ctxManager, results);

    const diff = await fragmentationSelfConsistency(
      (rs, _raw) => reduceSetting(provider, rs, _raw),
      mapped.results,
    );
    expect(diff).toBe(0);
  });
});

// ── Phase1Analyzer 双路径 ─────────────────────────────────────────────────

describe('Phase1Analyzer - mode 双路径', () => {
  let provider: ReturnType<typeof createStubProvider>['provider'];

  beforeEach(() => {
    provider = createStubProvider().provider;
  });

  it("mode='truncate'（默认）无 settingCard", async () => {
    const analyzer = new Phase1Analyzer(provider, ctxManager);
    const output = await analyzer.analyze(
      [{ index: 0, title: '第一章', text: '林墨从山里来。' }],
      { mode: 'truncate' },
    );
    expect(output.settingCard).toBeUndefined();
    expect(output.characters).toHaveLength(1);
    expect(output.characters[0].name).toBe('林墨');
  });

  it("mode='mapreduce' 产出 settingCard（chapterSummaries + openThreads）", async () => {
    const analyzer = new Phase1Analyzer(provider, ctxManager);
    const chapters = buildMultiChapterPiece();
    const output = await analyzer.analyze(chapters, { mode: 'mapreduce' });

    expect(output.settingCard).toBeDefined();
    expect(output.settingCard?.chapterSummaries.length).toBeGreaterThan(0);
    // 第5、12 章的摘要都在
    const idxs = output.settingCard?.chapterSummaries.map((s) => s.chapterIndex) ?? [];
    expect(idxs).toContain(5);
    expect(idxs).toContain(12);
    expect(output.settingCard?.openThreads.length).toBeGreaterThan(0);
  });
});

// ── setting-card 辅助 ─────────────────────────────────────────────────────

describe('setting-card 辅助', () => {
  it('buildAliasIndex 将 name 与每个 alias 映射到同一 charId', () => {
    const index = buildAliasIndex([
      { name: '老秦', aliases: ['老铁匠'] },
      { name: '秦爷', aliases: ['秦老爷子'] },
    ]);
    expect(index.get('老秦')).toBe(index.get('老铁匠'));
    expect(index.get('秦爷')).toBe(index.get('秦老爷子'));
    expect(resolveNameToCharId(index, '老铁匠')).toBe('char_01');
    expect(resolveNameToCharId(index, '不存在的名字')).toBeUndefined();
  });
});

// ── validator 新占位名 ────────────────────────────────────────────────────

describe('validator - 占位 rawName 保留', () => {
  it('引用不存在 characterId 时 autoFixScreenplay 产出 未知角色(id=<原名>)', () => {
    const screenplay: Screenplay = {
      formatVersion: 'novel2screenplay-v1',
      metadata: {
        title: '测试',
        author: '',
        sourceNovel: '测试',
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        totalScenes: 1,
        totalCharacters: 0,
        totalLocations: 1,
      },
      characters: [],
      locations: [{ locationId: 'loc_01', name: '青石镇', type: 'exterior', description: '' }],
      scenes: [
        {
          sceneNumber: 1,
          slugline: '外景. 青石镇 - 日',
          timeOfDay: 'morning',
          locationId: 'loc_01',
          characterIds: ['老秦'],
          content: [{ type: 'dialogue', characterId: '秦爷', line: '回来了？', sourceRefs: [] }],
          summary: '',
        },
      ],
    };

    const { fixed } = autoFixScreenplay(screenplay);
    const stubNames = fixed.characters.map((c) => c.name);
    expect(stubNames).toContain('未知角色(id=老秦)');
    expect(stubNames).toContain('未知角色(id=秦爷)');
  });
});
