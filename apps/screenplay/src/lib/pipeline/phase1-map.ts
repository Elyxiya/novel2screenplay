import type { LLMProvider, LLMMessage } from '../llm/types';
import { ContextManager, MAX_ANALYSIS_TOKENS } from './ContextManager';
import { safeJsonParse } from '../utils/safe-json';
import type {
  OpenThread,
  RawCharacter,
  RawLocation,
  TimelineHint,
} from '@novel/contracts/pipeline';

/** map 阶段内置廉价 cap：每 job 最多处理的章节数，超限优雅降级（不抛错） */
export const MAP_MAX_CHAPTERS = 200;

/**
 * 单章 token 阈值：超过则用 ContextManager.splitIntoChunks 二次分块。
 * 与整本分析上限一致（>30k 的单章不撞墙）。
 */
export const MAP_CHAPTER_TOKEN_THRESHOLD = MAX_ANALYSIS_TOKENS;

/** 章节抽取的 system prompt（输出除实体外还含 summary 与 openThreads） */
export const MAP_SYSTEM_PROMPT = `你是一位专业的文学分析助手。你的任务是分析一个小说章节，提取该章的角色、地点、时间线与开放线索，并写一段 2-3 句的章节摘要。只输出纯 JSON。

输出格式（必须严格遵守 JSON，不要包含任何其他文字）：
{
  "characters": [
    {
      "name": "角色全名",
      "aliases": ["别名1", "别名2"],
      "personalityTags": ["标签1", "标签2"],
      "description": "角色描述",
      "isMajor": true
    }
  ],
  "locations": [
    {
      "name": "地点名称",
      "type": "interior | exterior | abstract",
      "description": "地点描述"
    }
  ],
  "timelineHints": [
    {
      "timeCue": "傍晚",
      "type": "time-of-day | time-jump | season"
    }
  ],
  "summary": "本段 2-3 句的章节摘要",
  "openThreads": [
    {
      "id": "伏笔唯一id",
      "title": "线索标题",
      "description": "线索描述",
      "endChapterIndex": 12
    }
  ]
}

要求：
1. 只输出纯 JSON
2. 角色名提取完整姓名（如"林黛玉"而非"黛玉"），别名放在 aliases 中
3. isMajor 标记为主要角色（出现次数多、推动剧情）还是次要角色
4. 地点 type: interior(室内)、exterior(室外)、abstract(抽象空间如梦境)
5. openThreads 是本章引入或推进的开放线索/伏笔；endChapterIndex 仅当该线索在本章已闭合时给出
6. 每个角色/地点只出现一次，不要重复`;

export interface ChapterInput {
  index: number;
  title: string;
  text: string;
}

/** 单章抽取产物（characters/locations 的 sourceChapterIndex 由 map 层强制为章 index） */
export interface ChapterExtraction {
  chapterIndex: number;
  characters: RawCharacter[];
  locations: RawLocation[];
  timelineHints: TimelineHint[];
  summary: string;
  openThreads: OpenThread[];
}

export interface MapResult {
  results: ChapterExtraction[];
  /** 章节数超过 cap 时为 true（优雅降级，不抛错） */
  degraded: boolean;
  rawResponses: string[];
}

/** 每章抽取的 LLM 返回结构（sourceChapterIndex 字段由 map 层忽略并覆盖） */
export interface ChapterExtractionLLMResponse {
  characters?: Array<{
    name?: string;
    aliases?: string[];
    personalityTags?: string[];
    description?: string;
    isMajor?: boolean;
  }>;
  locations?: Array<{
    name?: string;
    type?: string;
    description?: string;
  }>;
  timelineHints?: Array<{
    timeCue?: string;
    type?: string;
  }>;
  summary?: string;
  openThreads?: Array<{
    id?: string;
    title?: string;
    description?: string;
    endChapterIndex?: number;
  }>;
}

/** 同步字符估算 token 数（与 ContextManager.countTokens 的 fallback 一致） */
export function estimateTokensByChars(text: string): number {
  return Math.ceil(text.length * 1.3);
}

/**
 * Phase1 map 引擎：按章并行抽取，产出每章的实体/摘要/开放线索。
 * - 超长单章按 token 阈值二次分块（复用 splitIntoChunks），逐块抽取后合并该章结果。
 * - 章节数超过 MAP_MAX_CHAPTERS 时只处理前 cap 章并置 degraded=true（优雅降级）。
 */
export async function mapChapters(
  provider: LLMProvider,
  ctxManager: ContextManager,
  chapters: ChapterInput[],
): Promise<MapResult> {
  const degraded = chapters.length > MAP_MAX_CHAPTERS;
  const active = degraded ? chapters.slice(0, MAP_MAX_CHAPTERS) : chapters;
  if (degraded) {
    console.log(
      `[Phase1-map] 章节数 ${chapters.length} 超过 cap ${MAP_MAX_CHAPTERS}，仅处理前 ${MAP_MAX_CHAPTERS} 章（降级模式）`,
    );
  }

  const extracted = await Promise.all(active.map((ch) => extractChapter(provider, ctxManager, ch)));

  return {
    results: extracted.map((e) => e.result),
    degraded,
    rawResponses: extracted.flatMap((e) => e.rawResponses),
  };
}

