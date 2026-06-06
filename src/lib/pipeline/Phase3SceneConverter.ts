import type { LLMProvider, LLMMessage } from '../llm/types';
import { SYSTEM_PROMPT as CONVERT_PROMPT } from '../llm/prompts/convert-scene';
import { ContextManager } from './ContextManager';
import type { SceneBoundary } from './Phase2Segmenter';
import type { RawCharacter, RawLocation } from './Phase1Analyzer';
import { TokenBucket } from '../llm/rate-limiter';
import type { JobStore } from '../store/job-store';
import { safeJsonParse } from '../utils/safe-json';

/** A converted scene from Phase 3 */
export interface Phase3Output {
  sceneNumber: number;
  slugline: string;
  timeOfDay: string;
  locationId: string;
  characterIds: string[];
  content: Array<{
    type: 'action' | 'dialogue';
    description?: string;
    characterId?: string;
    line?: string;
    direction?: string;
    sourceRefs: Array<{ chapterIndex: number; paragraphIndex: number; excerpt: string }>;
  }>;
  summary: string;
  confidence: number;
}

/** Simple semaphore for concurrency control */
class Semaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.current--;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Phase 3: Convert each scene into structured screenplay content.
 * Runs in parallel with concurrency control.
 */
export class Phase3SceneConverter {
  private semaphore = new Semaphore(3);
  private rateLimiter = new TokenBucket(50, 60_000);

  constructor(
    private provider: LLMProvider,
    private ctxManager: ContextManager,
  ) {}

  async convertScenes(
    scenes: SceneBoundary[],
    characters: RawCharacter[],
    locations: RawLocation[],
    chapterTexts: string[],
    jobStore: JobStore,
    jobId: string,
    abortSignal?: AbortSignal,
  ): Promise<Phase3Output[]> {
    // Initialize scene status
    jobStore.update(jobId, (job) => ({
      ...job,
      subProgress: { totalScenes: scenes.length, completedScenes: 0 },
      scenesStatus: scenes.map((s) => ({
        sceneIndex: s.sceneIndex,
        status: 'pending' as const,
      })),
      currentPhase: 3,
      status: 'converting' as const,
    }));

    const charContext = characters
      .map((c) => `${c.name}（${c.description || '未知'}）`)
      .join('、');

    const locContext = locations
      .map((l) => `${l.name}（${l.description || '未知'}）`)
      .join('、');

    const tasks = scenes.map((scene) => async () => {
      return this.semaphore.run(async () => {
        if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');

        await this.rateLimiter.wait(abortSignal);

        // Get scene text from chapter — use full scene, no truncation
        const chapterText = chapterTexts[scene.chapterIndex] || '';
        const sceneText = chapterText.slice(scene.originalStartOffset, scene.originalEndOffset);

        // Only truncate if it exceeds the model's total context window (65536 for DeepSeek)
        const totalPrompt = charContext.length + locContext.length + sceneText.length + 2000;
        const truncatedText = totalPrompt > 50000
          ? sceneText.slice(0, 40000) + '\n\n[注意：场景原文过长已截断]'
          : sceneText;

        const messages: LLMMessage[] = [
          { role: 'system', content: CONVERT_PROMPT },
          {
            role: 'user',
            content: [
              `角色: ${charContext || '未知'}`,
              `地点: ${locContext || '未知'}`,
              `场景标题: ${scene.draftSlugline}`,
              `场景摘要: ${scene.summary}`,
              '',
              `请将以下小说片段转换为剧本格式，输出 JSON。`,
              `要求：`,
              `1. 动作描写使用现在时，描述可见可听的内容`,
              `2. 对白保留原文措辞`,
              `3. 每个块需标注 sourceRefs`,
              `4. 在原文无对白处适当补充动作描写`,
              '',
              truncatedText,
            ].join('\n'),
          },
        ];

        let lastError: Error | null = null;

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await this.provider.chat(messages, {
              responseFormat: 'json_object',
              temperature: 0.5,
              maxTokens: 16384,
              signal: abortSignal,
            });

            const parsed = safeJsonParse(response.content) as any;

            // Map character names to IDs (temporary - Phase 4 will resolve)
            const charIdMap = this.buildCharIdMap(characters);
            const content = (parsed.content || []).map((block: Record<string, unknown>) => ({
              ...block,
              characterId: block.characterId
                ? charIdMap.get(block.characterId as string) || block.characterId
                : undefined,
            }));

            const result: Phase3Output = {
              sceneNumber: scene.sceneIndex,
              slugline: scene.draftSlugline,
              timeOfDay: parsed.timeOfDay || 'unknown',
              locationId: `loc_${String(scene.chapterIndex + 1).padStart(2, '0')}`,
              characterIds: (scene.keyCharacterNames || []).map(
                (n) => charIdMap.get(n) || n,
              ),
              content,
              summary: scene.summary,
              confidence: parsed.confidence ?? 0.8,
            };

            // Update job progress
            jobStore.update(jobId, (job) => ({
              ...job,
              subProgress: {
                totalScenes: scenes.length,
                completedScenes: (job.subProgress?.completedScenes ?? 0) + 1,
              },
              scenesStatus: (job.scenesStatus || []).map((s) =>
                s.sceneIndex === scene.sceneIndex
                  ? { ...s, status: 'completed' as const }
                  : s,
              ),
              logs: [
                ...job.logs,
                {
                  timestamp: Date.now(),
                  level: 'info' as const,
                  message: `场景 #${scene.sceneIndex} 转换完成（置信度: ${result.confidence}）`,
                },
              ],
            }));

            return result;
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              throw err;
            }
            lastError = err as Error;
            // Log the error for debugging (response preview if available)
            const errMsg = (err as Error).message;
            jobStore.update(jobId, (job) => ({
              ...job,
              logs: [...job.logs, {
                timestamp: Date.now(),
                level: 'warn' as const,
                message: `场景 #${scene.sceneIndex} 尝试 ${attempt + 1}/3 失败: ${errMsg.slice(0, 200)}`,
              }],
            }));
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }

        // Mark as failed after all retries
        jobStore.update(jobId, (job) => ({
          ...job,
          scenesStatus: (job.scenesStatus || []).map((s) =>
            s.sceneIndex === scene.sceneIndex
              ? { ...s, status: 'failed' as const }
              : s,
          ),
        }));

        // Return degraded scene
        return this.degradedScene(scene, `转换失败: ${lastError?.message}`);
      });
    });

    const results = await Promise.allSettled(tasks.map((t) => t()));
    const outputs = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return this.degradedScene(scenes[i], '请求被取消或异常终止');
    });

    return outputs;
  }

  private degradedScene(scene: SceneBoundary, reason: string): Phase3Output {
    return {
      sceneNumber: scene.sceneIndex,
      slugline: scene.draftSlugline,
      timeOfDay: 'unknown',
      locationId: 'loc_00',
      characterIds: [],
      content: [
        {
          type: 'action',
          description: `[场景转换失败，请重试或重新生成。原因: ${reason}]`,
          sourceRefs: [],
        },
      ],
      summary: scene.summary,
      confidence: 0.1,
    };
  }

  private buildCharIdMap(characters: RawCharacter[]): Map<string, string> {
    const map = new Map<string, string>();
    characters.forEach((c, i) => {
      const id = `char_${String(i + 1).padStart(2, '0')}`;
      map.set(c.name, id);
      c.aliases.forEach((a) => map.set(a, id));
    });
    return map;
  }
}
