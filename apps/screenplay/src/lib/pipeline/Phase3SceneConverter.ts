import type { LLMProvider, LLMMessage } from '../llm/types';
import { SYSTEM_PROMPT as CONVERT_PROMPT } from '../llm/prompts/convert-scene';
import { ContextManager } from './ContextManager';
import type { SceneBoundary, RawCharacter, RawLocation, Phase3Output, SettingCard } from '@novel/contracts/pipeline';
import { TokenBucket } from '../llm/rate-limiter';
import type { JobStore } from '../store/job-store';
import { safeJsonParse, looksTruncated } from '../utils/safe-json';
import { BudgetController, getBudgetController } from '../llm/adapter/budget-controller';
import {
  resolveKeyCharacters,
  selectSceneCharacters,
  buildRollingSummary,
  buildOpenThreadContext,
} from './phase3-context';

/** Task 3 convertScenes 可选增强上下文（向后兼容，未传则行为与改造前一致） */
export interface Phase3ConvertOptions {
  /** map-reduce 路径的全局设定卡（章节摘要 + open threads），驱动 3.2 上下文注入 */
  settingCard?: SettingCard;
}

// 类型统一由 @novel/contracts/pipeline 提供（Re-export 保持导入面兼容）
export type { SceneBoundary, RawCharacter, RawLocation, Phase3Output } from '@novel/contracts/pipeline';

// ── Heuristic scene splitting ──

function splitByParagraphs(text: string): string[] {
  // Split on double newlines (blank-line paragraph breaks, standard for Chinese novels)
  const paras = text.split(/\n\s*\n/);
  return paras.filter(p => p.trim().length > 0);
}

function splitBySentenceBoundaries(text: string): string[] {
  // Split on sentence-ending punctuation in Chinese
  const sentences = text.split(/(?<=[。！？！？\n])/);
  return sentences.filter(s => s.trim().length > 0);
}

function mergeIntoChunks(paragraphs: string[], targetCharsPerChunk: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
  let currentLen = 0;

  for (const para of paragraphs) {
    if (currentLen + para.length > targetCharsPerChunk && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
      currentLen = 0;
    }
    currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + para;
    currentLen += para.length;
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

/**
 * Split long scene text into smaller chunks suitable for LLM conversion.
 * Priority: split on blank-line paragraphs → sentence boundaries → chunks.
 */
async function splitSceneText(text: string): Promise<string[]> {
  // Strategy 1: Split by paragraphs (blank lines) and group into ~4000-char chunks
  const paras = splitByParagraphs(text);
  const charChunks = mergeIntoChunks(paras, 4000);

  if (charChunks.length > 1) {
    return charChunks;
  }

  // Strategy 2: If single chunk but still long, split by sentence boundaries
  if (text.length > 4000) {
    const sentences = splitBySentenceBoundaries(text);
    return mergeIntoChunks(sentences, 4000);
  }

  return [text];
}

// ── Content sanitization ──

function sanitizeContent(content: unknown[]): Array<{
  type: 'action' | 'dialogue';
  description?: string;
  characterId?: string;
  line?: string;
  direction?: string;
  sourceRefs: Array<{ chapterIndex: number; paragraphIndex: number; excerpt: string }>;
}> {
  return content.map(item => {
    const c = item as Record<string, unknown>;
    const type = c.type as string;

    if (type === 'action') {
      return {
        type: 'action' as const,
        description: String(c.description || ''),
        sourceRefs: (c.sourceRefs as Array<{ chapterIndex: number; paragraphIndex: number; excerpt: string }>) || [],
      };
    }

    if (type === 'dialogue') {
      const characterId = c.characterId as string | undefined;
      const line = c.line as string | undefined;
      const direction = c.direction as string | undefined;
      const sourceRefs = (c.sourceRefs as Array<{ chapterIndex: number; paragraphIndex: number; excerpt: string }>) || [];

      if (!characterId || !line) {
        // Dialogue without required fields → convert to action
        return {
          type: 'action' as const,
          description: String(c.description || line || '[内容缺失]'),
          sourceRefs,
        };
      }

      return {
        type: 'dialogue' as const,
        characterId,
        line,
        direction: direction || undefined,
        sourceRefs,
      };
    }

    // Unknown type → treat as action
    return {
      type: 'action' as const,
      description: String(c.description || c.line || '[未知内容]'),
      sourceRefs: (c.sourceRefs as Array<{ chapterIndex: number; paragraphIndex: number; excerpt: string }>) || [],
    };
  });
}

// ── Semaphore ──

class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.current < this.max) { this.current++; return; }
    return new Promise(r => this.queue.push(r));
  }
  release(): void { const n = this.queue.shift(); if (n) n(); else this.current--; }
  async run<T>(fn: () => Promise<T>): Promise<T> { await this.acquire(); try { return await fn(); } finally { this.release(); } }
}

