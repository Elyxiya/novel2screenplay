// @vitest-environment node
/**
 * B-09：显式复用历史设定卡（跳过 Phase 1 LLM 分析）
 *
 * 验收口径（计划 §11.3）：mock provider 计数 Phase 1 调用为 0 + 复用产物被沿用。
 * provider 经 llm-gateway 模块级 mock 注入（startJob 内部自行 resolve provider）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDatabase } from '@/lib/store/sqlite/db';
import { getJobRepository } from '@/lib/store/sqlite/job-repository';
import { jobStore } from '@/lib/store/job-store';
import { PipelineEngine } from '@/lib/pipeline/PipelineEngine';
import type { Phase1Output } from '@novel/contracts/pipeline';
import type { LLMMessage } from '@/lib/llm/types';

const hoisted = vi.hoisted(() => ({ analyzeCalls: 0 }));

vi.mock('@/lib/llm/llm-gateway', async () => {
  const { SYSTEM_PROMPT } = await import('@/lib/llm/prompts/analyze');
  const provider = {
    name: 'test',
    modelId: 'test-model',
    description: 'test',
    contextWindow: 32000,
    supportsJSONMode: () => true,
    estimateTokens: async (text: string) => Math.ceil(text.length * 0.5),
    chat: async (messages: LLMMessage[]) => {
      if (messages[0]?.content === SYSTEM_PROMPT) hoisted.analyzeCalls += 1;
      throw new Error('mock-halt'); // 一律拒绝：Phase2 走 fallback、Phase3 走降级
    },
    chatStream: async function* () {},
  };
  return { resolveProvider: () => provider, resolveDefaultProvider: () => provider };
});

const REPO = getJobRepository();
const engine = new PipelineEngine();

function mkPhase1Fixture(): Phase1Output {
  return {
    characters: [
      { name: '林墨', aliases: ['小林'], personalityTags: ['冷静'], description: '主角', isMajor: true, sourceChapterIndex: 0 },
    ],
    locations: [
      { name: '青云山顶', type: 'exterior', description: '山顶', sourceChapterIndex: 0 },
    ],
    timelineHints: [],
    rawResponse: '{"reused":true}',
  };
}

async function waitSettled(jobId: string, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const job = jobStore.get(jobId);
    if (job && (job.status === 'completed' || job.status === 'failed')) return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`任务未在 ${timeoutMs}ms 内结束`);
}

describe('B-09 显式复用设定卡', () => {
  beforeEach(() => {
    getDatabase();
    hoisted.analyzeCalls = 0;
  });

  it('复用来源卡 → Phase1 零调用、产物沿用、管线走完', async () => {
    // 把 Phase3 重试退避与轮询等待压到 0ms，缩短用例时长
    const realSetTimeout = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      ((fn: () => void) => realSetTimeout(fn, 0)) as unknown as typeof setTimeout,
    );
    try {
      const sourceId = REPO.create({
        novelText: '旧文本', chapterTexts: ['旧文本'], modelId: 'm', selectedChapters: [0], temperature: 0.3, userId: 'u1',
      });
      REPO.update(sourceId, { status: 'completed', pipelineState: { phase1Output: mkPhase1Fixture() } });

      const jobId = await engine.startJob({
        novelText: '第一章 开端\n\n正文内容。',
        userId: 'u1',
        reusePhase1FromJobId: sourceId,
      });

      const job = await waitSettled(jobId);

      // 核心验收：Phase 1 的 LLM 调用次数为 0
      expect(hoisted.analyzeCalls).toBe(0);
      // 复用产物被沿用
      expect(job.pipelineState.phase1Output?.characters[0]?.name).toBe('林墨');
      // 审计留痕
      const messages = job.logs.map((l) => l.message).join('\n');
      expect(messages).toContain(`复用设定卡（来源任务 ${sourceId}）`);
      expect(messages).toContain('复用已导入的历史设定卡（跳过 LLM 分析）');
      // 管线仍走完（Phase2 fallback + Phase3 降级 + Phase4 合并）
      expect(job.status).toBe('completed');
    } finally {
      spy.mockRestore();
    }
  });

  it('无权复用他人任务的设定卡 → 拒绝且不建 job', async () => {
    const sourceId = REPO.create({
      novelText: '旧文本', chapterTexts: ['旧文本'], modelId: 'm', selectedChapters: [0], temperature: 0.3, userId: 'owner-1',
    });
    REPO.update(sourceId, { pipelineState: { phase1Output: mkPhase1Fixture() } });

    await expect(
      engine.startJob({ novelText: '第一章 开端\n\n正文。', userId: 'user-2', reusePhase1FromJobId: sourceId }),
    ).rejects.toThrow('无权复用该任务的设定卡');
  });

  it('来源无 Phase1 产物 → 拒绝', async () => {
    const sourceId = REPO.create({
      novelText: '旧文本', chapterTexts: ['旧文本'], modelId: 'm', selectedChapters: [0], temperature: 0.3, userId: 'u1',
    });

    await expect(
      engine.startJob({ novelText: '第一章 开端\n\n正文。', userId: 'u1', reusePhase1FromJobId: sourceId }),
    ).rejects.toThrow('复用的设定卡不存在');
  });
});
