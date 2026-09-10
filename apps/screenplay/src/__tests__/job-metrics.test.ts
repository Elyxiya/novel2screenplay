import { describe, it, expect, beforeEach } from 'vitest';
import {
  MetricsAccumulator,
  createMetrics,
  normalizeMetrics,
  type JobMetrics,
} from '@/lib/pipeline/metrics';
import { getJobRepository } from '@/lib/store/sqlite/job-repository';
import { getDatabase } from '@/lib/store/sqlite/db';

// ── 累积器语义（D-23：旧实现 read-modify-write 每次从空开始，calls 恒为 1） ──

describe('MetricsAccumulator · 累积语义', () => {
  it('多次 addUsage 正确累加（calls 随调用计数）', () => {
    const acc = new MetricsAccumulator();
    acc.addUsage({ promptTokens: 100, completionTokens: 20, inputChars: 500 });
    acc.addUsage({ promptTokens: 50, completionTokens: 10, inputChars: 200 });

    expect(acc.snapshot().usage).toEqual({
      promptTokens: 150,
      completionTokens: 30,
      inputChars: 700,
      calls: 2,
    });
  });

  it('promptTokens/completionTokens 全零时跳过（与旧 recordUsage 语义一致）', () => {
    const acc = new MetricsAccumulator();
    acc.addUsage({ promptTokens: 0, completionTokens: 0, inputChars: 500 });
    expect(acc.snapshot().usage.calls).toBe(0);
    expect(acc.snapshot().usage.inputChars).toBe(0);
  });

  it('addBudgetBlocked 累加；addPlaceholder 按增量累加', () => {
    const acc = new MetricsAccumulator();
    acc.addBudgetBlocked();
    acc.addBudgetBlocked();
    acc.addPlaceholder({ total: 4, unresolved: 1 });
    acc.addPlaceholder({ total: 6, unresolved: 2 });

    const s = acc.snapshot();
    expect(s.budgetBlocked).toBe(2);
    expect(s.placeholder).toEqual({ total: 10, unresolved: 3 });
  });

  it('recordPhaseTiming 覆盖同名阶段', () => {
    const acc = new MetricsAccumulator();
    acc.recordPhaseTiming('analyze', 1000);
    acc.recordPhaseTiming('analyze', 2500);
    acc.recordPhaseTiming('segment', 300);

    expect(acc.value.phaseTimings).toEqual({
      analyze: { durationMs: 2500 },
      segment: { durationMs: 300 },
    });
  });

  it('snapshot 是深拷贝：改快照不影响累积器', () => {
    const acc = new MetricsAccumulator();
    const snap = acc.snapshot();
    acc.addBudgetBlocked();
    snap.usage.promptTokens = 999;

    expect(snap.budgetBlocked).toBe(0);
    expect(acc.snapshot().budgetBlocked).toBe(1);
    expect(acc.snapshot().usage.promptTokens).toBe(0);
  });
});

// ── 恢复语义（resume：从落库指标继续累加） ──

describe('MetricsAccumulator · restore', () => {
  it('从已有指标恢复并继续累加（partial 保持未设置）', () => {
    const existing = createMetrics();
    existing.usage = { promptTokens: 100, completionTokens: 20, inputChars: 500, calls: 2 };
    existing.budgetBlocked = 1;

    const acc = MetricsAccumulator.restore(existing);
    acc.addUsage({ promptTokens: 30, completionTokens: 5, inputChars: 80 });
    acc.addBudgetBlocked();

    const s = acc.snapshot();
    expect(s.usage).toEqual({ promptTokens: 130, completionTokens: 25, inputChars: 580, calls: 3 });
    expect(s.budgetBlocked).toBe(2);
    expect(s.partial).toBeUndefined();
  });

  it('无指标（旧 job）→ partial=true 且从零累加', () => {
    const acc = MetricsAccumulator.restore(undefined);
    acc.addBudgetBlocked();

    const s = acc.snapshot();
    expect(s.partial).toBe(true);
    expect(s.budgetBlocked).toBe(1);
    expect(s.usage.calls).toBe(0);
  });

  it('损坏值 → partial=true 且不抛异常', () => {
    const acc = MetricsAccumulator.restore('not-an-object');
    expect(acc.snapshot().partial).toBe(true);
  });
});