// ── timeOfDay normalization ──

const VALID_TIME_OF_DAY = new Set(['dawn', 'morning', 'afternoon', 'dusk', 'night', 'late-night', 'unknown']);

const TIME_OF_DAY_FALLBACKS: Record<string, string> = {
  day: 'afternoon',
  daytime: 'afternoon',
  日: 'afternoon',
  白天: 'afternoon',
  中午: 'afternoon',
  noon: 'afternoon',
  早晨: 'morning',
  早上: 'morning',
  上午: 'morning',
  清晨: 'dawn',
  黎明: 'dawn',
  黄昏: 'dusk',
  傍晚: 'dusk',
  晚上: 'night',
  夜晚: 'night',
  深夜: 'late-night',
  midnight: 'late-night',
};

function normalizeTimeOfDay(value: unknown): string {
  const normalized = String(value ?? '').toLowerCase().trim();
  if (VALID_TIME_OF_DAY.has(normalized)) return normalized;
  if (TIME_OF_DAY_FALLBACKS[normalized]) return TIME_OF_DAY_FALLBACKS[normalized];
  return 'unknown';
}

// ── Phase 3 Converter ──

export class Phase3SceneConverter {
  private semaphore = new Semaphore(3);
  private rateLimiter = new TokenBucket(50, 60_000);

  constructor(
    private provider: LLMProvider,
    private ctxManager: ContextManager,
    private budgetController: BudgetController = getBudgetController(),
  ) {}

  private buildCharIdMap(characters: RawCharacter[]): Map<string, string> {
    const map = new Map<string, string>();
    characters.forEach((c, i) => {
      const id = `char_${String(i + 1).padStart(2, '0')}`;
      map.set(c.name, id);
      c.aliases.forEach(a => map.set(a, id));
    });
    return map;
  }

  /**
   * Normalize generic character names to canonical forms.
   * This prevents the same generic role (e.g. "围观者") from creating
   * duplicate character stubs in Phase 4.
   */
  private normalizeGenericCharId(charId: string): string {
    if (charId === '围观者' || charId.startsWith('围观者') || charId.startsWith('围观群众') || charId.includes('围观')) {
      return '围观者';
    }
    if (charId === '测验员' || charId.startsWith('测验员') || charId.includes('测验')) {
      return '测验员';
    }
    if (charId.includes('长老') && !charId.includes('二长老')) return '长老';
    if (charId === '二长老') return '二长老';
    if (charId.includes('墨管家') || charId.includes('管家')) return '墨管家';
    return charId;
  }

  /** Convert one text chunk into a Phase3Output (with retry) */
  private async convertText(
    label: string, partText: string, scene: SceneBoundary,
    charContext: string, locContext: string,
    charIdMap: Map<string, string>, jobStore: JobStore, jobId: string,
    abortSignal?: AbortSignal,
    summaries?: string, threads?: string,
  ): Promise<Phase3Output> {
    const contextParts = [
      `角色: ${charContext}`,
      `地点: ${locContext}`,
      `标题: ${scene.draftSlugline}`,
      `摘要: ${scene.summary}`,
    ];
    if (summaries) contextParts.push(`前情摘要:\n${summaries}`);
    if (threads) contextParts.push(`伏笔线索:\n${threads}`);
    contextParts.push('', partText);
    const messages: LLMMessage[] = [
      { role: 'system', content: CONVERT_PROMPT },
      { role: 'user', content: contextParts.join('\n') },
    ];

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`[Phase3]  ${label} 调用 LLM (attempt ${attempt + 1}/3), 输入文本: ${partText.length} 字`);
        const t0 = Date.now();
        const response = await this.provider.chat(messages, {
          responseFormat: 'json_object', temperature: 0.5, maxTokens: 16384, signal: abortSignal,
        });
        const t1 = Date.now();
        console.log(`[Phase3]  ${label} LLM 返回 (${t1-t0}ms), 输出: ${response.content.length} 字符, usage: ${response.usage ? `输入${response.usage.promptTokens}+输出${response.usage.completionTokens}` : 'N/A'}`);
        this.recordUsage(jobStore, jobId, response.usage || {}, partText.length);

