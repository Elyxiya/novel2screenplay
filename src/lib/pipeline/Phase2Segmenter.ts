import type { LLMProvider, LLMMessage } from '../llm/types';
import { SYSTEM_PROMPT as SEGMENT_PROMPT } from '../llm/prompts/segment';
import { ContextManager, MAX_SEGMENT_TOKENS } from './ContextManager';
import type { Phase1Output } from './Phase1Analyzer';
import { safeJsonParse } from '../utils/safe-json';

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
    chapterTexts: string[] = [],
  ): Promise<Phase2Output> {
    const allScenes: SceneBoundary[] = [];
    const rawResponses: string[] = [];

    const charsContext = analysis.characters
      .map((c) => `${c.name}（别名: ${c.aliases.join('、') || '无'}）`)
      .join('、');

    console.log(`[Phase2] 开始处理 ${chapters.length} 个章节, 已知角色: ${analysis.characters.length}`);
    for (const chapter of chapters) {
      console.log(`[Phase2]  章节 #${chapter.index}: "${chapter.title}" (${chapter.text.length} 字)`);
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
        console.log(`[Phase2]  章节 #${chapter.index} 调用 LLM...`);
        const t0 = Date.now();
        const response = await this.provider.chat(messages, {
          responseFormat: 'json_object',
          temperature: 0.3,
          maxTokens: 4096,
        });
        const t1 = Date.now();
        console.log(`[Phase2]  章节 #${chapter.index} LLM 返回 (${t1-t0}ms), 长度: ${response.content.length}`);

        rawResponses.push(response.content);
        const parsed = safeJsonParse(response.content) as {
          scenes?: Array<{
            startParagraph?: number;
            endParagraph?: number;
            draftSlugline?: string;
            keyCharacterNames?: string[];
            summary?: string;
          }>;
        };
        const scenes = Array.isArray(parsed) ? parsed : (parsed.scenes || []);

        // Build cumulative offsets for this chapter within the full novel text
        // Use absolute offsets (cumulative across all chapters) for Phase 3 extraction
        const chapterOffset = chapter.index === 0 ? 0 : chapterTexts.slice(0, chapter.index).reduce((sum, t) => sum + t.length, 0);
        const charOffsets = this.calculateCharOffsets(chapter.text);

        console.log(`[Phase2]  章节 #${chapter.index}: 检测到 ${scenes.length} 个场景`);
        for (let i = 0; i < scenes.length; i++) {
          const s = scenes[i];
          // Expand boundary ±1 paragraph for complete capture
          const startIdx2 = Math.max(0, (s.startParagraph ?? 0) - 1);
          const endIdx2 = Math.min((s.endParagraph ?? 0) + 2, charOffsets.length - 1);
          allScenes.push({
            sceneIndex: allScenes.length + 1,
            chapterIndex: chapter.index,
            startParagraph: s.startParagraph ?? 0,
            endParagraph: s.endParagraph ?? 0,
            originalStartOffset: chapterOffset + charOffsets[startIdx2],
            originalEndOffset: chapterOffset + (charOffsets[endIdx2] ?? chapter.text.length),
            draftSlugline: s.draftSlugline || `${chapter.title} - 场景 ${i + 1}`,
            keyCharacterNames: s.keyCharacterNames || [],
            summary: s.summary || '',
          });
        }
      } catch (err) {
        console.log(`[Phase2]  章节 #${chapter.index} LLM 调用失败: ${(err as Error).message}, 使用 fallback`);
        // Fallback: split by empty lines
        rawResponses.push('Fallback: empty line split');
        const fallbackScenes = await this.fallbackSplit(chapter);
        for (const fs of fallbackScenes) {
          allScenes.push(fs);
        }
      }
    }
    console.log(`[Phase2] 所有章节处理完成, 共 ${allScenes.length} 个场景`);

    // Post-processing pipeline:
    // 1. Remove zero-width scenes
    // 2. Merge adjacent short scenes with same time+location
    // 3. Resolve overlapping boundaries (non-overlapping coverage)
    let scenes = allScenes.filter(s => s.originalEndOffset > s.originalStartOffset);
    scenes = this.mergeAdjacentScenes(scenes);
    scenes = this.resolveOverlappingBoundaries(scenes);
    return { scenes, rawResponses };
  }

  /**
   * Fallback: split by empty lines and sentence boundaries.
   */
  private async fallbackSplit(chapter: {
    index: number;
    text: string;
  }): Promise<SceneBoundary[]> {
    const scenes: SceneBoundary[] = [];
    // Use same paragraph split as Phase 3's splitByParagraphs
    const sections = chapter.text.split(/\n\s*\n/).filter(s => s.trim().length > 0);

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
   * Merge adjacent scenes only if they are very short (< 800 chars).
   * This prevents merging distinct events that happen at the same location/time.
   */
  private mergeAdjacentScenes(scenes: SceneBoundary[]): SceneBoundary[] {
    if (scenes.length <= 1) return scenes;

    const MIN_MERGE_CHARS = 800;
    const merged: SceneBoundary[] = [scenes[0]];

    for (let i = 1; i < scenes.length; i++) {
      const last = merged[merged.length - 1];
      const current = scenes[i];

      const lastLen = last.originalEndOffset - last.originalStartOffset;
      const currentLen = current.originalEndOffset - current.originalStartOffset;

      // Only merge if BOTH scenes are short AND share location+time
      const lastLocation = last.draftSlugline.split(' - ')[0] || '';
      const currentLocation = current.draftSlugline.split(' - ')[0] || '';
      const lastTime = last.draftSlugline.split(' - ')[1] || '';
      const currentTime = current.draftSlugline.split(' - ')[1] || '';

      const shouldMerge =
        lastLen < MIN_MERGE_CHARS &&
        currentLen < MIN_MERGE_CHARS &&
        lastLocation === currentLocation &&
        lastTime === currentTime &&
        lastLocation !== '' &&
        currentLocation !== '';

      if (shouldMerge) {
        last.endParagraph = current.endParagraph;
        last.originalEndOffset = current.originalEndOffset;
        last.summary += ' | ' + current.summary;
        const allNames = [...last.keyCharacterNames, ...current.keyCharacterNames];
        last.keyCharacterNames = [...new Set(allNames)];
      } else {
        merged.push(current);
      }
    }

    return merged.map((s, i) => ({ ...s, sceneIndex: i + 1 }));
  }

  /**
   * Resolve overlapping scene boundaries by partitioning text into non-overlapping ranges.
   * Each scene gets exclusive coverage of its character range.
   * If scenes overlap, the later one takes precedence for the overlapping region.
   */
  private resolveOverlappingBoundaries(scenes: SceneBoundary[]): SceneBoundary[] {
    if (scenes.length <= 1) return scenes;

    // Sort by start offset
    const sorted = [...scenes].sort(
      (a, b) => a.originalStartOffset - b.originalStartOffset,
    );

    const resolved: SceneBoundary[] = [];
    let currentEnd = 0;

    for (const scene of sorted) {
      const start = scene.originalStartOffset;
      const end = scene.originalEndOffset;

      if (start < currentEnd) {
        // Overlap detected — truncate this scene to start from where the previous one ended
        if (end > currentEnd) {
          resolved.push({
            ...scene,
            originalStartOffset: currentEnd,
          });
          currentEnd = end;
        }
        // If end <= currentEnd, the scene is completely covered by previous ones — skip it
      } else {
        // No overlap — add as-is
        resolved.push(scene);
        currentEnd = end;
      }
    }

    return resolved.map((s, i) => ({ ...s, sceneIndex: i + 1 }));
  }

  /**
   * Calculate paragraph offsets for the text.
   * A "paragraph" = a block of text separated by blank lines (consistent with Phase 3 splitByParagraphs).
   */
  private calculateCharOffsets(text: string): number[] {
    const offsets: number[] = [0];
    // Split on double newlines (consistent with splitByParagraphs in Phase 3)
    const parts = text.split(/\n\s*\n/);
    let offset = 0;
    for (const part of parts) {
      offsets.push(offset + part.length);
      offset += part.length + 2; // +2 for \n\n separator
    }
    return offsets;
  }
}
