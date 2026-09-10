import { describe, it, expect } from 'vitest';
import {
  aggregateJobMetrics,
  countFallback,
  countUnverified,
  parseErrorCode,
} from '@/lib/jobs/metrics';
import type { StoredJob } from '@/lib/store/job-store';
import type { JobMetrics } from '@/lib/pipeline/metrics';
import type { Screenplay } from '@novel/contracts/screenplay';

// ── Fixtures ──────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 1, 10, 0, 0); // 2026-09-01T10:00:00Z

function mkMetrics(over: Partial<JobMetrics> = {}): JobMetrics {
  return {
    version: 1,
    usage: { promptTokens: 0, completionTokens: 0, inputChars: 0, calls: 0 },
    budgetBlocked: 0,
    placeholder: { total: 0, unresolved: 0 },
    phaseTimings: {},
    updatedAt: T0,
    ...over,
  };
}

function mkJob(over: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 'job_1',
    type: 'conversion',
    status: 'completed',
    progress: 100,
    retryCount: 0,
    maxRetries: 3,
    createdAt: T0,
    scenesStatus: [],
    logs: [],
    novelText: 'x',
    chapterTexts: ['x'],
    config: { modelId: 'm', selectedChapters: [0], temperature: 0.7 },
    pipelineState: {},
    ...over,
  };
}

/** 构造最小剧本：每个元素 = 一个场景，refs 数组长度 = 块数（0 = 空 sourceRefs 块） */
function mkScreenplay(scenes: Array<{ refs: number[]; confidence?: number }>): Screenplay {
  return {
    formatVersion: 'novel2screenplay-v1',
    metadata: {
      title: 't',
      author: '',
      sourceNovel: '',
      version: '1.0.0',
      createdAt: '2026-09-01T00:00:00.000Z',
      totalScenes: scenes.length,
      totalCharacters: 0,
      totalLocations: 0,
    },
    characters: [],
    locations: [],
    scenes: scenes.map((s, i) => ({
      sceneNumber: i + 1,
      slugline: '内景. 客厅 - 夜',
      timeOfDay: 'night' as const,
      locationId: 'loc_01',
      characterIds: [],
      content: s.refs.map((n) => ({
        type: 'action' as const,
        description: '动作',
        sourceRefs: n > 0 ? [{ chapterIndex: 0, paragraphIndex: 0, excerpt: 'e' }] : [],
      })),
      summary: '',
      ...(typeof s.confidence === 'number' ? { confidence: s.confidence } : {}),
    })),
    analytics: { totalWords: 0, dialoguePercentage: 0, actionPercentage: 0, avgSceneLength: 0, longestScene: 0, shortestScene: 0 },
  };
}

// ── 读时聚合单项 ───────────────────────────────────────────────────────────

describe('countFallback（FIX-01 读时聚合）', () => {
  it('统计 rawResponses 中的 Fallback 标记与总章数', () => {
    const out = countFallback({
      scenes: [],
      rawResponses: ['{}', 'Fallback: empty line split', '{}', 'Fallback: empty line split'],
    });
    expect(out).toEqual({ fallbackChapters: 2, totalChapters: 4 });
  });

  it('无 phase2Output → 全零', () => {
    expect(countFallback(undefined)).toEqual({ fallbackChapters: 0, totalChapters: 0 });
  });
});

describe('countUnverified（FIX-02 读时聚合）', () => {
  it('空 sourceRefs 块 / 低置信场景 / 缺置信场景分别计数', () => {
    const sp = mkScreenplay([
      { refs: [1, 1], confidence: 0.9 },
      { refs: [0], confidence: 0.4 },
      { refs: [] }, // 无 confidence + 无块
    ]);
    const out = countUnverified(sp);
    expect(out.emptyRefBlocks).toBe(1);
    expect(out.totalBlocks).toBe(3);
    expect(out.lowConfScenes).toBe(1);
    expect(out.unknownConfScenes).toBe(1);
    expect(out.totalScenes).toBe(3);
  });

  it('无 phase4Output → 全零', () => {
    expect(countUnverified(undefined)).toEqual({
      emptyRefBlocks: 0,
      totalBlocks: 0,
      lowConfScenes: 0,
      unknownConfScenes: 0,
      totalScenes: 0,
    });
  });
});

describe('parseErrorCode（前向兼容 FIX-22）', () => {
  it('结构化 JSON → 取 code', () => {
    expect(parseErrorCode(JSON.stringify({ code: 'rate_limit', httpStatus: 429 }))).toBe('rate_limit');
  });

  it('旧字符串 → legacy；无 error → null', () => {
    expect(parseErrorCode('未配置 LLM Provider')).toBe('legacy');
    expect(parseErrorCode(undefined)).toBeNull();
  });
});