        const parsed = safeJsonParse(response.content) as Record<string, unknown>;
        console.log(`[Phase3]  ${label} 解析结果: keys=[${Object.keys(parsed).join(',')}], error=${parsed.error ?? '无'}, confidence=${parsed.confidence}, hasContent=${'content' in parsed}`);

        // Check for explicit insufficient context
        if (parsed.error === 'insufficient_context') {
          console.log(`[Phase3]  ${label} LLM 报告信息不足`);
          throw new Error('LLM 报告原文信息不足');
        }

        // Check for truncation
        if (looksTruncated(parsed)) {
          console.log(`[Phase3]  ${label} looksTruncated=true (content=${JSON.stringify(parsed.content).slice(0, 100)})`);
          throw new Error('LLM 输出被截断，内容可能不完整');
        }

        const rawContent = parsed.content as unknown[] || [];
        console.log(`[Phase3]  ${label} content: ${Array.isArray(parsed.content) ? `数组[${parsed.content.length}]` : typeof parsed.content}`);
        const content = sanitizeContent(rawContent.map((b: unknown) => {
          const block = b as Record<string, unknown>;
          const rawCharId = String(block.characterId || '');
          // First try to map to a known character, then normalize generic names
          const mappedId = rawCharId
            ? (charIdMap.get(rawCharId) || this.normalizeGenericCharId(rawCharId))
            : undefined;
          return {
            ...block,
            characterId: mappedId,
          };
        }));

        const summary = parsed.summary as string || scene.summary;
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;
        console.log(`[Phase3]  ${label} FINAL: content=${content.length}条, summary=${summary.slice(0,30)}, confidence=${confidence}`);

        return {
          sceneNumber: scene.sceneIndex,
          slugline: scene.draftSlugline,
          timeOfDay: normalizeTimeOfDay(parsed.timeOfDay),
          locationId: `loc_${String(scene.chapterIndex + 1).padStart(2, '0')}`,
          characterIds: (scene.keyCharacterNames || []).map(n => charIdMap.get(n) || n),
          content,
          summary,
          confidence,
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        lastError = err as Error;
        console.log(`[Phase3]  ${label} 尝试 ${attempt + 1}/3 失败: ${lastError.message}`);
        jobStore.update(jobId, j => ({
          ...j, logs: [...j.logs, { timestamp: Date.now(), level: 'warn' as const, message: `${label} 尝试 ${attempt + 1}/3 失败: ${lastError!.message.slice(0, 150)}` }],
        }));
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    // All retries failed
    jobStore.update(jobId, j => ({
      ...j, scenesStatus: (j.scenesStatus || []).map(s => s.sceneIndex === scene.sceneIndex ? { ...s, status: 'failed' as const } : s),
    }));
    return this.degradedScene(scene, `转换失败: ${lastError?.message}`);
  }

  /**
   * Build scene-scoped character/location context.
   * Characters are filtered by the scene's keyCharacterNames (name + alias
   * match); locations by the scene's chapterIndex. Falls back to the full
   * list when filtering yields nothing, so context is never empty.
   *
   * Task 3 增强（传入 settingCard 时启用）：主角卡常驻 + 配角按键 + 前 N 章
   * 滚动摘要 + open threads 按章节区间注入。未传 settingCard 行为与改造前一致。
   */
  private buildSceneContext(
    scene: SceneBoundary,
    characters: RawCharacter[],
    locations: RawLocation[],
    charIdMap: Map<string, string>,
    settingCard?: SettingCard,
  ): { chars: string; locs: string; charKept: number; charTotal: number; locKept: number; locTotal: number; summaries: string; threads: string } {
    let charsForCtx: RawCharacter[];
    let charKept: number;
    if (settingCard) {
      const sel = selectSceneCharacters(scene, characters);
      charsForCtx = sel.kept;
      charKept = sel.kept.length;
    } else {
      const byName = new Map<string, RawCharacter>();
      for (const c of characters) {
        byName.set(c.name, c);
        c.aliases.forEach(a => byName.set(a, c));
      }
      const keptNames = new Set<string>();
      for (const n of scene.keyCharacterNames || []) {
        const c = byName.get(n);
        if (c) keptNames.add(c.name);
      }
      const keptChars = characters.filter(c => keptNames.has(c.name));
      charsForCtx = keptChars.length > 0 ? keptChars : characters;
      charKept = keptChars.length;
    }

    const keptLocs = locations.filter(l => l.sourceChapterIndex === scene.chapterIndex);
    const locsForCtx = keptLocs.length > 0 ? keptLocs : locations;

    const chars = charsForCtx
      .map(c => `${charIdMap.get(c.name)}=${c.name}(${c.description?.slice(0, 20) || ''})`)
      .join(', ');
    const locs = locsForCtx
      .map(l => `loc_${String(l.sourceChapterIndex + 1).padStart(2, '0')}=${l.name}(${l.type})`)
      .join(', ');

    const summaries = buildRollingSummary(settingCard, scene.chapterIndex);
    const threads = buildOpenThreadContext(settingCard, scene.chapterIndex);

    return {
      chars, locs,
      charKept, charTotal: characters.length,
      locKept: keptLocs.length, locTotal: locations.length,
      summaries, threads,
    };
  }

