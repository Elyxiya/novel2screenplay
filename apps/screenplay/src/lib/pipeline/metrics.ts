/**
 * JobMetrics —— 运行期质量与成本指标的持久化模型（FIX-02b）。
 *
 * 存储位置：job.pipelineState.metrics。随 pipelineState 的 JSON 整体落库，
 * 装载路径（job-repository.rowToStoredJob）是纯 JSON.parse，不做 schema 过滤，
 * 因此无需 DB 迁移。
 *
 * 与 job.metadata 的关系：metadata 没有持久化路径（历史遗留），读取端
 * （flow-evaluator）保留 metadata fallback 以兼容旧数据；新写入一律走本模块。
 */

export interface JobMetricsUsage {
  promptTokens: number;
  completionTokens: number;
  inputChars: number;
  calls: number;
}

export interface JobMetricsPlaceholder {
  total: number;
  unresolved: number;
}

export interface JobMetrics {
  version: 1;
  usage: JobMetricsUsage;
  budgetBlocked: number;
  placeholder: JobMetricsPlaceholder;
  phaseTimings: Record<string, { durationMs: number }>;
  /** true = 指标不完整（例：从无指标的旧 job 恢复后只统计了恢复之后的部分） */
  partial?: boolean;
  updatedAt: number;
}

/** 转换器侧的最小写入接口（Phase3SceneConverter 只依赖它，不感知存储形态） */
export interface MetricsSink {
  addUsage(usage: {
    promptTokens?: number;
    completionTokens?: number;
    inputChars: number;
    calls?: number;
  }): void;
  addBudgetBlocked(): void;
  addPlaceholder(delta: JobMetricsPlaceholder): void;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function createMetrics(): JobMetrics {
  return {
    version: 1,
    usage: { promptTokens: 0, completionTokens: 0, inputChars: 0, calls: 0 },
    budgetBlocked: 0,
    placeholder: { total: 0, unresolved: 0 },
    phaseTimings: {},
    updatedAt: Date.now(),
  };
}

/** 防御式归一化：从任意 JSON（pipelineState.metrics）还原，未知/损坏值一律归零 */
export function normalizeMetrics(raw: unknown): JobMetrics | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const usage = (r.usage && typeof r.usage === 'object' ? r.usage : {}) as Record<string, unknown>;
  const ph = (r.placeholder && typeof r.placeholder === 'object' ? r.placeholder : {}) as Record<string, unknown>;

  const timings: Record<string, { durationMs: number }> = {};
  if (r.phaseTimings && typeof r.phaseTimings === 'object' && !Array.isArray(r.phaseTimings)) {
    for (const [k, v] of Object.entries(r.phaseTimings as Record<string, unknown>)) {
      if (v && typeof v === 'object' && typeof (v as { durationMs?: unknown }).durationMs === 'number') {
        timings[k] = { durationMs: (v as { durationMs: number }).durationMs };
      }
    }
  }

  return {
    version: 1,
    usage: {
      promptTokens: num(usage.promptTokens),
      completionTokens: num(usage.completionTokens),
      inputChars: num(usage.inputChars),
      calls: num(usage.calls),
    },
    budgetBlocked: num(r.budgetBlocked),
    placeholder: { total: num(ph.total), unresolved: num(ph.unresolved) },
    phaseTimings: timings,
    ...(r.partial === true ? { partial: true } : {}),
    updatedAt: num(r.updatedAt) || Date.now(),
  };
}

/**
 * 运行期指标累积器。
 *
 * 为什么必须有它：jobStore.update 每次从 DB 重载 job，而 metadata 不落库，
 * 旧实现里 "读 prev 再累加" 的写法每次都从空开始（calls 恒为 1、budgetBlocked 恒为 1、
 * placeholder 从不累加）。累积必须发生在 run-local 对象上，再在阶段边界随
 * pipelineState 一起 flush。
 */
export class MetricsAccumulator implements MetricsSink {
  private m: JobMetrics;

  constructor(initial?: JobMetrics) {
    const base = createMetrics();
    this.m = initial
      ? {
          ...base,
          ...initial,
          usage: { ...base.usage, ...initial.usage },
          placeholder: { ...base.placeholder, ...initial.placeholder },
          phaseTimings: { ...initial.phaseTimings },
        }
      : base;
  }

  /** 从已落库的 pipelineState.metrics 恢复；缺失/损坏时置 partial（指标只覆盖恢复之后的部分） */
  static restore(raw: unknown): MetricsAccumulator {
    const normalized = normalizeMetrics(raw);
    if (normalized) return new MetricsAccumulator(normalized);
    const acc = new MetricsAccumulator();
    acc.m.partial = true;
    return acc;
  }

  get value(): Readonly<JobMetrics> {
    return this.m;
  }

  addUsage(usage: {
    promptTokens?: number;
    completionTokens?: number;
    inputChars: number;
    calls?: number;
  }): void {
    if (!usage.promptTokens && !usage.completionTokens) return;
    this.m.usage.promptTokens += usage.promptTokens || 0;
    this.m.usage.completionTokens += usage.completionTokens || 0;
    this.m.usage.inputChars += usage.inputChars || 0;
    this.m.usage.calls += usage.calls ?? 1;
  }

  addBudgetBlocked(): void {
    this.m.budgetBlocked += 1;
  }

  addPlaceholder(delta: JobMetricsPlaceholder): void {
    this.m.placeholder.total += delta.total || 0;
    this.m.placeholder.unresolved += delta.unresolved || 0;
  }

  recordPhaseTiming(phase: string, durationMs: number): void {
    this.m.phaseTimings[phase] = { durationMs };
  }

  /** 深拷贝快照（含 updatedAt），用于写入 pipelineState.metrics */
  snapshot(): JobMetrics {
    return {
      version: 1,
      usage: { ...this.m.usage },
      budgetBlocked: this.m.budgetBlocked,
      placeholder: { ...this.m.placeholder },
      phaseTimings: { ...this.m.phaseTimings },
      ...(this.m.partial ? { partial: true } : {}),
      updatedAt: Date.now(),
    };
  }
}
