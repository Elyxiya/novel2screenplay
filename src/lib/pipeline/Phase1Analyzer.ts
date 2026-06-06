import type { LLMProvider, LLMMessage } from '../llm/types';
import { SYSTEM_PROMPT as ANALYZE_PROMPT } from '../llm/prompts/analyze';
import { ContextManager, MAX_ANALYSIS_TOKENS } from './ContextManager';

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

    const truncatedText = this.ctxManager.truncateToTokens(fullText, MAX_ANALYSIS_TOKENS);

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
        const response = await this.provider.chat(messages, {
          responseFormat: 'json_object',
          temperature: 0.3,
          maxTokens: 4096,
        });

        const parsed = JSON.parse(response.content);
        return {
          characters: (parsed.characters || []).map((c: RawCharacter, i: number) => ({
            ...c,
            isMajor: c.isMajor ?? true,
            sourceChapterIndex: c.sourceChapterIndex ?? 0,
          })),
          locations: (parsed.locations || []).map((l: RawLocation) => ({
            ...l,
            type: l.type ?? 'interior',
          })),
          timelineHints: parsed.timelineHints || [],
          rawResponse: response.content,
        };
      } catch (err) {
        lastError = err as Error;
        // Wait before retry
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    // All retries exhausted: return empty result
    return {
      characters: [],
      locations: [],
      timelineHints: [],
      rawResponse: `分析失败: ${lastError?.message}`,
    };
  }
}