  /** Accumulate LLM usage into job metadata for token-efficiency evaluation. */
  private recordUsage(jobStore: JobStore, jobId: string, usage: { promptTokens?: number; completionTokens?: number }, inputChars: number): void {
    if (!usage.promptTokens && !usage.completionTokens) return;
    jobStore.update(jobId, j => {
      const meta = (j.metadata || {}) as Record<string, unknown>;
      const prev = (meta.usage || {}) as { promptTokens?: number; completionTokens?: number; inputChars?: number; calls?: number };
      meta.usage = {
        promptTokens: (prev.promptTokens || 0) + (usage.promptTokens || 0),
        completionTokens: (prev.completionTokens || 0) + (usage.completionTokens || 0),
        inputChars: (prev.inputChars || 0) + inputChars,
        calls: (prev.calls || 0) + 1,
      };
      return { ...j, metadata: meta };
    });
  }

  /** 估算本场景一次转换的全部输入 token（上下文 + 正文 + system prompt 余量） */
  private async estimateScenePromptTokens(
    sceneCtx: { chars: string; locs: string; summaries: string; threads: string },
    scene: SceneBoundary,
    parts: string[],
  ): Promise<number> {
    const ctxText = `角色: ${sceneCtx.chars}\n地点: ${sceneCtx.locs}\n标题: ${scene.draftSlugline}\n摘要: ${scene.summary}\n前情摘要: ${sceneCtx.summaries}\n伏笔线索: ${sceneCtx.threads}`;
    const ctxTokens = await this.ctxManager.countTokens(ctxText);
    let bodyTokens = 0;
    for (const p of parts) bodyTokens += await this.ctxManager.countTokens(p);
    return ctxTokens + bodyTokens + 1000; // + system prompt 余量
  }

  /** 预算超限拦截：记入 metadata.budgetBlocked 计数 + warn 日志（不调 LLM） */
  private recordBudgetBlocked(jobStore: JobStore, jobId: string, scene: SceneBoundary, reason?: string): void {
    jobStore.update(jobId, j => {
      const meta = (j.metadata || {}) as Record<string, unknown>;
      const prev = (meta.budgetBlocked as number) || 0;
      meta.budgetBlocked = prev + 1;
      return {
        ...j,
        metadata: meta,
        logs: [...j.logs, { timestamp: Date.now(), level: 'warn' as const, message: `场景 #${scene.sceneIndex} 预算超限已拦截: ${reason ?? '未知'}` }],
      };
    });
  }

  /** 3.1 占位率测点：未解析出 char_N 的在场角色名累计进 metadata.placeholder */
  private recordPlaceholder(
    jobStore: JobStore,
    jobId: string,
    scene: SceneBoundary,
    charIdMap: Map<string, string>,
  ): void {
    const resolve = resolveKeyCharacters(scene.keyCharacterNames || [], charIdMap);
    if (resolve.unresolved.length === 0) return;
    jobStore.update(jobId, j => {
      const meta = (j.metadata || {}) as Record<string, unknown>;
      const prev = (meta.placeholder || {}) as { total: number; unresolved: number };
      meta.placeholder = {
        total: (prev.total || 0) + resolve.resolved.length + resolve.unresolved.length,
        unresolved: (prev.unresolved || 0) + resolve.unresolved.length,
      };
      return { ...j, metadata: meta };
    });
  }

