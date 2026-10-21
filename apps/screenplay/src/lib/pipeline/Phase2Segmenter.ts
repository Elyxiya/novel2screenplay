import type { LLMProvider, LLMMessage } from '../llm/types';
import { SYSTEM_PROMPT as SEGMENT_PROMPT } from '../llm/prompts/segment';
import { ContextManager, MAX_SCENE_TOKENS, MAX_SEGMENT_TOKENS } from './ContextManager';
import { groupParagraphsIntoScenes, splitParagraphsWithOffsets } from './phase2-fallback';
import { safeJsonParse } from '../utils/safe-json';
import type { Phase1Output, Phase2Output, SceneBoundary } from '@novel/contracts/pipeline';
import { isAbortError, throwIfAborted } from './cancel-registry';
import { recordArtifact, startSpan, type RunLogContext } from '../observability/run-log';

// 类型统一由 @novel/contracts/pipeline 提供（Re-export 保持导入面兼容）
export type { Phase1Output, Phase2Output, SceneBoundary } from '@novel/contracts/pipeline';

/**
 * Phase2 切分温度。默认 0.3（与历史行为一致）；`PHASE2_TEMPERATURE=0` 可用于消融实验。
 * 非法值回退默认并告警——静默回退会让实验条件与记录不符。
 */
export function resolvePhase2Temperature(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PHASE2_TEMPERATURE;
  if (raw === undefined || raw === '') return 0.3;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 2) {
    console.warn(`[Phase2] PHASE2_TEMPERATURE=${raw} 非法（需 0–2），回退 0.3`);
    return 0.3;
  }
  return n;
}

/**
 * Phase 2: Segment chapters into scenes based on time/location/character changes.
 */
export class Phase2Segmenter {
  /** FIX-03：后处理事件计数（每次 segment() 开始时重置） */
  private postProcessStats = { mergedPairs: 0, overlapFixes: 0 };

  constructor(
    private provider: LLMProvider,
    private ctxManager: ContextManager,
  ) {}

