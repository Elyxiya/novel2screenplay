import type { LLMProvider, LLMMessage } from '../llm/types';
import { safeJsonParse } from '../utils/safe-json';
import { estimateReducePromptTokens, type Phase1BudgetController } from './phase1-budget';
import type {
  ChapterSummary,
  OpenThread,
  Phase1Output,
  RawCharacter,
  RawLocation,
  TimelineHint,
} from '@novel/contracts/pipeline';
import type { ChapterExtraction } from './phase1-map';
import { buildAliasIndex } from './setting-card';

/** 合并决策：LLM 返回的归并分组 */
export interface MergeMember {
  name: string;
  chapterIndex: number;
}

export interface MergeGroup {
  /** 最终实体采用的名字 */
  canonicalName: string;
  /** 被归并进的成员（每个都带章节出处，保证可回溯） */
  members: MergeMember[];
  aliases: string[];
  description: string;
  isMajor: boolean;
}

export interface MergeDecision {
  mergeGroups: MergeGroup[];
}

/** merge log 条目：每个最终角色的归并记录（落数据，可回溯） */
export interface MergeLogEntry {
  canonicalName: string;
  charId: string;
  members: MergeMember[];
}

/** reduce 结果 = Phase1Output + 别名索引 + merge log */
export interface ReduceResult extends Phase1Output {
  aliasIndex: Map<string, string>;
  mergeLog: MergeLogEntry[];
  /** 预算 guards 未通过，LLM 合并决策被跳过（降级为朴素 merge） */
  budgetBlocked?: boolean;
}

export interface ReduceOptions {
  /** Phase1 预算守卫（Task 5：canRequest 接到 Phase1 reduce 调用点） */
  budget?: Phase1BudgetController;
}

/** 扁平化的单条角色抽取记录（跨章合并的输入单位） */
interface FlatCharacter {
  name: string;
  aliases: string[];
  personalityTags: string[];
  description: string;
  isMajor: boolean;
  sourceChapterIndex: number;
}

interface FlatLocation {
  name: string;
  type: RawLocation['type'];
  description: string;
  sourceChapterIndex: number;
}

/** reduce 阶段合并决策的 system prompt */
export const REDUCE_SYSTEM_PROMPT = `你是一位专业的文学分析助手。给定多个章节分别提取出的角色清单，你需要识别"同一人物在不同章节的不同称呼"，并给出合并决策。只输出纯 JSON。

输入格式：每行一个角色条目，形如 "chapterIndex|name|别名用,分隔|描述|major或minor"。

输出格式（必须严格遵守 JSON，不要包含任何其他文字）：
{
  "mergeGroups": [
    {
      "canonicalName": "合并后采用的名字",
      "members": [
        { "name": "原始称呼1", "chapterIndex": 5 },
        { "name": "原始称呼2", "chapterIndex": 12 }
      ],
      "aliases": ["别名1", "别名2"],
      "description": "合并后的角色描述",
      "isMajor": true
    }
  ]
}

要求：
1. 只输出纯 JSON
2. mergeGroups 覆盖输入中的每一个角色条目（每个条目恰好属于一个 group，不能遗漏、不能重复）
3. 同一人物的不同称呼（全名/别名/昵称/尊称）必须合并进同一个 group，members 列出所有被归并的原始称呼及其章节
4. 无歧义的独立角色各自成组（members 只有一项）
5. isMajor：该组任一成员是主要角色即为 true`;

/**
 * Phase1 reduce 引擎：把多章抽取归并成全局 Phase1Output。
 * - 字符合并交 LLM 决策，决策落数据：每个最终角色含 mergeProvenance（被归并进的
 *   别名+章节出处）、aliases 并集、isMajor=任一 major、sourceChapterIndex=最早章。
 * - LLM 合并失败（重试 2 次后）优雅降级为「按 name 精确匹配的朴素 merge」，不静默崩管线。
 */
