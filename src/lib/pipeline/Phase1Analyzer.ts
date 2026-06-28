import type { LLMProvider, LLMMessage } from '../llm/types';
import { SYSTEM_PROMPT as ANALYZE_PROMPT } from '../llm/prompts/analyze';
import { ContextManager, MAX_ANALYSIS_TOKENS } from './ContextManager';
import { safeJsonParse } from '../utils/safe-json';

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

/** Raw character extracted by Phase 1 */
export interface RawCharacter {
  name: string;
  aliases: string[];
  personalityTags: string[];
  description: string;
  isMajor: boolean;
  sourceChapterIndex: number;
}

/** Raw location extracted by Phase 1 */
export interface RawLocation {
  name: string;
  type: 'interior' | 'exterior' | 'abstract';
  description: string;
  sourceChapterIndex: number;
}

/** Timeline hint extracted by Phase 1 */
export interface TimelineHint {
  chapterIndex: number;
  timeCue: string;
  type: 'time-of-day' | 'time-jump' | 'season';
}

export interface Phase1Output {
  characters: RawCharacter[];
  locations: RawLocation[];
  timelineHints: TimelineHint[];
  rawResponse: string;
}

/**
 * Phase 1: Analyze novel text to extract characters, locations, and timeline.
 */
export class Phase1Analyzer {
  constructor(
    private provider: LLMProvider,
    private ctxManager: ContextManager,
  ) {}

  async analyze(
    chapters: Array<{ index: number; title: string; text: string }>,
  ): Promise<Phase1Output> {
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
}