  async segment(
    chapters: Array<{ index: number; title: string; text: string }>,
    analysis: Phase1Output,
    signal?: AbortSignal,
    runLog?: RunLogContext,
  ): Promise<Phase2Output> {
    const allScenes: SceneBoundary[] = [];
    const rawResponses: string[] = [];

    console.log(`[Phase2] 开始处理 ${chapters.length} 个章节, 已知角色: ${analysis.characters.length}`);
    for (const chapter of chapters) {
      // P0：逐章检查取消，避免取消后继续为剩余章节发起 LLM 调用
      throwIfAborted(signal);
      // P1：逐章 span——「哪一章切歪了」看这里
      const span = runLog
        ? startSpan({ ctx: runLog, stage: 'phase2.chapter', phase: 2, startPayload: { chapter: chapter.index } })
        : null;
      console.log(`[Phase2]  章节 #${chapter.index}: "${chapter.title}" (${chapter.text.length} 字)`);
      const truncatedText = await this.ctxManager.truncateToTokens(chapter.text, MAX_SEGMENT_TOKENS);

      // Chapter-scoped character context: only characters introduced in this
      // chapter, falling back to the full list when filtering yields nothing.
      const chapterChars = analysis.characters.filter(c => c.sourceChapterIndex === chapter.index);
      const charsForCtx = chapterChars.length > 0 ? chapterChars : analysis.characters;
      if (charsForCtx.length < analysis.characters.length) {
        console.log(`[Phase2]  章节 #${chapter.index} 角色裁剪: ${charsForCtx.length}/${analysis.characters.length}`);
      }
      const charsContext = charsForCtx
        .map((c) => `${c.name}（别名: ${c.aliases.join('、') || '无'}）`)
        .join('、');

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
          // 温度是切分稳定性的直接来源（跨运行 P2 F1 只有 0.56–0.70）。
          // 用 env 暴露出来是为了做消融实验；默认值保持 0.3，零行为变化。
          temperature: resolvePhase2Temperature(),
          maxTokens: 4096,
          signal,
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

        // Calculate paragraph offsets within this chapter (relative to chapter start).
        // These offsets are chapter-local; Phase 3 extracts text from each chapter independently.
        const charOffsets = this.calculateCharOffsets(chapter.text);

        console.log(`[Phase2]  章节 #${chapter.index}: 检测到 ${scenes.length} 个场景`);
        span?.end({
          chapter: chapter.index,
          scenes: scenes.length,
          truncated: truncatedText !== chapter.text,
          chars: chapter.text.length,
        });
        if (runLog) {
          recordArtifact({
            ctx: runLog,
            stage: 'phase2.chapter',
            sceneIndex: chapter.index,
            outputText: response.content,
            meta: { chapter: chapter.index, scenes: scenes.length },
          });
        }
        // 模型的行号可能比我们数出来的行数大（空行/截断差异），甚至给出原书章号级别的越界值。
        // 超出时按比例缩放到本文实际行数，避免整章所有场景都退化成 [0, 全文]。
        const lineCount = Math.max(charOffsets.length - 1, 1);
        const maxEnd = scenes.reduce((m, s) => Math.max(m, Number(s.endParagraph) || 0), 0);
        const scale = maxEnd > lineCount ? lineCount / (maxEnd + 1) : 1;
        const mapIdx = (n: number): number => Math.min(Math.max(Math.round(n * scale), 0), lineCount);

        for (let i = 0; i < scenes.length; i++) {
          const s = scenes[i];
          const rawStart = mapIdx(s.startParagraph ?? 0);
          const rawEnd = mapIdx(s.endParagraph ?? 0);
          // Expand boundary ±1 paragraph for complete capture，并夹紧到实际行数范围。
          const lastIdx = charOffsets.length - 1;
          const startIdx2 = Math.min(Math.max(0, rawStart - 1), lastIdx);
          const endIdx2 = Math.min(Math.max(rawEnd + 2, startIdx2), lastIdx);
          const originalStartOffset = charOffsets[startIdx2] ?? 0;
          const originalEndOffset = charOffsets[endIdx2] ?? chapter.text.length;
          if (originalEndOffset <= originalStartOffset) {
            console.warn(`[Phase2]  章节 #${chapter.index} 场景 ${i + 1} 区间为空（${rawStart}-${rawEnd}），已跳过`);
            continue;
          }
          allScenes.push({
            sceneIndex: allScenes.length + 1,
            chapterIndex: chapter.index,
            startParagraph: rawStart,
            endParagraph: rawEnd,
            // Chapter-local offsets — used by Phase 3 to slice from the correct chapter
            originalStartOffset,
            originalEndOffset,
            draftSlugline: s.draftSlugline || `${chapter.title} - 场景 ${i + 1}`,
            keyCharacterNames: s.keyCharacterNames || [],
            summary: s.summary || '',
          });
        }
      } catch (err) {
        // P0：取消不是失败，不能降级成 fallback 继续跑
        if (isAbortError(err)) throw err;
        console.log(`[Phase2]  章节 #${chapter.index} LLM 调用失败: ${(err as Error).message}, 使用 fallback`);
        span?.event('degrade', {
          chapter: chapter.index,
          reason: 'llm_failed',
          error: (err as Error).message.slice(0, 300),
        }, { level: 'warn' });
        rawResponses.push('Fallback: empty line split');
        const fallbackScenes = await this.fallbackSplit(chapter);
        for (const fs of fallbackScenes) {
          allScenes.push(fs);
        }
        span?.end({ chapter: chapter.index, scenes: fallbackScenes.length, fallback: true });
      }
    }
    console.log(`[Phase2] 所有章节处理完成, 共 ${allScenes.length} 个场景`);