export async function reduceSetting(
  provider: LLMProvider,
  results: ChapterExtraction[],
  rawResponses: string[],
  options?: ReduceOptions,
): Promise<ReduceResult> {
  const flatChars = flattenCharacters(results);
  const flatLocs = flattenLocations(results);
  const flatTimeline = flattenTimelineHints(results);
  const chapterSummaries = flattenChapterSummaries(results);
  const flatThreads = flattenOpenThreads(results);

  const budget = options?.budget;
  let budgetBlocked = false;

  // LLM 合并决策（尝试 1 次 + 重试 2 次），失败回退朴素 merge
  let groups: MergeGroup[] | null = null;
  let reduceRaw = '';
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Task 5：canRequest 守卫接到 Phase1 reduce 调用点——超限直接回退朴素 merge
    const promptTokens = estimateReducePromptTokens(
      flatChars.map((f) => `${f.sourceChapterIndex}|${f.name}`).join('\n'),
    );
    if (budget && !budget.canCall('reduce', {
      promptTokens,
      completionTokens: 8192,
      totalTokens: promptTokens + 8192,
    })) {
      console.log('[Phase1-reduce] 预算超限，跳过 LLM 合并决策（降级为朴素 merge）');
      budgetBlocked = true;
      break;
    }
    try {
      const decision = await requestMergeDecision(provider, flatChars);
      groups = decision.groups;
      reduceRaw = decision.raw;
      break;
    } catch (err) {
      lastError = err as Error;
      console.log(`[Phase1-reduce] LLM 合并决策失败 (attempt ${attempt + 1}/3): ${lastError.message}`);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  if (!groups) {
    console.log(
      `[Phase1-reduce] LLM 合并${budgetBlocked ? '被预算拦截' : '全部失败'}，回退为按 name 精确匹配的朴素 merge。${lastError ? `最后错误: ${lastError.message}` : ''}`,
    );
    groups = naiveMergeDecision(flatChars);
  }

  const characters = buildMergedCharacters(flatChars, groups);
  const locations = mergeLocations(flatLocs);
  const timelineHints = sortTimelineHints(flatTimeline);
  const openThreads = mergeOpenThreads(flatThreads);

  const settingCard = {
    chapterSummaries,
    openThreads,
  };

  const aliasIndex = buildAliasIndex(characters);
  const mergeLog: MergeLogEntry[] = characters.map((c) => ({
    canonicalName: c.name,
    charId: aliasIndex.get(c.name) ?? '',
    members: (c.mergeProvenance ?? []).map((p) => ({ name: p.name, chapterIndex: p.chapterIndex })),
  }));

  const rawResponse =
    rawResponses.length > 0
      ? rawResponses.join('\n---\n')
      : budgetBlocked
        ? 'reduce 合并决策被预算拦截，已降级朴素 merge'
        : reduceRaw || (lastError ? `reduce 合并失败，已降级朴素 merge: ${lastError.message}` : '');

  return {
    characters,
    locations,
    timelineHints,
    settingCard,
    rawResponse,
    aliasIndex,
    mergeLog,
    ...(budgetBlocked ? { budgetBlocked: true } : {}),
  };
}

// ── 字符合并 ──────────────────────────────────────────────────────────────

function flattenCharacters(results: ChapterExtraction[]): FlatCharacter[] {
  return results.flatMap((r) =>
    r.characters.map((c) => ({
      name: c.name,
      aliases: c.aliases ?? [],
      personalityTags: c.personalityTags ?? [],
      description: c.description ?? '',
      isMajor: c.isMajor ?? false,
      sourceChapterIndex: c.sourceChapterIndex,
    })),
  );
}

async function requestMergeDecision(
  provider: LLMProvider,
  flat: FlatCharacter[],
): Promise<{ groups: MergeGroup[]; raw: string }> {
  const listing = flat
    .map((f) => `${f.sourceChapterIndex}|${f.name}|${f.aliases.join(',')}|${f.description}|${f.isMajor ? 'major' : 'minor'}`)
    .join('\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: REDUCE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `请对以下各章提取的角色做合并决策，输出 JSON。\n\n${listing}`,
    },
  ];

  const response = await provider.chat(messages, {
    responseFormat: 'json_object',
    temperature: 0.1,
    maxTokens: 8192,
  });
  const parsed = safeJsonParse(response.content) as { mergeGroups?: MergeGroup[] };
  const groups = parsed.mergeGroups;
  // 空数组合法（无可合并角色）；仅当缺失/非数组时视为决策失败
  if (!Array.isArray(groups)) {
    throw new Error('LLM 合并决策未返回有效的 mergeGroups');
  }
  return { groups, raw: response.content };
}

