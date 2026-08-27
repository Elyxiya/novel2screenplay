import { z } from 'zod';
import {
  Phase1OutputSchema,
  Phase2OutputSchema,
  Phase3OutputSchema,
  type Phase1Output,
  type Phase2Output,
  type Phase3Output,
} from '@novel/contracts/pipeline';
import type { Screenplay } from '@novel/contracts/screenplay';

/**
 * job 追加/持久化状态（与 StoredJob.pipelineState 语义一致）。
 * 契约类型全部来自 @novel/contracts，本包不感知 pipeline 内部实现（解 C2）。
 */
export interface JobPipelineState {
  phase1Output?: Phase1Output;
  phase2Output?: Phase2Output;
  phase3Output?: Phase3Output[];
  phase4Output?: Screenplay;
  /** 任意业务附加元数据（如 qualityAssessment） */
  [key: string]: unknown;
}

/** 可序列化存储的 Job 存取记录（仅 job 状态存取层关心的字段） */
export interface JobRecord {
  id: string;
  status: string;
  currentPhase?: number;
  progress: number;
  pipelineState?: JobPipelineState;
  [key: string]: unknown;
}

/** 落库前规范化 pipelineState 的 JSON（对相位输出做结构校验，脏数据抛错） */
export function normalizePipelineState(
  state: JobPipelineState,
  options: { phase4Schema?: z.ZodType<Screenplay> } = {},
): JobPipelineState {
  const result: JobPipelineState = {};
  if (state.phase1Output !== undefined) {
    result.phase1Output = Phase1OutputSchema.parse(state.phase1Output);
  }
  if (state.phase2Output !== undefined) {
    result.phase2Output = Phase2OutputSchema.parse(state.phase2Output);
  }
  if (state.phase3Output !== undefined) {
    result.phase3Output = state.phase3Output.map((o) => Phase3OutputSchema.parse(o));
  }
  if (state.phase4Output !== undefined) {
    result.phase4Output = options.phase4Schema
      ? options.phase4Schema.parse(state.phase4Output)
      : state.phase4Output;
  }
  // 透传附加业务字段（qualityAssessment 等），不强行校验未知扩展
  for (const key of Object.keys(state)) {
    if (!(key in result) && key !== 'phase1Output' && key !== 'phase2Output' && key !== 'phase3Output' && key !== 'phase4Output') {
      result[key] = state[key];
    }
  }
  return result;
}

/** 契约化的 JSON 存取 codec：带相位输出完整性校验 */
export const pipelineStateJson = {
  toSqlite(state: JobPipelineState): string {
    return JSON.stringify(normalizePipelineState(state));
  },
  fromSqlite(raw: string | null | undefined): JobPipelineState | undefined {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as JobPipelineState;
    } catch {
      return undefined;
    }
  },
};