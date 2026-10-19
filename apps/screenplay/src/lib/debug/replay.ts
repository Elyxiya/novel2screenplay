/**
 * 单场景回放（P1.5）
 *
 * 用途：时间线告诉你「场景 #7 置信度 0.2、重试 3 次」，回放回答「换个参数/改完 prompt 后，
 * 这个场景会不会变好」——用同一份 Phase1/Phase2 产物 + 同章节原文，重跑一次 Phase 3 单场景，
 * 与已落库的旧输出逐项对比。
 *
 * 为什么不用 stage_artifacts 的输入：产物快照是截断过的（4000 字符），只够人看；
 * 真正的重放输入应当从 job 的 pipelineState + chapterTexts 重建，才能保证与首跑同源。
 * 产物快照的作用是「对照证据」，不是「重放输入」。
 *
 * 副作用边界：回放**不改动**任务状态与已有产物（不写 jobStore），只写观测数据（trace=replay）。
 */

import type { JobStore } from '../store/job-store';
import { jobStore } from '../store/job-store';
import { Phase3SceneConverter } from '../pipeline/Phase3SceneConverter';
import { ContextManager } from '../pipeline/ContextManager';
import { loadFewshots } from '../pipeline/fewshots';
import { resolveProvider } from '../llm/llm-gateway';
import type { LLMProvider } from '../llm/types';
import type { Phase3Output } from '@novel/contracts/pipeline';
import { createTraceId, recordArtifact, recordRunEvent } from '../observability/run-log';

export class ReplayError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ReplayError';
  }
}

/** 回放只读任务，不落任何进度/日志；Phase3 只调用 update，故给空实现即可 */
const READONLY_JOB_STORE = {
  update: () => {
    /* 回放不修改任务 */
  },
  get: () => undefined,
} as unknown as JobStore;

export interface ReplayDiff {
  blocksBefore: number;
  blocksAfter: number;
  confidenceBefore: number | null;
  confidenceAfter: number;
  /** 内容块是否变化（JSON 全等比较） */
  contentChanged: boolean;
  summaryChanged: boolean;
  timeOfDayChanged: boolean;
}

export interface ReplaySceneResult {
  jobId: string;
  sceneIndex: number;
  modelId: string;
  traceId: string;
  durationMs: number;
  before: Phase3Output | null;
  after: Phase3Output;
  diff: ReplayDiff;
}

export interface ReplaySceneInput {
  jobId: string;
  sceneIndex: number;
  /** 请求者（归属校验） */
  userId: string;
  /** 指定模型回放（缺省沿用任务原模型） */
  modelId?: string;
  /** 测试注入：跳过 provider 解析 */
  provider?: LLMProvider;
}

export async function replayScene(input: ReplaySceneInput): Promise<ReplaySceneResult> {
  const job = jobStore.get(input.jobId);
  if (!job) throw new ReplayError(404, '任务不存在');
  if (job.userId && job.userId !== input.userId) throw new ReplayError(403, '无权访问该任务');

  const phase1 = job.pipelineState.phase1Output;
  const phase2 = job.pipelineState.phase2Output;
  if (!phase1 || !phase2) throw new ReplayError(400, '任务缺少 Phase1/Phase2 产物，无法重放单场景');

  const scene = phase2.scenes.find((s) => s.sceneIndex === input.sceneIndex);
  if (!scene) throw new ReplayError(404, `场景 #${input.sceneIndex} 不存在`);

  const provider = input.provider ?? resolveProvider(input.userId, input.modelId ?? job.config.modelId);
  if (!provider) throw new ReplayError(400, '未配置可用的 LLM Provider');

  const traceId = createTraceId('replay');
  const ctx = { jobId: input.jobId, traceId };
  const startedAt = Date.now();

  recordRunEvent({
    ctx,
    stage: 'replay',
    phase: 3,
    sceneIndex: scene.sceneIndex,
    event: 'start',
    payload: { modelId: provider.modelId, chapter: scene.chapterIndex, sceneIndex: scene.sceneIndex },
  });

  const converter = new Phase3SceneConverter(provider, new ContextManager());
  const [after] = await converter.convertScenes(
    [scene],
    phase1.characters,
    phase1.locations,
    job.chapterTexts,
    READONLY_JOB_STORE,
    job.id,
    undefined,
    {
      settingCard: phase1.settingCard,
      userProfile: job.pipelineState.userProfile,
      styleProfile: job.pipelineState.styleProfile,
      fewshots: loadFewshots(),
      runLog: ctx,
    },
  );

  const before = (job.pipelineState.phase3Output ?? []).find((o) => o.sceneNumber === scene.sceneIndex) ?? null;

  const diff: ReplayDiff = {
    blocksBefore: before?.content.length ?? 0,
    blocksAfter: after.content.length,
    confidenceBefore: before?.confidence ?? null,
    confidenceAfter: after.confidence,
    contentChanged: JSON.stringify(before?.content ?? null) !== JSON.stringify(after.content),
    summaryChanged: (before?.summary ?? null) !== after.summary,
    timeOfDayChanged: (before?.timeOfDay ?? null) !== after.timeOfDay,
  };

  const durationMs = Date.now() - startedAt;

  // 留档：回放结果也进产物快照，便于事后对比（强制留档，不受采样限制）
  recordArtifact({
    ctx,
    stage: 'replay.scene',
    sceneIndex: scene.sceneIndex,
    inputText: JSON.stringify({ chapter: scene.chapterIndex, offsets: [scene.originalStartOffset, scene.originalEndOffset] }),
    outputText: JSON.stringify(after.content),
    meta: {
      modelId: provider.modelId,
      confidence: after.confidence,
      contentChanged: diff.contentChanged,
      blocksBefore: diff.blocksBefore,
      blocksAfter: diff.blocksAfter,
    },
    force: true,
  });

  recordRunEvent({
    ctx,
    stage: 'replay',
    phase: 3,
    sceneIndex: scene.sceneIndex,
    event: 'end',
    latencyMs: durationMs,
    payload: {
      modelId: provider.modelId,
      contentChanged: diff.contentChanged,
      confidenceBefore: diff.confidenceBefore,
      confidenceAfter: diff.confidenceAfter,
    },
  });

  return {
    jobId: input.jobId,
    sceneIndex: scene.sceneIndex,
    modelId: provider.modelId,
    traceId,
    durationMs,
    before,
    after,
    diff,
  };
}
