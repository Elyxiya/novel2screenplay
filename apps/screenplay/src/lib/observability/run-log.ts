/**
 * 运行观测（P1 观测层）
 *
 * 目标：任何一次转换失败后，能回答「坏在哪一阶段、哪一章、哪一个场景、第几次重试、
 * 输入是什么、输出是什么、花了多少 token」——而不是只有一句「流水线失败」。
 *
 * 设计约束：
 * 1. **只追加**：事件写入独立的 run_events 表，不进 jobs.logs（后者每次 update 全量重写）。
 * 2. **绝不抛错**：观测是旁路，任何写入失败都只能降级为一条 console.warn，不能影响转换。
 * 3. **默认省空间**：事件 payload 截断；产物快照只留失败/降级 + 采样成功样本。
 * 4. **脱敏**：复用 agent/debug/redact（密钥 / JWT / 邮箱 / 手机号）。
 *
 * 一个 trace = 一次执行（首跑 / resume / 局部重转各自独立），因此同一 job 的多次
 * 运行在时间线上可区分。
 */

import { getRunLogRepository, type RunEventRow } from '../store/sqlite/run-log-repository';
import { redactValue, scrubSecrets } from '../agent/debug/redact';

export interface RunLogContext {
  jobId: string;
  traceId: string;
}

/** 事件 payload 序列化后的上限（超出只记大小，保证仍是合法 JSON） */
export const EVENT_PAYLOAD_MAX_CHARS = 2000;
/** 单条产物（输入/输出）保留的字符上限 */
export const ARTIFACT_MAX_CHARS = 4000;
/** 成功样本采样间隔：sceneIndex % N === 1 时留档（含第一个场景） */
export const ARTIFACT_SAMPLE_EVERY = 10;
/** 每个任务保留的事件/产物上限（任务收尾时裁剪，防止只增不减） */
export const KEEP_EVENTS_PER_JOB = 2000;
export const KEEP_ARTIFACTS_PER_JOB = 60;

export type RunEventName =
  | 'start'
  | 'end'
  | 'llm_call'
  | 'retry'
  | 'degrade'
  | 'skip'
  | 'error';

export type RunEventLevel = 'info' | 'warn' | 'error';

export interface RunEventInput {
  ctx: RunLogContext;
  stage: string;
  phase: number;
  sceneIndex?: number | null;
  event: RunEventName;
  level?: RunEventLevel;
  payload?: Record<string, unknown>;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
}

let seq = 0;
let warned = false;

/** 可排序的事件 id：13 位毫秒 + 6 位进程内序号 */
function nextEventId(now: number): string {
  seq = (seq + 1) % 1_000_000;
  return `${String(now).padStart(13, '0')}-${String(seq).padStart(6, '0')}`;
}

