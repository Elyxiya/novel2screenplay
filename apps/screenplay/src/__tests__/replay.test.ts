// @vitest-environment node
/**
 * P1.5 单场景回放回归
 *
 * 核心契约：
 * - 回放只读任务：不覆盖已有产物、不改任务状态
 * - 输入重建自 pipelineState + chapterTexts（不是截断过的产物快照）
 * - 返回新旧对比（内容块数 / 置信度 / 是否变化）
 * - 越权、缺产物、场景不存在分别给 403 / 400 / 404
 * - 回放本身也留观测痕迹（trace=replay）
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { getDatabase } from '../lib/store/sqlite/db';
import { jobStore } from '../lib/store/job-store';
import { getRunLogRepository } from '../lib/store/sqlite/run-log-repository';
import { replayScene, ReplayError } from '../lib/debug/replay';
import type { LLMProvider } from '../lib/llm/types';

const createdJobs: string[] = [];

class ReplayProvider {
  readonly name = 'replay-probe';
  readonly modelId = 'replay-probe-model';
  readonly description = 'probe';
  readonly contextWindow = 128000;
  readonly supportedModels = ['replay-probe-model'];
  calls = 0;
  constructor(private descriptionText = '回放生成的新内容。') {}
  supportsJSONMode() { return true; }
  async estimateTokens(t: string) { return Math.ceil(t.length * 1.3); }
  async chat() {
    this.calls += 1;
    return {
      content: JSON.stringify({
        content: [{ type: 'action', description: this.descriptionText, sourceRefs: [] }],
        summary: '新的场景摘要',
        confidence: 0.75,
        timeOfDay: 'night',
      }),
      model: 'replay-probe-model',
      usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
    };
  }
  async *chatStream() { /* 探针不需要流式 */ }
}

function seedJob(opts: { userId?: string; withPhase1?: boolean } = {}) {
  const jobId = jobStore.create({
    novelText: '甲推门而入。',
    chapterTexts: ['甲推门而入。'],
    modelId: 'replay-probe-model',
    selectedChapters: [0],
    temperature: 0.7,
    userId: opts.userId ?? 'user_owner',
  });
  createdJobs.push(jobId);

  jobStore.update(jobId, (j) => ({
    ...j,
    status: 'completed' as const,
    pipelineState: {
      ...j.pipelineState,
      ...(opts.withPhase1 === false
        ? {}
        : {
            phase1Output: {
              characters: [
                { name: '甲', aliases: [], personalityTags: [], description: '主角', isMajor: true, sourceChapterIndex: 0 },
              ],
              locations: [{ name: '屋', type: 'interior' as const, description: '', sourceChapterIndex: 0 }],
              timelineHints: [],
              rawResponse: '',
            },
          }),
      phase2Output: {
        scenes: [
          {
            sceneIndex: 1,
            chapterIndex: 0,
            startParagraph: 0,
            endParagraph: 0,
            originalStartOffset: 0,
            originalEndOffset: 6,
            draftSlugline: '屋 - 夜',
            keyCharacterNames: ['甲'],
            summary: '甲进屋',
          },
        ],
        rawResponses: [],
        stats: { mergedPairs: 0, overlapFixes: 0 },
      },
      phase3Output: [
        {
          sceneNumber: 1,
          slugline: '屋 - 夜',
          timeOfDay: 'night',
          locationId: 'loc_01',
          characterIds: ['char_01'],
          content: [{ type: 'action', description: '首跑生成的旧内容。', sourceRefs: [] }],
          summary: '旧摘要',
          confidence: 0.9,
        },
      ],
    },
  }));

  return jobId;
}

beforeAll(() => {
  getDatabase();
});

afterEach(() => {
  for (const id of createdJobs.splice(0)) jobStore.delete(id);
});

describe('replayScene', () => {
  it('重跑单场景并返回新旧对比', async () => {
    const jobId = seedJob();
    const provider = new ReplayProvider();

    const result = await replayScene({
      jobId,
      sceneIndex: 1,
      userId: 'user_owner',
      provider: provider as unknown as LLMProvider,
    });

    expect(provider.calls).toBe(1);
    expect(result.before?.content[0]).toMatchObject({ description: '首跑生成的旧内容。' });
    expect(result.after.content[0]).toMatchObject({ description: '回放生成的新内容。' });

    expect(result.diff).toMatchObject({
      blocksBefore: 1,
      blocksAfter: 1,
      confidenceBefore: 0.9,
      confidenceAfter: 0.75,
      contentChanged: true,
      summaryChanged: true,
    });
    expect(result.traceId).toContain('replay');
  });

  it('回放不改动任务：产物与状态保持原样', async () => {
    const jobId = seedJob();
    const before = JSON.stringify(jobStore.get(jobId)!.pipelineState.phase3Output);

    await replayScene({
      jobId,
      sceneIndex: 1,
      userId: 'user_owner',
      provider: new ReplayProvider() as unknown as LLMProvider,
    });

    const after = jobStore.get(jobId)!;
    expect(after.status).toBe('completed');
    expect(JSON.stringify(after.pipelineState.phase3Output)).toBe(before);
  });

  it('回放留观测痕迹（replay + phase3.scene 事件）', async () => {
    const jobId = seedJob();
    await replayScene({
      jobId,
      sceneIndex: 1,
      userId: 'user_owner',
      provider: new ReplayProvider() as unknown as LLMProvider,
    });

    const events = getRunLogRepository().listEvents(jobId);
    expect(events.some((e) => e.stage === 'replay')).toBe(true);
    expect(events.some((e) => e.stage === 'phase3.scene')).toBe(true);
    expect(events.some((e) => e.traceId.includes('replay'))).toBe(true);
  });

  it('场景不存在 → 404', async () => {
    const jobId = seedJob();
    await expect(
      replayScene({ jobId, sceneIndex: 99, userId: 'user_owner', provider: new ReplayProvider() as unknown as LLMProvider }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('缺少 Phase1 产物 → 400', async () => {
    const jobId = seedJob({ withPhase1: false });
    await expect(
      replayScene({ jobId, sceneIndex: 1, userId: 'user_owner', provider: new ReplayProvider() as unknown as LLMProvider }),
    ).rejects.toBeInstanceOf(ReplayError);
    await expect(
      replayScene({ jobId, sceneIndex: 1, userId: 'user_owner', provider: new ReplayProvider() as unknown as LLMProvider }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('非归属用户 → 403', async () => {
    const jobId = seedJob({ userId: 'user_owner' });
    await expect(
      replayScene({ jobId, sceneIndex: 1, userId: 'someone_else', provider: new ReplayProvider() as unknown as LLMProvider }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
