/**
 * Job 指标聚合（FIX-08）——纯函数，无 DB 依赖，可单测。
 *
 * 数据来源：
 * - 运行期指标：job.pipelineState.metrics（FIX-02b 落库）
 * - 读时聚合（无需额外存储）：
 *   · fallbackCount：phase2Output.rawResponses 中的 Fallback 标记（FIX-01）
 *   · unverified：phase4Output 中空 sourceRefs 块 / 低置信场景（FIX-02）
 *   · errorCodes：jobs.error（兼容旧字符串，前向兼容 FIX-22 的结构化错误）
 */
import type { StoredJob } from '../store/job-store';
import type { PipelineJobState } from '@novel/contracts/pipeline';
import type { Screenplay } from '@novel/contracts/screenplay';

export const FALLBACK_MARKER = 'Fallback:';
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

const ACTIVE_STATUSES = new Set(['analyzing', 'segmenting', 'converting', 'merging']);

export interface JobMetricsSummary {
  window: { from: number; to: number; days: number };
  totals: {
    jobs: number;
    completed: number;
    failed: number;
    active: number;
    pending: number;
    successRate: number | null;
  };
  duration: {
    samples: number;
    p50: number | null;
    p95: number | null;
    avg: number | null;
  };
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    inputChars: number;
    calls: number;
  };
  budgetBlocked: number;
  placeholder: { total: number; unresolved: number; rate: number | null };
  fallback: { fallbackChapters: number; totalChapters: number; rate: number | null };
  unverified: {
    emptyRefBlocks: number;
    totalBlocks: number;
    lowConfScenes: number;
    unknownConfScenes: number;
    totalScenes: number;
  };
  errorCodes: Record<string, number>;
  series: Array<{ date: string; jobs: number; completed: number; failed: number }>;
}

/** FIX-01 读时聚合：统计 Phase2 fallback 切分占比（rawResponses 已随 pipelineState 落库） */
export function countFallback(phase2Output: PipelineJobState['phase2Output']): {
  fallbackChapters: number;
  totalChapters: number;
} {
  const responses = phase2Output?.rawResponses ?? [];
  const fallbackChapters = responses.filter((r) => typeof r === 'string' && r.startsWith(FALLBACK_MARKER)).length;
  return { fallbackChapters, totalChapters: responses.length };
}

/** FIX-02 读时聚合：统计空 sourceRefs 块与低置信/缺置信场景（phase4Output 已落库） */
export function countUnverified(phase4Output: Screenplay | undefined): {
  emptyRefBlocks: number;
  totalBlocks: number;
  lowConfScenes: number;
  unknownConfScenes: number;
  totalScenes: number;
} {
  let emptyRefBlocks = 0;
  let totalBlocks = 0;
  let lowConfScenes = 0;
  let unknownConfScenes = 0;
  const scenes = phase4Output?.scenes ?? [];

  for (const scene of scenes) {
    for (const block of scene.content ?? []) {
      totalBlocks += 1;
      if (!block.sourceRefs || block.sourceRefs.length === 0) emptyRefBlocks += 1;
    }
    if (typeof scene.confidence === 'number') {
      if (scene.confidence <= LOW_CONFIDENCE_THRESHOLD) lowConfScenes += 1;
    } else {
      unknownConfScenes += 1;
    }
  }

  return { emptyRefBlocks, totalBlocks, lowConfScenes, unknownConfScenes, totalScenes: scenes.length };
}

/** 错误码解析：结构化 JSON 取 code；旧字符串/解析失败归为 legacy（前向兼容 FIX-22） */
export function parseErrorCode(error: string | undefined): string | null {
  if (!error) return null;
  try {
    const parsed: unknown = JSON.parse(error);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { code?: unknown }).code === 'string') {
      return (parsed as { code: string }).code;
    }
  } catch {
    // 旧格式：纯文本错误消息
  }
  return 'legacy';
}