  async convertScenes(
    scenes: SceneBoundary[], characters: RawCharacter[], locations: RawLocation[],
    chapterTexts: string[], jobStore: JobStore, jobId: string,
    abortSignal?: AbortSignal,
    opts?: Phase3ConvertOptions,
  ): Promise<Phase3Output[]> {
    const charIdMap = this.buildCharIdMap(characters);
    console.log(`[Phase3] 开始转换 ${scenes.length} 个场景, semaphore=3, rateLimit=50/min`);

    // Initialize job progress
    jobStore.update(jobId, j => ({
      ...j, subProgress: { totalScenes: scenes.length, completedScenes: 0 },
      scenesStatus: scenes.map(s => ({ sceneIndex: s.sceneIndex, status: 'pending' as const })),
      currentPhase: 3, status: 'converting' as const,
    }));

    const tasks = scenes.map((scene) => async () => this.semaphore.run(async () => {
      if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await this.rateLimiter.wait(abortSignal);

      // Scene-scoped context: filter characters by keyCharacterNames,
      // locations by chapterIndex (falls back to full lists when empty).
      // Task 3：传入 settingCard 时启用主角常驻 + 滚动摘要 + open threads 注入。
      const sceneCtx = this.buildSceneContext(scene, characters, locations, charIdMap, opts?.settingCard);
      if (sceneCtx.charKept < sceneCtx.charTotal || sceneCtx.locKept < sceneCtx.locTotal) {
        console.log(`[Phase3]  场景 #${scene.sceneIndex} 上下文裁剪: 角色 ${sceneCtx.charKept}/${sceneCtx.charTotal}, 地点 ${sceneCtx.locKept}/${sceneCtx.locTotal}`);
      }

      // 3.1 显式 name→charN 解析：未命中名计入占位率（metadata 测点）
      this.recordPlaceholder(jobStore, jobId, scene, charIdMap);

      const chapterText = chapterTexts[scene.chapterIndex] || '';
      const sceneText = chapterText.slice(scene.originalStartOffset, scene.originalEndOffset);

      // Split long scene text into manageable chunks
      const parts = await splitSceneText(sceneText);

      if (parts.length > 1) {
        jobStore.update(jobId, j => ({
          ...j, logs: [...j.logs, { timestamp: Date.now(), level: 'info' as const, message: `场景 #${scene.sceneIndex} 拆分为 ${parts.length} 个子场景` }],
        }));
      }

      // 3.3 预算守卫：估算本场景输入 token，超限整场景降级、不调 LLM（真实拦截）
      const estPrompt = await this.estimateScenePromptTokens(sceneCtx, scene, parts);
      const check = this.budgetController.canRequest(this.provider.modelId, {
        promptTokens: estPrompt,
        completionTokens: 8192,
        totalTokens: estPrompt + 8192,
      });
      if (!check.allowed) {
        this.recordBudgetBlocked(jobStore, jobId, scene, check.reason);
        return this.degradedScene(scene, `预算超限已拦截: ${check.reason}`);
      }

      // Convert each part
      const convResults: Phase3Output[] = [];
      for (let pi = 0; pi < parts.length; pi++) {
        const label = parts.length > 1 ? `场景 #${scene.sceneIndex}[${pi + 1}/${parts.length}]` : `场景 #${scene.sceneIndex}`;
        const result = await this.convertText(label, parts[pi], scene, sceneCtx.chars, sceneCtx.locs, charIdMap, jobStore, jobId, abortSignal, sceneCtx.summaries, sceneCtx.threads);
        convResults.push(result);
      }

      // Merge results from multiple parts
      const merged: Phase3Output = {
        ...convResults[0],
        content: convResults.flatMap(r => r.content),
        confidence: Math.min(...convResults.map(r => r.confidence)),
      };

      // Update progress
      jobStore.update(jobId, j => {
        const prevSubProgress = j.subProgress as { totalScenes: number; completedScenes: number } | undefined;
        return {
          ...j, 
          subProgress: { totalScenes: scenes.length, completedScenes: (prevSubProgress?.completedScenes ?? 0) + 1 },
          scenesStatus: (j.scenesStatus || []).map(s => s.sceneIndex === scene.sceneIndex ? { ...s, status: 'completed' as const } : s),
          logs: [...j.logs, { timestamp: Date.now(), level: 'info' as const, message: `场景 #${scene.sceneIndex} 完成（${merged.content.length} 条，置信度 ${merged.confidence}）` }],
        };
      });

      return merged;
    }));

    const results = await Promise.allSettled(tasks.map(t => t()));
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return this.degradedScene(scenes[i], '请求被取消或异常终止');
    });
  }

  private degradedScene(scene: SceneBoundary, reason: string): Phase3Output {
    return {
      sceneNumber: scene.sceneIndex, slugline: scene.draftSlugline, timeOfDay: 'unknown',
      locationId: 'loc_00', characterIds: [],
      content: [{ type: 'action', description: `[场景转换失败: ${reason}]`, sourceRefs: [] }],
      summary: scene.summary, confidence: 0.1,
    };
  }
}