describe('normalizeMetrics · 防御式解析', () => {
  it('非法字段归零、合法字段保留', () => {
    const n = normalizeMetrics({
      usage: { promptTokens: 'x', completionTokens: 5 },
      budgetBlocked: null,
      placeholder: 3,
      phaseTimings: { analyze: { durationMs: 7 }, bad: 'nope' },
      partial: 'yes',
    });

    expect(n).toBeDefined();
    expect(n!.usage.promptTokens).toBe(0);
    expect(n!.usage.completionTokens).toBe(5);
    expect(n!.budgetBlocked).toBe(0);
    expect(n!.placeholder).toEqual({ total: 0, unresolved: 0 });
    expect(n!.phaseTimings).toEqual({ analyze: { durationMs: 7 } });
    expect(n!.partial).toBeUndefined();
  });

  it('非对象输入返回 undefined', () => {
    expect(normalizeMetrics(null)).toBeUndefined();
    expect(normalizeMetrics([1, 2])).toBeUndefined();
    expect(normalizeMetrics(42)).toBeUndefined();
  });
});

// ── 落库往返（D-23 核心证明：metrics 随 pipelineState 持久化并可重载） ──

describe('pipelineState.metrics · SQLite 落库往返', () => {
  const repo = getJobRepository();

  beforeEach(() => {
    getDatabase();
  });

  function createJob(): string {
    return repo.create({
      novelText: 'xx',
      chapterTexts: ['xx'],
      modelId: 'test-model',
      selectedChapters: [0],
      temperature: 0.7,
      title: '指标往返测试',
    });
  }

  it('update → get：usage/budgetBlocked/placeholder/phaseTimings 完整保留', () => {
    const id = createJob();
    const acc = new MetricsAccumulator();
    acc.addUsage({ promptTokens: 100, completionTokens: 20, inputChars: 500 });
    acc.addUsage({ promptTokens: 50, completionTokens: 10, inputChars: 200 });
    acc.addBudgetBlocked();
    acc.addPlaceholder({ total: 4, unresolved: 1 });
    acc.recordPhaseTiming('analyze', 1234);

    repo.update(id, { pipelineState: { metrics: acc.snapshot() } });

    const reloaded = repo.get(id);
    const m = reloaded?.pipelineState?.metrics as JobMetrics | undefined;
    expect(m).toBeDefined();
    expect(m!.usage).toEqual({ promptTokens: 150, completionTokens: 30, inputChars: 700, calls: 2 });
    expect(m!.budgetBlocked).toBe(1);
    expect(m!.placeholder).toEqual({ total: 4, unresolved: 1 });
    expect(m!.phaseTimings.analyze.durationMs).toBe(1234);
  });

  it('重载后 restore 继续累加（模拟 resume 全链路）', () => {
    const id = createJob();
    const first = new MetricsAccumulator();
    first.addUsage({ promptTokens: 100, completionTokens: 20, inputChars: 500 });
    repo.update(id, { pipelineState: { metrics: first.snapshot() } });

    // resume：从落库值恢复，再累加新场景的用量
    const reloaded = repo.get(id);
    const resumed = MetricsAccumulator.restore(reloaded?.pipelineState?.metrics);
    resumed.addUsage({ promptTokens: 40, completionTokens: 8, inputChars: 160 });

    const s = resumed.snapshot();
    expect(s.usage).toEqual({ promptTokens: 140, completionTokens: 28, inputChars: 660, calls: 2 });
    expect(s.partial).toBeUndefined();
  });

  it('与其余 pipelineState 键共存（不再被装载路径过滤）', () => {
    const id = createJob();
    const acc = new MetricsAccumulator();
    acc.addBudgetBlocked();

    repo.update(id, {
      pipelineState: { phase1Output: undefined, qualityAssessment: undefined, metrics: acc.snapshot() },
    });

    const reloaded = repo.get(id);
    expect(reloaded?.pipelineState?.metrics?.budgetBlocked).toBe(1);
  });
});