    // Post-processing: run within each chapter independently to avoid cross-chapter offset collision.
    // Each chapter's offsets start from 0, so we must NOT run resolveOverlappingBoundaries
    // on the global flat list. Instead, group by chapter and resolve per-chapter.
    // FIX-03：后处理事件计数（过程信息，读时不可复现 → 随产物落库）
    this.postProcessStats = { mergedPairs: 0, overlapFixes: 0 };
    let scenes = allScenes.filter(s => s.originalEndOffset > s.originalStartOffset);
    scenes = this.mergeAdjacentScenes(scenes);
    scenes = this.resolveOverlappingPerChapter(scenes);
    console.log(`[Phase2] 场景后处理完成, 最终 ${scenes.length} 个场景（合并 ${this.postProcessStats.mergedPairs}、重叠修正 ${this.postProcessStats.overlapFixes}）`);
    return { scenes, rawResponses, stats: { ...this.postProcessStats } };
  }

  /**
   * Fallback：LLM 切分不可用时的兜底。
   *
   * 口径必须与主路径一致：**段落 = 一个非空行**。旧实现按空行分块，
   * 段号会指向块序号而不是行号，后续按段号取原文会错位且不报错。
   */
  private async fallbackSplit(chapter: {
    index: number;
    text: string;
  }): Promise<SceneBoundary[]> {
    const paragraphs = splitParagraphsWithOffsets(chapter.text);
    if (paragraphs.length === 0) return [];

    const tokens = await Promise.all(
      paragraphs.map((p) => this.ctxManager.countTokens(p.text)),
    );
    const spans = groupParagraphsIntoScenes(paragraphs, tokens, MAX_SCENE_TOKENS);

    return spans.map((span, i) => ({
      sceneIndex: i + 1,
      chapterIndex: chapter.index,
      startParagraph: span.startParagraph,
      endParagraph: span.endParagraph,
      originalStartOffset: span.originalStartOffset,
      originalEndOffset: span.originalEndOffset,
      draftSlugline: `场景 ${i + 1}`,
      keyCharacterNames: [],
      summary: span.summary,
    }));
  }

  /**
   * Merge adjacent scenes only if they are very short (< 800 chars).
   */
  private mergeAdjacentScenes(scenes: SceneBoundary[]): SceneBoundary[] {
    if (scenes.length <= 1) return scenes;

    const before = scenes.length;

    const MIN_MERGE_CHARS = 800;
    const merged: SceneBoundary[] = [scenes[0]];

    for (let i = 1; i < scenes.length; i++) {
      const last = merged[merged.length - 1];
      const current = scenes[i];

      const lastLen = last.originalEndOffset - last.originalStartOffset;
      const currentLen = current.originalEndOffset - current.originalStartOffset;

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

    this.postProcessStats.mergedPairs += before - merged.length;

    return merged.map((s, i) => ({ ...s, sceneIndex: i + 1 }));
  }

  /**
   * Resolve overlapping scene boundaries WITHIN EACH CHAPTER independently.
   *
   * CRITICAL: Offsets are chapter-local (each chapter starts at 0).
   * We must NOT run the global resolve on all scenes — that would incorrectly
   * treat chapter-0's offsets (e.g. 0–2000) as overlapping with chapter-1's
   * offsets (also 0–3000), destroying all scenes after chapter 0.
   *
   * By resolving per-chapter, we only fix overlaps WITHIN a chapter, not across chapters.
   */
  private resolveOverlappingPerChapter(scenes: SceneBoundary[]): SceneBoundary[] {
    const byChapter = new Map<number, SceneBoundary[]>();
    for (const scene of scenes) {
      const list = byChapter.get(scene.chapterIndex) ?? [];
      list.push(scene);
      byChapter.set(scene.chapterIndex, list);
    }

    const resolved: SceneBoundary[] = [];
    let globalIndex = 0;

    for (const [, chapterScenes] of [...byChapter.entries()].sort((a, b) => a[0] - b[0])) {
      const sorted = [...chapterScenes].sort(
        (a, b) => a.originalStartOffset - b.originalStartOffset,
      );

      let currentEnd = 0;
      for (const scene of sorted) {
        const start = scene.originalStartOffset;
        const end = scene.originalEndOffset;

        if (start < currentEnd) {
          // Overlap detected — truncate this scene to start from where the previous one ended
          this.postProcessStats.overlapFixes += 1;
          if (end > currentEnd) {
            resolved.push({ ...scene, sceneIndex: ++globalIndex });
            currentEnd = end;
          }
          // If end <= currentEnd, scene is fully covered — skip
        } else {
          resolved.push({ ...scene, sceneIndex: ++globalIndex });
          currentEnd = end;
        }
      }
    }

    return resolved;
  }

  /**
   * 计算「每个非空行」结束位置的字符偏移（章节内坐标）。
   *
   * P0：不再假设「段落分隔符恒为 2 字符」，改为在原文里定位真实位置。
   * P1（实测 doupo-short）：段落口径必须与模型一致——中文网文几乎都是**单换行分段**，
   * 按「空行分块」数段落会把整章算成 1 段，而模型按行返回 startParagraph/endParagraph；
   * 越界索引经兜底后让整章所有场景退化成 [0, 全文]，后处理只留第一个（32 → 10）。
   * 因此统一为「非空行 = 一段」，与模型看到的粒度一致。
   */
  private calculateCharOffsets(text: string): number[] {
    const offsets: number[] = [0];
    const lineRe = /[^\n]+/g;
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(text)) !== null) {
      if (!m[0].trim()) continue;
      offsets.push(m.index + m[0].length);
    }
    return offsets;
  }
}
