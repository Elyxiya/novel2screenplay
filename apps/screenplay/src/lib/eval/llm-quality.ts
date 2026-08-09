/**
 * LLM 质量评估器（P-评估）
 *
 * 从 Agent 编排路径（orchestrator.evaluateGate）抽取出的通用 LLM 质量评估能力：
 * 用 validator 角色 Prompt 让 LLM 对剧本文本四维打分（format/consistency/coherence/drama）。
 *
 * 使用场景：
 * - 传统管线（PipelineEngine）完成后对最终剧本做 LLM 质量评估，结果写入 job.metadata.qualityAssessment
 * - Agent 编排路径的质量关卡（orchestrator 复用本模块，消除重复）
 * - 质量基准集（benchmark）逐样本评分，验证评估器区分度
 *
 * 失败策略：LLM 调用或 JSON 解析失败时返回容错评估（70 分兜底），
 * 由调用方决定是否降级为启发式（review-gate.evaluateQuality）。
 */

import type { LLMProvider } from '../llm/types';
import type { QualityAssessment } from '../multi-agent/handoff-protocol';
import { serializeToYaml } from '@novel/contracts/serializers';
import type { Screenplay } from '@novel/contracts/screenplay';

export const VALIDATOR_EVAL_PROMPT = `你是一位资深剧本评审。请从四个维度评估剧本片段质量，并输出 JSON：
{
  "format": 0-100,      // 格式规范性（场景标题、对白、动作指示）
  "consistency": 0-100, // 与小说原著的忠实度
  "coherence": 0-100,   // 逻辑连贯性与节奏
  "dramaticTension": 0-100, // 戏剧张力
  "overall": 0-100,     // 综合评分
  "suggestions": []     // 改进建议（字符串数组）
}
只输出 JSON，不要其他文字。`;

export interface AssessOptions {
  /** 通过阈值（用于 passed 标记，默认 75） */
  passThreshold?: number;
  /** 送入 LLM 的内容上限字符数（默认 8000） */
  maxContentChars?: number;
}

/**
 * 调用 LLM 对剧本文本做质量评估。
 * 容错：JSON 解析失败或字段缺失时返回 70 分兜底（与编排路径历史行为一致），不抛错。
 */
export async function assessWithLLM(
  provider: LLMProvider,
  content: string,
  options: AssessOptions = {},
): Promise<QualityAssessment> {
  const passThreshold = options.passThreshold ?? 75;
  const maxChars = options.maxContentChars ?? 8000;

  const response = await provider.chat(
    [
      { role: 'system', content: VALIDATOR_EVAL_PROMPT },
      { role: 'user', content: `请评估以下剧本片段的质量:\n\n${content.slice(0, maxChars)}` },
    ],
    { responseFormat: 'json_object' },
  );

  const parsed = safeJsonParse(response.content);
  const score = clampScore(parsed.overall);

  return {
    score,
    passed: score >= passThreshold,
    dimensions: {
      format: clampScore(parsed.format),
      consistency: clampScore(parsed.consistency),
      coherence: clampScore(parsed.coherence),
      drama: clampScore(parsed.dramaticTension),
    },
    issues: [],
    suggestions: Array.isArray(parsed.suggestions) ? (parsed.suggestions as string[]) : [],
  };
}

/**
 * 将 Screenplay 对象序列化为 YAML 文本，供 LLM 评估。
 */
export function serializeScreenplayForEval(screenplay: Screenplay): string {
  try {
    return serializeToYaml(screenplay);
  } catch (err) {
    // YAML 序列化兜底：退回 JSON 文本（评估只需可读内容）
    return JSON.stringify(screenplay, null, 2);
  }
}

/**
 * 对传统管线产出的 Screenplay 做 LLM 质量评估。
 */
export async function assessPipelineScreenplay(
  provider: LLMProvider,
  screenplay: Screenplay,
  options: AssessOptions = {},
): Promise<QualityAssessment> {
  const text = serializeScreenplayForEval(screenplay);
  return assessWithLLM(provider, text, options);
}

// ── 内部工具（与编排路径共用逻辑） ────────────────────────────────────────

export function safeJsonParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }
}

export function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 70;
  return Math.max(0, Math.min(100, Math.round(n)));
}