/** 最近秩百分位（输入需已升序） */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function utcDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function aggregateJobMetrics(
  jobs: StoredJob[],
  window: { from: number; to: number; days: number },
): JobMetricsSummary {
  const totals = { jobs: jobs.length, completed: 0, failed: 0, active: 0, pending: 0 };
  const durations: number[] = [];
  const tokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0, inputChars: 0, calls: 0 };
  let budgetBlocked = 0;
  const placeholder = { total: 0, unresolved: 0 };
  const fallback = { fallbackChapters: 0, totalChapters: 0 };
  const unverified = { emptyRefBlocks: 0, totalBlocks: 0, lowConfScenes: 0, unknownConfScenes: 0, totalScenes: 0 };
  const errorCodes: Record<string, number> = {};
  const dayBuckets = new Map<string, { jobs: number; completed: number; failed: number }>();

  for (const job of jobs) {
    if (job.status === 'completed') totals.completed += 1;
    else if (job.status === 'failed') totals.failed += 1;
    else if (ACTIVE_STATUSES.has(job.status)) totals.active += 1;
    else totals.pending += 1;

    if (job.status === 'completed' && typeof job.startedAt === 'number' && typeof job.completedAt === 'number' && job.completedAt >= job.startedAt) {
      durations.push(job.completedAt - job.startedAt);
    }

    const m = job.pipelineState?.metrics;
    if (m) {
      tokens.promptTokens += m.usage.promptTokens;
      tokens.completionTokens += m.usage.completionTokens;
      tokens.inputChars += m.usage.inputChars;
      tokens.calls += m.usage.calls;
      budgetBlocked += m.budgetBlocked;
      placeholder.total += m.placeholder.total;
      placeholder.unresolved += m.placeholder.unresolved;
    }

    const fb = countFallback(job.pipelineState?.phase2Output);
    fallback.fallbackChapters += fb.fallbackChapters;
    fallback.totalChapters += fb.totalChapters;

    const uv = countUnverified(job.pipelineState?.phase4Output);
    unverified.emptyRefBlocks += uv.emptyRefBlocks;
    unverified.totalBlocks += uv.totalBlocks;
    unverified.lowConfScenes += uv.lowConfScenes;
    unverified.unknownConfScenes += uv.unknownConfScenes;
    unverified.totalScenes += uv.totalScenes;

    const code = parseErrorCode(job.error);
    if (code) errorCodes[code] = (errorCodes[code] ?? 0) + 1;

    const dayKey = utcDate(job.completedAt ?? job.createdAt);
    const bucket = dayBuckets.get(dayKey) ?? { jobs: 0, completed: 0, failed: 0 };
    bucket.jobs += 1;
    if (job.status === 'completed') bucket.completed += 1;
    if (job.status === 'failed') bucket.failed += 1;
    dayBuckets.set(dayKey, bucket);
  }

  tokens.totalTokens = tokens.promptTokens + tokens.completionTokens;
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const finished = totals.completed + totals.failed;

  return {
    window,
    totals: {
      ...totals,
      successRate: finished > 0 ? Number((totals.completed / finished).toFixed(4)) : null,
    },
    duration: {
      samples: sortedDurations.length,
      p50: percentile(sortedDurations, 0.5),
      p95: percentile(sortedDurations, 0.95),
      avg: sortedDurations.length > 0
        ? Math.round(sortedDurations.reduce((s, v) => s + v, 0) / sortedDurations.length)
        : null,
    },
    tokens,
    budgetBlocked,
    placeholder: {
      ...placeholder,
      rate: placeholder.total > 0 ? Number((placeholder.unresolved / placeholder.total).toFixed(4)) : null,
    },
    fallback: {
      ...fallback,
      rate: fallback.totalChapters > 0 ? Number((fallback.fallbackChapters / fallback.totalChapters).toFixed(4)) : null,
    },
    unverified,
    errorCodes,
    series: [...dayBuckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, b]) => ({ date, ...b })),
  };
}