/** 按 name 精确匹配的朴素合并（LLM 决策失败的降级路径） */
export function naiveMergeDecision(flat: FlatCharacter[]): MergeGroup[] {
  const byName = new Map<string, FlatCharacter[]>();
  for (const f of flat) {
    const arr = byName.get(f.name) ?? [];
    arr.push(f);
    byName.set(f.name, arr);
  }
  const groups: MergeGroup[] = [];
  for (const [name, entries] of byName) {
    groups.push({
      canonicalName: name,
      members: entries.map((e) => ({ name: e.name, chapterIndex: e.sourceChapterIndex })),
      aliases: dedupe(entries.flatMap((e) => e.aliases)),
      description: entries.find((e) => e.description)?.description ?? '',
      isMajor: entries.some((e) => e.isMajor),
    });
  }
  return groups;
}

/** 由合并决策重建最终角色（mergeProvenance 落数据，可回溯） */
function buildMergedCharacters(flat: FlatCharacter[], groups: MergeGroup[]): RawCharacter[] {
  const byKey = new Map<string, FlatCharacter>();
  for (const f of flat) byKey.set(`${f.name}@${f.sourceChapterIndex}`, f);

  return groups.map((g) => {
    // 收集该 group 覆盖的源条目（通过 name+chapterIndex 精确回溯）
    const entries: FlatCharacter[] = [];
    for (const m of g.members ?? []) {
      const e = byKey.get(`${m.name}@${m.chapterIndex}`);
      if (e) entries.push(e);
      else {
        // LLM 返回了清单里不存在的成员：保留出处但不引用实体数据
        entries.push({
          name: m.name,
          aliases: [],
          personalityTags: [],
          description: '',
          isMajor: false,
          sourceChapterIndex: m.chapterIndex,
        });
      }
    }
    if (entries.length === 0) {
      // 空 members 的兜底：以 canonicalName 自立为组
      entries.push({
        name: g.canonicalName,
        aliases: g.aliases ?? [],
        personalityTags: [],
        description: g.description ?? '',
        isMajor: g.isMajor ?? false,
        sourceChapterIndex: g.members?.[0]?.chapterIndex ?? 0,
      });
    }

    const mergeProvenance = dedupeMembers(
      entries.map((e) => ({ name: e.name, chapterIndex: e.sourceChapterIndex })),
    );
    // aliases = 全部源名称（含代表名）+ 全部源别名的并集，保证别名索引可回溯到每个称呼
    const aliases = dedupe(entries.flatMap((e) => [e.name, ...e.aliases]));
    const personalityTags = dedupe(entries.flatMap((e) => e.personalityTags));
    const isMajor = entries.some((e) => e.isMajor) || Boolean(g.isMajor);
    const sourceChapterIndex = Math.min(...entries.map((e) => e.sourceChapterIndex));
    const description =
      (g.description ?? '').trim() !== '' ? g.description : entries.find((e) => e.description)?.description ?? '';

    return {
      name: g.canonicalName,
      aliases,
      personalityTags,
      description,
      isMajor,
      sourceChapterIndex,
      mergeProvenance,
    };
  });
}

// ── 地点 / 时间线 / 摘要 / open threads ───────────────────────────────────

