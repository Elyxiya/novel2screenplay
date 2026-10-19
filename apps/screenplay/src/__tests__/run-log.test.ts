// @vitest-environment node
/**
 * P1 观测层回归：事件流 / 产物快照 / 聚合 / 裁剪 / 级联删除
 *
 * 关注点不是「写进去了」，而是几条硬约束：
 * - 事件写入失败不能影响转换（旁路）
 * - payload 必须脱敏、超长必须仍是合法 JSON
 * - 产物只留失败/降级 + 采样，不能无限增长
 * - 删任务必须级联清理，否则孤儿数据会一直累积
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { getDatabase } from '../lib/store/sqlite/db';
import { getJobRepository } from '../lib/store/sqlite/job-repository';
import { getRunLogRepository, type RunEventRow } from '../lib/store/sqlite/run-log-repository';
import {
  recordArtifact,
  recordRunEvent,
  startSpan,
  summarizeByStage,
  type RunLogContext,
} from '../lib/observability/run-log';

const ctx: RunLogContext = { jobId: 'job_observability_test', traceId: 'tr_test_1' };

beforeAll(() => {
  getDatabase();
});

beforeEach(() => {
  getRunLogRepository().deleteByJob(ctx.jobId);
});

function payloadOf(raw: string | null): Record<string, unknown> {
  return JSON.parse(raw ?? '{}') as Record<string, unknown>;
}

describe('run_events 写入与读取', () => {
  it('往返保留 stage / sceneIndex / 耗时 / token / payload', () => {
    recordRunEvent({
      ctx,
      stage: 'phase1.map',
      phase: 1,
      sceneIndex: 2,
      event: 'end',
      payload: { chapter: 2, characters: 3 },
      latencyMs: 12,
      promptTokens: 100,
      completionTokens: 50,
    });

    const events = getRunLogRepository().listEvents(ctx.jobId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      jobId: ctx.jobId,
      traceId: ctx.traceId,
      phase: 1,
      sceneIndex: 2,
      stage: 'phase1.map',
      event: 'end',
      level: 'info',
      latencyMs: 12,
      promptTokens: 100,
      completionTokens: 50,
    });
    expect(payloadOf(events[0].payload)).toEqual({ chapter: 2, characters: 3 });
  });

  it('payload 脱敏：API Key / 邮箱被打码', () => {
    recordRunEvent({
      ctx,
      stage: 'pipeline',
      phase: 0,
      event: 'error',
      level: 'error',
      payload: { apiKey: 'sk-abcdefgh12345678', contact: 'someone@example.com' },
    });

    const [e] = getRunLogRepository().listEvents(ctx.jobId);
    const p = payloadOf(e.payload);
    expect(p.apiKey).toBe('sk-***');
    expect(p.contact).toBe('***@***');
  });

  it('超长 payload 截断后仍是合法 JSON，并标记 _truncated', () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 12; i++) big[`k${i}`] = 'x'.repeat(500);

    recordRunEvent({ ctx, stage: 'phase3.scene', phase: 3, event: 'end', payload: big });

    const [e] = getRunLogRepository().listEvents(ctx.jobId);
    const p = payloadOf(e.payload);
    expect(p._truncated).toBe(true);
    expect(typeof p.size).toBe('number');
  });

  it('事件 id 单调递增，保证时间线顺序稳定', () => {
    for (let i = 0; i < 5; i++) {
      recordRunEvent({ ctx, stage: 'phase3.scene', phase: 3, sceneIndex: i + 1, event: 'end' });
    }
    const ids = getRunLogRepository().listEvents(ctx.jobId).map((e) => e.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('startSpan.end 记录耗时与结束事件', async () => {
    const span = startSpan({ ctx, stage: 'phase2.chapter', phase: 2, emitStart: true });
    await new Promise((r) => setTimeout(r, 5));
    span.end({ scenes: 3 });

    const events = getRunLogRepository().listEvents(ctx.jobId);
    expect(events.map((e) => e.event)).toEqual(['start', 'end']);
    const end = events[1];
    expect(typeof end.latencyMs).toBe('number');
    expect(end.latencyMs).toBeGreaterThanOrEqual(0);
    expect(payloadOf(end.payload)).toEqual({ scenes: 3 });
  });

  it('startSpan.fail 记 error 级别并带错误信息', () => {
    const span = startSpan({ ctx, stage: 'phase3.scene', phase: 3, sceneIndex: 7 });
    span.fail(new Error('boom'), { scene: 7 });

    const [e] = getRunLogRepository().listEvents(ctx.jobId);
    expect(e.event).toBe('error');
    expect(e.level).toBe('error');
    expect(payloadOf(e.payload)).toMatchObject({ scene: 7, error: 'boom' });
  });
});

describe('stage_artifacts 采样与裁剪', () => {
  it('未命中采样的成功场景不落库；force 一定落库', () => {
    recordArtifact({ ctx, stage: 'phase3.scene', sceneIndex: 3, inputText: 'in', outputText: 'out' });
    expect(getRunLogRepository().listArtifacts(ctx.jobId)).toHaveLength(0);

    recordArtifact({ ctx, stage: 'phase3.scene', sceneIndex: 3, inputText: 'in', outputText: 'out', force: true });
    expect(getRunLogRepository().listArtifacts(ctx.jobId)).toHaveLength(1);
  });

  it('产物正文截断并脱敏', () => {
    recordArtifact({
      ctx,
      stage: 'phase3.scene',
      sceneIndex: 1,
      inputText: 'k sk-abcdefgh12345678',
      outputText: 'y'.repeat(9000),
    });

    const [a] = getRunLogRepository().listArtifacts(ctx.jobId);
    expect(a.inputText).toBe('k sk-***');
    expect(a.outputText).toContain('[已截断');
    expect(a.outputText!.length).toBeLessThan(9000);
  });

  it('pruneJob 保留最近 N 条，其余删除', () => {
    for (let i = 0; i < 10; i++) {
      recordRunEvent({ ctx, stage: 'phase3.scene', phase: 3, sceneIndex: i, event: 'end' });
    }
    getRunLogRepository().pruneJob(ctx.jobId, 3, 0);

    const events = getRunLogRepository().listEvents(ctx.jobId);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.sceneIndex)).toEqual([7, 8, 9]);
  });
});

describe('删除任务级联清理', () => {
  it('jobs.delete 同时清掉 run_events / stage_artifacts', () => {
    const jobRepo = getJobRepository();
    const jobId = jobRepo.create({
      novelText: 'x',
      chapterTexts: ['x'],
      modelId: 'm',
      selectedChapters: [0],
      temperature: 0.7,
    });
    const jobCtx: RunLogContext = { jobId, traceId: 'tr_cascade' };
    recordRunEvent({ ctx: jobCtx, stage: 'pipeline', phase: 0, event: 'start' });
    recordArtifact({ ctx: jobCtx, stage: 'phase3.scene', sceneIndex: 1, outputText: 'o', force: true });

    jobRepo.delete(jobId);

    expect(getRunLogRepository().listEvents(jobId)).toHaveLength(0);
    expect(getRunLogRepository().listArtifacts(jobId)).toHaveLength(0);
  });
});

describe('summarizeByStage（纯函数）', () => {  it('按 stage 聚合错误/警告/耗时分位/token，只把 end 计入耗时', () => {
    const base: Omit<RunEventRow, 'id' | 'stage' | 'event' | 'level' | 'latencyMs'> = {
      jobId: 'j',
      traceId: 't',
      phase: 3,
      sceneIndex: 1,
      payload: null,
      promptTokens: 0,
      completionTokens: 0,
      createdAt: 1,
    };
    const rows: RunEventRow[] = [
      { ...base, id: '1', stage: 'phase3.scene', event: 'end', level: 'info', latencyMs: 100, promptTokens: 10 },
      { ...base, id: '2', stage: 'phase3.scene', event: 'end', level: 'info', latencyMs: 300, completionTokens: 20 },
      { ...base, id: '3', stage: 'phase3.scene', event: 'retry', level: 'warn', latencyMs: 9999 },
      { ...base, id: '4', stage: 'phase3.scene', event: 'degrade', level: 'error', latencyMs: 9999 },
      { ...base, id: '5', stage: 'phase1.map', phase: 1, event: 'end', level: 'info', latencyMs: 50 },
    ];

    const summary = summarizeByStage(rows);
    expect(summary.map((s) => s.stage)).toEqual(['phase1.map', 'phase3.scene']);

    const p3 = summary[1];
    expect(p3.count).toBe(4);
    expect(p3.errors).toBe(1);
    expect(p3.warns).toBe(1);
    // 只统计 end 的 100 / 300，retry 与 degrade 的 9999 不计入
    expect(p3.totalLatencyMs).toBe(400);
    expect(p3.p50LatencyMs).toBe(100);
    expect(p3.p95LatencyMs).toBe(300);
    expect(p3.promptTokens).toBe(10);
    expect(p3.completionTokens).toBe(20);
  });
});

describe('管线埋点（端到端）', () => {
  class ProbeProvider {
    readonly name = 'run-log-probe';
    readonly modelId = 'run-log-probe-model';
    readonly description = 'probe';
    readonly contextWindow = 128000;
    readonly supportedModels = ['run-log-probe-model'];
    calls = 0;
    supportsJSONMode() { return true; }
    async estimateTokens(t: string) { return Math.ceil(t.length * 1.3); }
    async chat() {
      this.calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return {
        content: JSON.stringify({
          characters: [{ name: '甲', aliases: [], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 0 }],
          locations: [{ name: '屋', type: 'interior', description: '', sourceChapterIndex: 0 }],
          timelineHints: [],
          scenes: [{ startParagraph: 0, endParagraph: 1, draftSlugline: '屋 - 夜', keyCharacterNames: ['甲'], summary: '甲进屋' }],
          content: [{ type: 'action', description: '甲推门而入。', sourceRefs: [] }],
          summary: '甲进屋',
          confidence: 0.9,
          timeOfDay: 'night',
        }),
        model: 'run-log-probe-model',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      };
    }
    async *chatStream() { /* 探针不需要流式 */ }
  }

  it('一次成功转换产出四阶段事件与阶段产物', async () => {
    const { PipelineEngine } = await import('../lib/pipeline/PipelineEngine');
    const { jobStore } = await import('../lib/store/job-store');
    const { llmRegistry } = await import('../lib/llm/registry');
    const provider = new ProbeProvider();
    llmRegistry.register(provider as never);

    const engine = new PipelineEngine();
    const jobId = await engine.startJob({
      novelText: '第一章 开端\n\n甲推门而入。\n\n乙抬头看他。',
      title: 'p1-probe',
      modelId: 'run-log-probe-model',
    });

    // 轮询等待完成（埋点是异步旁路，完成时已同步写入）
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const status = jobStore.get(jobId)?.status;
      if (status === 'completed' || status === 'failed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(jobStore.get(jobId)?.status).toBe('completed');

    const events = getRunLogRepository().listEvents(jobId);
    const stages = new Set(events.map((e) => e.stage));
    for (const stage of ['pipeline', 'phase1', 'phase2', 'phase3', 'phase4']) {
      expect(stages, `缺少 ${stage} 事件`).toContain(stage);
    }

    // 阶段级 span 必须带耗时
    const phaseEnds = events.filter((e) => e.stage.startsWith('phase') && e.event === 'end');
    expect(phaseEnds.length).toBeGreaterThanOrEqual(4);
    for (const e of phaseEnds) expect(typeof e.latencyMs).toBe('number');

    // 逐章 / 逐场景事件
    expect(events.some((e) => e.stage === 'phase2.chapter')).toBe(true);
    expect(events.some((e) => e.stage === 'phase3.scene')).toBe(true);

    // 产物快照至少留下首章 + 首场景
    const artifacts = getRunLogRepository().listArtifacts(jobId);
    expect(artifacts.some((a) => a.stage === 'phase2.chapter')).toBe(true);
    expect(artifacts.some((a) => a.stage === 'phase3.scene')).toBe(true);

    jobStore.delete(jobId);
  }, 30000);
});
