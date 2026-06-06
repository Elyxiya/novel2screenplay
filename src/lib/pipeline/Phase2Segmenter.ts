import type { LLMProvider, LLMMessage } from '../llm/types';
import { SYSTEM_PROMPT as SEGMENT_PROMPT } from '../llm/prompts/segment';
import { ContextManager, MAX_SEGMENT_TOKENS } from './ContextManager';
import type { Phase1Output } from './Phase1Analyzer';

/** A scene boundary detected by Phase 2 */
export interface SceneBoundary {
  sceneIndex: number;
  chapterIndex: number;
  startParagraph: number;
  endParagraph: number;
  originalStartOffset: number;
  originalEndOffset: number;
  draftSlugline: string;
  keyCharacterNames: string[];
  summary: string;
}

export interface Phase2Output {
  scenes: SceneBoundary[];
  rawResponses: string[];
}

/**
 * Phase 2: Segment chapters into scenes based on time/location/character changes.
 */
export class Phase2Segmenter {
  constructor(
    private provider: LLMProvider,
    private ctxManager: ContextManager,
  ) {}

  async segment(
    chapters: Array<{ index: number; title: string; text: string }>,
    analysis: Phase1Output,
  ): Promise<Phase2Output> {
    const allScenes: SceneBoundary[] = [];
    const rawResponses: string[] = [];

    const charsContext = analysis.characters
      .map((c) => `${c.name}（别名: ${c.aliases.join('、') || '无'}）`)
      .join('、');

    for (const chapter of chapters) {
      const truncatedText = await this.ctxManager.truncateToTokens(chapter.text, MAX_SEGMENT_TOKENS);

      const messages: LLMMessage[] = [
        { role: 'system', content: SEGMENT_PROMPT },
        {
          role: 'user',
          content: [
            `已知角色: ${charsContext || '未知'}`,
            '',
            `请识别以下章节中的场景边界，输出 JSON 数组。`,
            `每个场景需包含: startParagraph(起始段落索引), endParagraph(结束段落索引), draftSlugline(场景标题), keyCharacterNames(出场角色), summary(摘要)`,
            '',
            truncatedText,
          ].join('\n'),
        },
      ];

      try {
        const response = await this.provider.chat(messages, {
          responseFormat: 'json_object',
          temperature: 0.3,
          maxTokens: 4096,
        });

        rawResponses.push(response.content);
        const parsed = JSON.parse(response.content);
        const scenes = Array.isArray(parsed) ? parsed : parsed.scenes || [];

        // Calculate character offsets for the chapter text
        const charOffsets = this.calculateCharOffsets(chapter.text);

        for (let i = 0; i < scenes.length; i++) {
          const s = scenes[i];
          allScenes.push({
            sceneIndex: allScenes.length + 1,
            chapterIndex: chapter.index,
            startParagraph: s.startParagraph ?? 0,
            endParagraph: s.endParagraph ?? 0,
            originalStartOffset: charOffsets[s.startParagraph ?? 0] ?? 0,
            originalEndOffset: charOffsets[(s.endParagraph ?? 0) + 1] ?? chapter.text.length,
            draftSlugline: s.draftSlugline || `${chapter.title} - 场景 ${i + 1}`,
            keyCharacterNames: s.keyCharacterNames || [],
            summary: s.summary || '',
          });
        }
      } catch {
        // Fallback: split by empty lines
        rawResponses.push('Fallback: empty line split');
        const fallbackScenes = await this.fallbackSplit(chapter);
        for (const fs of fallbackScenes) {
          allScenes.push(fs);
        }
      }
    }

    // Post-processing: merge adjacent scenes with same time+location
    return {
      scenes: this.mergeAdjacentScenes(allScenes),
      rawResponses,
    };
  }

  /**
   * Fallback: split by empty lines and sentence boundaries.
   */
  private async fallbackSplit(chapter: {
    index: number;
    text: string;
  }): Promise<SceneBoundary[]> {
    const scenes: SceneBoundary[] = [];
    const sections = chapter.text.split(/\n\n+/);
    const charOffsets = this.calculateCharOffsets(chapter.text);

    let globalSceneIndex = 0;
    let charOffset = 0;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section.trim().length === 0) continue;

      // Check if too long ( >1500 tokens)
      const tokenCount = await this.ctxManager.countTokens(section);
      if (tokenCount > 1500) {
        // Split by sentence boundaries
        const sentences = section.split(/(?<=[。！？\n])/);
        for (const sentence of sentences) {
          if (sentence.trim().length === 0) continue;
          scenes.push({
            sceneIndex: globalSceneIndex + 1,
            chapterIndex: chapter.index,
            startParagraph: i,
            endParagraph: i,
            originalStartOffset: charOffset,
            originalEndOffset: charOffset + sentence.length,
            draftSlugline: `场景 ${globalSceneIndex + 1}`,
            keyCharacterNames: [],
            summary: sentence.slice(0, 50) + '...',
          });
          globalSceneIndex++;
          charOffset += sentence.length;
        }
      } else {
        scenes.push({
          sceneIndex: globalSceneIndex + 1,
          chapterIndex: chapter.index,
          startParagraph: i,
          endParagraph: i,
          originalStartOffset: charOffset,
          originalEndOffset: charOffset + section.length,
          draftSlugline: `场景 ${globalSceneIndex + 1}`,
          keyCharacterNames: [],
          summary: section.slice(0, 50) + '...',
        });
        globalSceneIndex++;
        charOffset += section.length + 2; // +2 for \n\n
      }
    }

    return scenes;
  }

  /**
   * Merge adjacent scenes that share the same time and location.
   */
  private mergeAdjacentScenes(scenes: SceneBoundary[]): SceneBoundary[] {
    if (scenes.length <= 1) return scenes;

    const merged: SceneBoundary[] = [scenes[0]];

    for (let i = 1; i < scenes.length; i++) {
      const last = merged[merged.length - 1];
      const current = scenes[i];

      // Extract location from slugline
      const lastLocation = last.draftSlugline.split(' - ')[0] || '';
      const currentLocation = current.draftSlugline.split(' - ')[0] || '';

      // Extract time from slugline
      const lastTime = last.draftSlugline.split(' - ')[1] || '';
      const currentTime = current.draftSlugline.split(' - ')[1] || '';

      // If same location and time (or both unknown), merge
      if (
        lastLocation === currentLocation &&
        lastTime === currentTime &&
        lastLocation !== '' &&
        currentLocation !== ''
      ) {
        last.endParagraph = current.endParagraph;
        last.originalEndOffset = current.originalEndOffset;
        last.summary += ' | ' + current.summary;
        // Merge character names
        const allNames = [...last.keyCharacterNames, ...current.keyCharacterNames];
        last.keyCharacterNames = [...new Set(allNames)];
      } else {
        merged.push(current);
      }
    }

    // Re-index
    return merged.map((s, i) => ({ ...s, sceneIndex: i + 1 }));
  }

  /**
   * Calculate character offsets for each paragraph in the text.
   */
  private calculateCharOffsets(text: string): number[] {
    const offsets: number[] = [0];
    const paragraphs = text.split('\n');
    let offset = 0;
    for (const p of paragraphs) {
      offset += p.length + 1; // +1 for \n
      offsets.push(offset);
    }
    return offsets;
  }
}