// ── 整体聚合 ──────────────────────────────────────────────────────────────

describe('aggregateJobMetrics', () => {
  const window = { from: T0 - 7 * DAY, to: T0 + DAY, days: 7 };

  it('混合状态 → 计数与成功率；耗时取完成任务的完成-开始', () => {
    const jobs = [
      mkJob({ id: 'a', status: 'completed', startedAt: T0, completedAt: T0 + 1000 }),
      mkJob({ id: 'b', status: 'completed', startedAt: T0, completedAt: T0 + 2000 }),
      mkJob({ id: 'c', status: 'completed', startedAt: T0, completedAt: T0 + 3000 }),
      mkJob({ id: 'd', status: 'completed', startedAt: T0, completedAt: T0 + 4000 }),
      mkJob({ id: 'e', status: 'failed' }),
      mkJob({ id: 'f', status: 'converting' }),
    ];
    const s = aggregateJobMetrics(jobs, window);

    expect(s.totals).toEqual({ jobs: 6, completed: 4, failed: 1, active: 1, pending: 0, successRate: 0.8 });
    expect(s.duration.samples).toBe(4);
    expect(s.duration.p50).toBe(2000);
    expect(s.duration.p95).toBe(4000);
    expect(s.duration.avg).toBe(2500);
  });

  it('metrics 跨 job 汇总（token/预算拦截/占位）', () => {
    const jobs = [
      mkJob({
        id: 'a',
        pipelineState: {
          metrics: mkMetrics({
            usage: { promptTokens: 100, completionTokens: 20, inputChars: 500, calls: 2 },
            budgetBlocked: 1,
            placeholder: { total: 4, unresolved: 1 },
          }),
        },
      }),
      mkJob({
        id: 'b',
        pipelineState: {
          metrics: mkMetrics({
            usage: { promptTokens: 50, completionTokens: 10, inputChars: 200, calls: 1 },
            placeholder: { total: 6, unresolved: 2 },
          }),
        },
      }),
    ];
    const s = aggregateJobMetrics(jobs, window);

    expect(s.tokens).toEqual({ promptTokens: 150, completionTokens: 30, totalTokens: 180, inputChars: 700, calls: 3 });
    expect(s.budgetBlocked).toBe(1);
    expect(s.placeholder).toEqual({ total: 10, unresolved: 3, rate: 0.3 });
  });

  it('fallback / unverified / errorCodes 跨 job 汇总', () => {
    const jobs = [
      mkJob({
        id: 'a',
        error: JSON.stringify({ code: 'rate_limit' }),
        pipelineState: {
          phase2Output: { scenes: [], rawResponses: ['{}', 'Fallback: empty line split'] },
          phase4Output: mkScreenplay([{ refs: [1] }, { refs: [0], confidence: 0.4 }]),
        },
      }),
      mkJob({
        id: 'b',
        status: 'failed',
        error: '模型调用超时',
        pipelineState: {
          phase2Output: { scenes: [], rawResponses: ['{}'] },
        },
      }),
    ];
    const s = aggregateJobMetrics(jobs, window);

    expect(s.fallback).toEqual({ fallbackChapters: 1, totalChapters: 3, rate: Number((1 / 3).toFixed(4)) });
    expect(s.unverified.emptyRefBlocks).toBe(1);
    expect(s.unverified.lowConfScenes).toBe(1);
    expect(s.errorCodes).toEqual({ rate_limit: 1, legacy: 1 });
  });

  it('series 按完成日期（UTC）分桶', () => {
    const jobs = [
      mkJob({ id: 'a', status: 'completed', completedAt: Date.UTC(2026, 8, 1, 12) }),
      mkJob({ id: 'b', status: 'failed', completedAt: Date.UTC(2026, 8, 1, 13) }),
      mkJob({ id: 'c', status: 'completed', completedAt: Date.UTC(2026, 8, 2, 9) }),
    ];
    const s = aggregateJobMetrics(jobs, window);

    expect(s.series).toEqual([
      { date: '2026-09-01', jobs: 2, completed: 1, failed: 1 },
      { date: '2026-09-02', jobs: 1, completed: 1, failed: 0 },
    ]);
  });

  it('空列表 → 零值与 null 率', () => {
    const s = aggregateJobMetrics([], window);

    expect(s.totals.successRate).toBeNull();
    expect(s.duration).toEqual({ samples: 0, p50: null, p95: null, avg: null });
    expect(s.placeholder.rate).toBeNull();
    expect(s.fallback.rate).toBeNull();
    expect(s.series).toEqual([]);
  });
});