export function createTraceId(kind: string = 'run'): string {
  return `tr_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function serializePayload(payload?: Record<string, unknown>): string | null {
  if (!payload) return null;
  try {
    const safe = redactValue(payload);
    const json = JSON.stringify(safe);
    if (json.length <= EVENT_PAYLOAD_MAX_CHARS) return json;
    return JSON.stringify({ _truncated: true, size: json.length });
  } catch {
    return JSON.stringify({ _truncated: true, reason: 'payload_not_serializable' });
  }
}

/** 记录一条事件；永不抛错。 */
export function recordRunEvent(input: RunEventInput): void {
  try {
    const now = Date.now();
    getRunLogRepository().appendEvent({
      id: nextEventId(now),
      jobId: input.ctx.jobId,
      traceId: input.ctx.traceId,
      phase: input.phase,
      sceneIndex: input.sceneIndex ?? null,
      stage: input.stage,
      event: input.event,
      level: input.level ?? 'info',
      payload: serializePayload(input.payload),
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      latencyMs: input.latencyMs ?? null,
      createdAt: now,
    });
  } catch (err) {
    // 观测失败不能影响转换；只告警一次，避免日志刷屏
    if (!warned) {
      warned = true;
      console.warn('[run-log] 事件写入失败，后续同类错误静默:', (err as Error).message);
    }
  }
}

export interface RunSpan {
  readonly startedAt: number;
  /** 记录一条中间事件（llm_call / retry / degrade …），自动带耗时与 token */
  event(
    name: RunEventName,
    payload?: Record<string, unknown>,
    extra?: { level?: RunEventLevel; promptTokens?: number; completionTokens?: number },
  ): void;
  /** 正常结束：记录 end 事件与总耗时 */
  end(payload?: Record<string, unknown>): void;
  /** 异常结束：记录 error 事件与总耗时；error 会做脱敏 */
  fail(err: unknown, payload?: Record<string, unknown>): void;
}

export interface StartSpanInput {
  ctx: RunLogContext;
  stage: string;
  phase: number;
  sceneIndex?: number | null;
  /** 是否额外记录一条 start 事件（阶段级建议开启，逐场景级建议关闭以省体积） */
  emitStart?: boolean;
  startPayload?: Record<string, unknown>;
}

export function startSpan(input: StartSpanInput): RunSpan {
  const startedAt = Date.now();
  const base = {
    ctx: input.ctx,
    stage: input.stage,
    phase: input.phase,
    sceneIndex: input.sceneIndex ?? null,
  };

  if (input.emitStart) {
    recordRunEvent({ ...base, event: 'start', payload: input.startPayload });
  }

  return {
    startedAt,
    event(name, payload, extra) {
      recordRunEvent({
        ...base,
        event: name,
        level: extra?.level,
        payload,
        promptTokens: extra?.promptTokens,
        completionTokens: extra?.completionTokens,
        latencyMs: Date.now() - startedAt,
      });
    },
    end(payload) {
      recordRunEvent({ ...base, event: 'end', payload, latencyMs: Date.now() - startedAt });
    },
    fail(err, payload) {
      const message = err instanceof Error ? err.message : String(err);
      recordRunEvent({
        ...base,
        event: 'error',
        level: 'error',
        payload: { ...payload, error: message.slice(0, 500) },
        latencyMs: Date.now() - startedAt,
      });
    },
  };
}

export interface ArtifactInput {
  ctx: RunLogContext;
  stage: string;
  sceneIndex?: number | null;
  attempt?: number;
  inputText?: string;
  outputText?: string;
  meta?: Record<string, unknown>;
  /** 失败/降级场景强制留档（不受采样限制） */
  force?: boolean;
}

/** 成功样本采样：第 0 条与 sceneIndex % N === 1 的条目留档（覆盖首章/首场景） */
function sampleArtifact(sceneIndex?: number | null): boolean {
  if (sceneIndex === null || sceneIndex === undefined) return true;
  return sceneIndex === 0 || sceneIndex % ARTIFACT_SAMPLE_EVERY === 1;
}

function truncate(text: string | undefined): string | null {
  if (!text) return null;
  const redacted = scrubSecrets(text);
  if (redacted.length <= ARTIFACT_MAX_CHARS) return redacted;
  const cut = redacted.slice(0, ARTIFACT_MAX_CHARS);
  return `${cut}\n…[已截断，原始 ${redacted.length} 字符]`;
}

/** 记录阶段产物快照；失败/降级强制留档，成功按采样。永不抛错。 */
export function recordArtifact(input: ArtifactInput): void {
  if (!input.force && !sampleArtifact(input.sceneIndex)) return;
  try {
    const now = Date.now();
    getRunLogRepository().appendArtifact({
      id: nextEventId(now),
      jobId: input.ctx.jobId,
      traceId: input.ctx.traceId,
      stage: input.stage,
      sceneIndex: input.sceneIndex ?? null,
      attempt: input.attempt ?? 0,
      inputText: truncate(input.inputText),
      outputText: truncate(input.outputText),
      meta: input.meta ? JSON.stringify(redactValue(input.meta)).slice(0, EVENT_PAYLOAD_MAX_CHARS) : null,
      createdAt: now,
    });
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn('[run-log] 产物写入失败，后续同类错误静默:', (err as Error).message);
    }
  }
}

/** 任务收尾：按上限裁剪事件与产物，避免只增不减。永不抛错。 */
export function pruneRunLog(jobId: string): void {
  try {
    getRunLogRepository().pruneJob(jobId, KEEP_EVENTS_PER_JOB, KEEP_ARTIFACTS_PER_JOB);
  } catch (err) {
    console.warn('[run-log] 裁剪失败:', (err as Error).message);
  }
}

export interface StageSummary {
  stage: string;
  phase: number;
  count: number;
  errors: number;
  warns: number;
  /** 所有事件耗时之和（含嵌套，仅用于排序参考，不代表墙钟） */
  totalLatencyMs: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  promptTokens: number;
  completionTokens: number;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * 按 stage 聚合事件（纯函数）：给 /debug 时间线提供「哪一阶段最慢、错在哪」。
 * 耗时只统计 event='end' 的行，避免把 llm_call / retry 的耗时重复计入。
 */
export function summarizeByStage(events: RunEventRow[]): StageSummary[] {
  const byStage = new Map<string, { phase: number; latencies: number[]; errors: number; warns: number; count: number; prompt: number; completion: number }>();

  for (const e of events) {
    const cur = byStage.get(e.stage) ?? {
      phase: e.phase,
      latencies: [],
      errors: 0,
      warns: 0,
      count: 0,
      prompt: 0,
      completion: 0,
    };
    cur.count += 1;
    if (e.level === 'error') cur.errors += 1;
    if (e.level === 'warn') cur.warns += 1;
    if (e.event === 'end' && typeof e.latencyMs === 'number') cur.latencies.push(e.latencyMs);
    cur.prompt += e.promptTokens ?? 0;
    cur.completion += e.completionTokens ?? 0;
    byStage.set(e.stage, cur);
  }

  return [...byStage.entries()]
    .map(([stage, v]) => {
      const sorted = [...v.latencies].sort((a, b) => a - b);
      return {
        stage,
        phase: v.phase,
        count: v.count,
        errors: v.errors,
        warns: v.warns,
        totalLatencyMs: sorted.reduce((s, n) => s + n, 0),
        p50LatencyMs: percentile(sorted, 0.5),
        p95LatencyMs: percentile(sorted, 0.95),
        promptTokens: v.prompt,
        completionTokens: v.completion,
      };
    })
    .sort((a, b) => a.phase - b.phase || b.totalLatencyMs - a.totalLatencyMs);
}
