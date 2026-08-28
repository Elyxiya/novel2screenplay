import type { LLMProvider, LLMMessage } from '../llm/types';
import { SYSTEM_PROMPT as ANALYZE_PROMPT } from '../llm/prompts/analyze';
import { ContextManager, MAX_ANALYSIS_TOKENS } from './ContextManager';
import { safeJsonParse } from '../utils/safe-json';
import { mapChapters, MAP_MAX_CHAPTERS, type ChapterInput } from './phase1-map';
import { reduceSetting } from './phase1-reduce';
import type { Phase1Output, TimelineHint } from '@novel/contracts/pipeline';

export type Phase1Mode = 'truncate' | 'mapreduce';

export interface Phase1AnalyzeOptions {
  mode?: Phase1Mode;
}

/** Shape of the JSON response expected from Phase 1 LLM */
interface Phase1LLMResponse {
  characters?: Array<{
    name: string;
    aliases?: string[];
    personalityTags?: string[];
    description?: string;
    isMajor?: boolean;
    sourceChapterIndex?: number;
  }>;
  locations?: Array<{
    name: string;
    type?: 'interior' | 'exterior' | 'abstract';
    description?: string;
    sourceChapterIndex?: number;
  }>;
  timelineHints?: Array<unknown>;
}

// 实体/输出类型统一由 @novel/contracts/pipeline 提供（Re-export 保持导入面兼容）
export type { RawCharacter, RawLocation, TimelineHint, Phase1Output } from '@novel/contracts/pipeline';

/**
 * Phase 1: Analyze novel text to extract characters, locations, and timeline.
 */
export class Phase1Analyzer {
  constructor(
    private provider: LLMProvider,
    private ctxManager: ContextManager,
  ) {}

  async analyze(
    chapters: ChapterInput[],
    options?: Phase1AnalyzeOptions,
  ): Promise<Phase1Output> {
    const effectiveMode: Phase1Mode =
      options?.mode ?? (process.env.PHASE1_MODE === 'mapreduce' ? 'mapreduce' : 'truncate');

    if (effectiveMode === 'mapreduce') {
      // map-reduce 路径异常时回退到旧截断路径，保证不静默崩管线
      try {
        return await this.analyzeMapReduce(chapters);
      } catch (err) {
        console.log(`[Phase1] map-reduce 路径失败，回退 truncate 路径: ${(err as Error).message}`);
        return this.analyzeTruncate(chapters);
      }
    }
    return this.analyzeTruncate(chapters);
  }

  /**
   * baseline：旧截断路径（整本截断到 MAX_ANALYSIS_TOKENS 后单次分析）。
   */
  private async analyzeTruncate(chapters: ChapterInput[]): Promise<Phase1Output> {
    const fullText = chapters
      .map((c) => `[${c.title}]\n${c.text}`)
      .join('\n\n');

    console.log(`[Phase1] 原文长度: ${fullText.length} 字, ${chapters.length} 章`);
    const truncatedText = await this.ctxManager.truncateToTokens(fullText, MAX_ANALYSIS_TOKENS);
    const isTruncated = truncatedText !== fullText;
    console.log(`[Phase1] 截断后: ${truncatedText.length} 字${isTruncated ? ' (已截断)' : ''}`);

    const messages: LLMMessage[] = [
      { role: 'system', content: ANALYZE_PROMPT },
      {
        role: 'user',
        content: `请分析以下小说文本，提取角色、地点和时间线信息。以 JSON 格式输出。\n\n${truncatedText}`,
      },
    ];

    let lastError: Error | null = null;

    // Retry up to 3 times for JSON parse failures
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`[Phase1] 调用 LLM (attempt ${attempt + 1}/3)...`);
        const t0 = Date.now();
        const response = await this.provider.chat(messages, {
          responseFormat: 'json_object',
          temperature: 0.3,
          maxTokens: 4096,
        });
        const t1 = Date.now();
        console.log(`[Phase1] LLM 返回耗时 ${t1 - t0}ms, 输出长度: ${response.content.length}, usage:`, JSON.stringify(response.usage));

        const parsed = safeJsonParse(response.content) as Phase1LLMResponse;
        console.log(`[Phase1] 解析结果: ${parsed.characters?.length ?? 0} 角色, ${parsed.locations?.length ?? 0} 地点`);
        return {
          characters: (parsed.characters || []).map((c) => ({
            name: c.name,
            aliases: c.aliases ?? [],
            personalityTags: c.personalityTags ?? [],
            description: c.description ?? '',
            isMajor: c.isMajor ?? true,
            sourceChapterIndex: c.sourceChapterIndex ?? 0,
          })),
          locations: (parsed.locations || []).map((l) => ({
            name: l.name ?? '',
            description: l.description ?? '',
            type: (l.type ?? 'interior') as 'interior' | 'exterior' | 'abstract',
            sourceChapterIndex: l.sourceChapterIndex ?? 0,
          })),
          timelineHints: (parsed.timelineHints || []) as TimelineHint[],
          rawResponse: response.content,
        };
      } catch (err) {
        lastError = err as Error;
        console.log(`[Phase1] 尝试 ${attempt + 1}/3 失败: ${lastError.message}`);
        // Wait before retry
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    // All retries exhausted: return empty result
    console.log(`[Phase1] 所有重试均失败: ${lastError?.message}`);
    return {
      characters: [],
      locations: [],
      timelineHints: [],
      rawResponse: `分析失败: ${lastError?.message}`,
    };
  }

  /**
   * map-reduce 路径：按章并行抽取 → reduce 归并成全局 Phase1Output。
   * 校验输入为空给出空结果；超限经 mapChapters 内置 cap 优雅降级（degraded）。
   */
  private async analyzeMapReduce(chapters: ChapterInput[]): Promise<Phase1Output> {
    if (chapters.length === 0) {
      console.log('[Phase1-mapreduce] 输入没有章节，返回空结果');
      return {
        characters: [],
        locations: [],
        timelineHints: [],
        rawResponse: 'map-reduce: 空输入',
      };
    }

    const { results, degraded, rawResponses } = await mapChapters(
      this.provider,
      this.ctxManager,
      chapters,
    );

    console.log(
      `[Phase1-mapreduce] 抽取完成: ${results.length} 章, degraded=${degraded}, 抽取角色 ${results.reduce((n, r) => n + r.characters.length, 0)} 个`,
    );

    const reduced = await reduceSetting(this.provider, results, rawResponses);

    console.log(
      `[Phase1-mapreduce] reduce 完成: ${reduced.characters.length} 个合并角色, ` +
        `${reduced.locations.length} 个地点, ` +
        `degraded=${degraded}${degraded ? `（章节数超 cap ${MAP_MAX_CHAPTERS}，已降级处理）` : ''}`,
    );

    // 仅返回 Phase1Output 结构（剥离 aliasIndex/mergeLog 辅助字段）
    return {
      characters: reduced.characters,
      locations: reduced.locations,
      timelineHints: reduced.timelineHints,
      settingCard: reduced.settingCard,
      rawResponse: reduced.rawResponse,
    };
  }
}
