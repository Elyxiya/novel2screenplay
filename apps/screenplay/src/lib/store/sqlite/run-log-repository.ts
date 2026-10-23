/**
 * 运行事件 / 阶段产物仓储（P1 观测层）
 *
 * 与 jobs.logs 的分工：
 * - jobs.logs：给用户看的粗粒度流水（「Phase 2 完成」「场景 #3 失败」），单列 JSON，随 job 更新重写；
 * - run_events：给排查用的结构化事件（每章/每场景/每次重试），只追加，独立索引。
 * 两者不互相替代：把埋点塞进 logs 会让 update 变成 O(n²)。
 */

import { getEngine } from './db';

export interface RunEventRow {
  id: string;
  jobId: string;
  traceId: string;
  phase: number;
  sceneIndex: number | null;
  stage: string;
  event: string;
  level: string;
  payload: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  createdAt: number;
}

export interface StageArtifactRow {
  id: string;
  jobId: string;
  traceId: string;
  stage: string;
  sceneIndex: number | null;
  attempt: number;
  inputText: string | null;
  outputText: string | null;
  meta: string | null;
  createdAt: number;
}

interface RunEventDbRow {
  id: string;
  job_id: string;
  trace_id: string;
  phase: number;
  scene_index: number | null;
  stage: string;
  event: string;
  level: string;
  payload: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  created_at: number;
}

interface StageArtifactDbRow {
  id: string;
  job_id: string;
  trace_id: string;
  stage: string;
  scene_index: number | null;
  attempt: number;
  input_text: string | null;
  output_text: string | null;
  meta: string | null;
  created_at: number;
}

export interface RunLogRepository {
  appendEvent(row: RunEventRow): void;
  appendArtifact(row: StageArtifactRow): void;
  listEvents(jobId: string, limit?: number): RunEventRow[];
  listArtifacts(jobId: string): StageArtifactRow[];
  /** 保留最近 keepEvents 条事件 / keepArtifacts 条产物，其余删除（任务收尾时调用） */
  pruneJob(jobId: string, keepEvents: number, keepArtifacts: number): void;
  /** 任务被删除时级联清理（jobs 表无外键约束，显式删） */
  deleteByJob(jobId: string): void;
  /** 按用户清理（清空历史时用） */
  deleteByJobs(jobIds: string[]): void;
}

class RunLogRepositoryImpl implements RunLogRepository {
  appendEvent(row: RunEventRow): void {
    getEngine()
      .prepare(
        `INSERT INTO run_events
           (id, job_id, trace_id, phase, scene_index, stage, event, level, payload,
            prompt_tokens, completion_tokens, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.jobId,
        row.traceId,
        row.phase,
        row.sceneIndex,
        row.stage,
        row.event,
        row.level,
        row.payload,
        row.promptTokens,
        row.completionTokens,
        row.latencyMs,
        row.createdAt,
      );
  }

  appendArtifact(row: StageArtifactRow): void {
    getEngine()
      .prepare(
        `INSERT INTO stage_artifacts
           (id, job_id, trace_id, stage, scene_index, attempt, input_text, output_text, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.jobId,
        row.traceId,
        row.stage,
        row.sceneIndex,
        row.attempt,
        row.inputText,
        row.outputText,
        row.meta,
        row.createdAt,
      );
  }

  listEvents(jobId: string, limit = 2000): RunEventRow[] {
    const rows = getEngine()
      .prepare('SELECT * FROM run_events WHERE job_id = ? ORDER BY id ASC LIMIT ?')
      .all(jobId, limit) as RunEventDbRow[];

    return rows.map(toEventRow);
  }

  listArtifacts(jobId: string): StageArtifactRow[] {
    const rows = getEngine()
      .prepare('SELECT * FROM stage_artifacts WHERE job_id = ? ORDER BY id ASC')
      .all(jobId) as StageArtifactDbRow[];

    return rows.map(toArtifactRow);
  }

  pruneJob(jobId: string, keepEvents: number, keepArtifacts: number): void {
    const db = getEngine();
    db.prepare(
      `DELETE FROM run_events
        WHERE job_id = ?
          AND id NOT IN (SELECT id FROM run_events WHERE job_id = ? ORDER BY id DESC LIMIT ?)`,
    ).run(jobId, jobId, Math.max(0, keepEvents));

    db.prepare(
      `DELETE FROM stage_artifacts
        WHERE job_id = ?
          AND id NOT IN (SELECT id FROM stage_artifacts WHERE job_id = ? ORDER BY id DESC LIMIT ?)`,
    ).run(jobId, jobId, Math.max(0, keepArtifacts));
  }

  deleteByJob(jobId: string): void {
    const db = getEngine();
    db.prepare('DELETE FROM run_events WHERE job_id = ?').run(jobId);
    db.prepare('DELETE FROM stage_artifacts WHERE job_id = ?').run(jobId);
  }

  deleteByJobs(jobIds: string[]): void {
    if (jobIds.length === 0) return;
    const db = getEngine();
    const placeholders = jobIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM run_events WHERE job_id IN (${placeholders})`).run(...jobIds);
    db.prepare(`DELETE FROM stage_artifacts WHERE job_id IN (${placeholders})`).run(...jobIds);
  }
}

function toEventRow(r: RunEventDbRow): RunEventRow {
  return {
    id: r.id,
    jobId: r.job_id,
    traceId: r.trace_id,
    phase: r.phase,
    sceneIndex: r.scene_index,
    stage: r.stage,
    event: r.event,
    level: r.level,
    payload: r.payload,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
  };
}

function toArtifactRow(r: StageArtifactDbRow): StageArtifactRow {
  return {
    id: r.id,
    jobId: r.job_id,
    traceId: r.trace_id,
    stage: r.stage,
    sceneIndex: r.scene_index,
    attempt: r.attempt,
    inputText: r.input_text,
    outputText: r.output_text,
    meta: r.meta,
    createdAt: r.created_at,
  };
}

let repository: RunLogRepository | null = null;

export function getRunLogRepository(): RunLogRepository {
  if (!repository) repository = new RunLogRepositoryImpl();
  return repository;
}