async function extractChapter(
  provider: LLMProvider,
  ctxManager: ContextManager,
  chapter: ChapterInput,
): Promise<{ result: ChapterExtraction; rawResponses: string[] }> {
  const tokenEstimate = estimateTokensByChars(chapter.text);
  if (tokenEstimate > MAP_CHAPTER_TOKEN_THRESHOLD) {
    const chunks = ctxManager.splitIntoChunks(chapter.text, MAP_CHAPTER_TOKEN_THRESHOLD);
    console.log(
      `[Phase1-map] 章节 #${chapter.index} "${chapter.title}" token 预估 ${tokenEstimate} 超过 ${MAP_CHAPTER_TOKEN_THRESHOLD}，二次分块为 ${chunks.length} 块`,
    );
    const perChunk = await Promise.all(
      chunks.map((chunk, ci) => extractSingle(provider, chapter, chunk, ci)),
    );
    return {
      result: mergeChapterExtractions(chapter.index, perChunk.map((p) => p.result)),
      rawResponses: perChunk.flatMap((p) => p.rawResponses),
    };
  }

  const single = await extractSingle(provider, chapter, chapter.text, 0);
  return { result: single.result, rawResponses: single.rawResponses };
}

/** 单块（整章或分块）的 LLM 抽取调用，含 3 次重试；全部失败时返回空抽取（不崩管线） */
async function extractSingle(
  provider: LLMProvider,
  chapter: ChapterInput,
  text: string,
  chunkIndex: number,
): Promise<{ result: ChapterExtraction; rawResponses: string[] }> {
  const messages: LLMMessage[] = [
    { role: 'system', content: MAP_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `请分析以下章节，提取角色、地点、时间线、摘要与开放线索，以 JSON 输出。\n\n[章节 #${chapter.index} ${chapter.title}${chunkIndex > 0 ? ` · 分块${chunkIndex + 1}` : ''}]\n${text}`,
    },
  ];

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await provider.chat(messages, {
        responseFormat: 'json_object',
        temperature: 0.3,
        maxTokens: 4096,
      });
      const parsed = safeJsonParse(response.content) as ChapterExtractionLLMResponse;
      return {
        result: {
          chapterIndex: chapter.index,
          characters: normalizeCharacters(parsed.characters, chapter.index),
          locations: normalizeLocations(parsed.locations, chapter.index),
          timelineHints: normalizeTimelineHints(parsed.timelineHints, chapter.index),
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          openThreads: normalizeOpenThreads(parsed.openThreads, chapter.index),
        },
        rawResponses: [response.content],
      };
    } catch (err) {
      lastError = err as Error;
      console.log(
        `[Phase1-map] 章节 #${chapter.index}${chunkIndex > 0 ? ` 分块${chunkIndex + 1}` : ''} 尝试 ${attempt + 1}/3 失败: ${lastError.message}`,
      );
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }

  console.log(
    `[Phase1-map] 章节 #${chapter.index} 抽取重试全部失败，返回空结果: ${lastError?.message}`,
  );
  return {
    result: emptyExtraction(chapter.index),
    rawResponses: [],
  };
}

function emptyExtraction(chapterIndex: number): ChapterExtraction {
  return {
    chapterIndex,
    characters: [],
    locations: [],
    timelineHints: [],
    summary: '',
    openThreads: [],
  };
}

/** 分块产物合并为该章结果（sourceChapterIndex 全部强制为章 index，已由 normalize 保证） */
function mergeChapterExtractions(chapterIndex: number, parts: ChapterExtraction[]): ChapterExtraction {
  return {
    chapterIndex,
    characters: parts.flatMap((p) => p.characters),
    locations: parts.flatMap((p) => p.locations),
    timelineHints: parts.flatMap((p) => p.timelineHints),
    summary: parts.map((p) => p.summary.trim()).filter(Boolean).join(' '),
    openThreads: parts.flatMap((p) => p.openThreads),
  };
}

function normalizeCharacters(
  raw: ChapterExtractionLLMResponse['characters'],
  chapterIndex: number,
): RawCharacter[] {
  return (raw || [])
    .filter((c) => typeof c.name === 'string' && c.name.trim() !== '')
    .map((c) => ({
      name: c.name as string,
      aliases: c.aliases ?? [],
      personalityTags: c.personalityTags ?? [],
      description: c.description ?? '',
      isMajor: c.isMajor ?? true,
      // map 层强制：单章内所有实体出处均为本章
      sourceChapterIndex: chapterIndex,
    }));
}

function normalizeLocations(
  raw: ChapterExtractionLLMResponse['locations'],
  chapterIndex: number,
): RawLocation[] {
  return (raw || [])
    .filter((l) => typeof l.name === 'string' && l.name.trim() !== '')
    .map((l) => ({
      name: l.name as string,
      type: (l.type === 'exterior' || l.type === 'abstract' ? l.type : 'interior') as RawLocation['type'],
      description: l.description ?? '',
      sourceChapterIndex: chapterIndex,
    }));
}

function normalizeTimelineHints(
  raw: ChapterExtractionLLMResponse['timelineHints'],
  chapterIndex: number,
): TimelineHint[] {
  return (raw || [])
    .filter((h) => typeof h.timeCue === 'string' && h.timeCue.trim() !== '')
    .map((h) => ({
      chapterIndex,
      timeCue: h.timeCue as string,
      type: (h.type === 'time-jump' || h.type === 'season' ? h.type : 'time-of-day') as TimelineHint['type'],
    }));
}

function normalizeOpenThreads(
  raw: ChapterExtractionLLMResponse['openThreads'],
  chapterIndex: number,
): OpenThread[] {
  return (raw || [])
    .filter((t) => (typeof t.id === 'string' && t.id.trim() !== '') || (typeof t.title === 'string' && t.title.trim() !== ''))
    .map((t) => ({
      id: t.id ?? '',
      title: t.title ?? '',
      description: t.description ?? '',
      startChapterIndex: chapterIndex,
      // endChapterIndex 仅在 LLM 明确给出时保留
      ...(typeof t.endChapterIndex === 'number' ? { endChapterIndex: t.endChapterIndex } : {}),
    }));
}