function flattenLocations(results: ChapterExtraction[]): FlatLocation[] {
  return results.flatMap((r) =>
    r.locations.map((l) => ({
      name: l.name,
      type: l.type,
      description: l.description ?? '',
      sourceChapterIndex: l.sourceChapterIndex,
    })),
  );
}

/** 地点按 name 去重，保留最早出处（sourceChapterIndex 最小者） */
function mergeLocations(flat: FlatLocation[]): RawLocation[] {
  const byName = new Map<string, FlatLocation>();
  for (const l of flat) {
    const existing = byName.get(l.name);
    if (!existing || l.sourceChapterIndex < existing.sourceChapterIndex) {
      byName.set(l.name, l);
    }
  }
  return [...byName.values()]
    .sort((a, b) => a.sourceChapterIndex - b.sourceChapterIndex)
    .map((l) => ({
      name: l.name,
      type: l.type,
      description: l.description,
      sourceChapterIndex: l.sourceChapterIndex,
    }));
}

function flattenTimelineHints(results: ChapterExtraction[]): TimelineHint[] {
  return results.flatMap((r) => r.timelineHints);
}

function sortTimelineHints(hints: TimelineHint[]): TimelineHint[] {
  return [...hints].sort((a, b) => a.chapterIndex - b.chapterIndex);
}

function flattenChapterSummaries(results: ChapterExtraction[]): ChapterSummary[] {
  return results
    .filter((r) => typeof r.summary === 'string' && r.summary.trim() !== '')
    .map((r) => ({ chapterIndex: r.chapterIndex, summary: r.summary.trim() }))
    .sort((a, b) => a.chapterIndex - b.chapterIndex);
}

function flattenOpenThreads(results: ChapterExtraction[]): OpenThread[] {
  return results.flatMap((r) => r.openThreads);
}

/** openThreads 按 id（空 id 用 title）去重，同一线索跨章合并 span */
export function mergeOpenThreads(flat: OpenThread[]): OpenThread[] {
  const byKey = new Map<string, OpenThread>();
  for (const t of flat) {
    const key = (t.id || t.title || '').trim();
    if (key === '') continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...t });
      continue;
    }
    // 跨章合并：span 取最早 start 与最晚 end，description/title 缺则补
    existing.startChapterIndex = Math.min(existing.startChapterIndex, t.startChapterIndex);
    if (t.endChapterIndex !== undefined) {
      existing.endChapterIndex =
        existing.endChapterIndex === undefined
          ? t.endChapterIndex
          : Math.max(existing.endChapterIndex, t.endChapterIndex);
    }
    if (!existing.title && t.title) existing.title = t.title;
    if (!existing.description && t.description) existing.description = t.description;
  }
  return [...byKey.values()].sort((a, b) => a.startChapterIndex - b.startChapterIndex);
}

// ── 自洽性代理 ─────────────────────────────────────────────────────────────

/**
 * 自洽性代理：用两种切序（顺序/逆序）跑 reduce，比较最终实体集（canonicalName）的差。
 * 顺序无关的合并应返回 0（两切序实体集一致）。
 */
export async function fragmentationSelfConsistency(
  reduceFn: (results: ChapterExtraction[], rawResponses: string[]) => Promise<ReduceResult>,
  results: ChapterExtraction[],
): Promise<number> {
  const forward = await reduceFn(results, []);
  const reverse = await reduceFn([...results].reverse(), []);

  const namesA = new Set(forward.characters.map((c) => c.name));
  const namesB = new Set(reverse.characters.map((c) => c.name));
  let diff = 0;
  for (const n of namesA) if (!namesB.has(n)) diff++;
  for (const n of namesB) if (!namesA.has(n)) diff++;
  return diff;
}

// ── 工具 ───────────────────────────────────────────────────────────────────

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function dedupeMembers(members: MergeMember[]): MergeMember[] {
  const seen = new Set<string>();
  const out: MergeMember[] = [];
  for (const m of members) {
    const key = `${m.name}@${m.chapterIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
