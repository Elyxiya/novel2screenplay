/**
 * ReviewGate - 质量关卡
 *
 * 定义剧本转换过程中的质量检查点，
 * 在关键阶段进行质量评估，决定是否通过或需要返工。
 */

import type { QualityAssessment } from './handoff-protocol';

export type GateDecision = 'pass' | 'fail' | 'review' | 'skip';

export interface GateCriteria {
  /** 最低质量分数 (0-100) */
  minScore: number;
  /** 必须通过的维度 */
  requiredDimensions?: (keyof QualityAssessment['dimensions'])[];
  /** 允许的最大问题数 */
  maxIssues: number;
  /** 允许的严重问题类型 */
  allowedIssueTypes?: string[];
}

export interface GateConfig {
  /** 关卡 ID */
  id: string;
  /** 关卡名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 关联的阶段 */
  phase: 'analysis' | 'segmentation' | 'conversion' | 'merge' | 'final';
  /** 质量标准 */
  criteria: GateCriteria;
  /** 失败时的处理策略 */
  onFail: 'retry' | 'skip' | 'stop' | 'manual_review';
  /** 最大重试次数 */
  maxRetries: number;
  /** 权重配置 */
  weights: Partial<QualityAssessment['dimensions']>;
}

export interface GateResult {
  /** 关卡 ID */
  gateId: string;
  /** 决策 */
  decision: GateDecision;
  /** 质量评估 */
  assessment: QualityAssessment;
  /** 通过/失败原因 */
  reason: string;
  /** 时间戳 */
  timestamp: number;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 重试次数 */
  retryCount: number;
}

export interface GateContext {
  /** 任务 ID */
  taskId: string;
  /** 当前阶段 */
  phase: GateConfig['phase'];
  /** 待评估内容 */
  content: string;
  /** 相关元数据 */
  metadata: Record<string, unknown>;
}

/**
 * 预定义的关卡配置
 */
export const DEFAULT_GATE_CONFIGS: Record<string, GateConfig> = {
  /** 角色提取关卡 */
  analysis_characters: {
    id: 'analysis_characters',
    name: '角色提取质量关卡',
    description: '检查角色提取的准确性和完整性',
    phase: 'analysis',
    criteria: {
      minScore: 60,
      requiredDimensions: ['consistency'],
      maxIssues: 3,
    },
    onFail: 'retry',
    maxRetries: 2,
    weights: { format: 0.1, consistency: 0.5, coherence: 0.2, drama: 0.2 },
  },

  /** 场景分割关卡 */
  segmentation_scenes: {
    id: 'segmentation_scenes',
    name: '场景分割质量关卡',
    description: '检查场景分割的合理性和连贯性',
    phase: 'segmentation',
    criteria: {
      minScore: 65,
      requiredDimensions: ['coherence'],
      maxIssues: 5,
    },
    onFail: 'retry',
    maxRetries: 2,
    weights: { format: 0.15, consistency: 0.2, coherence: 0.45, drama: 0.2 },
  },

  /** 单场景转换关卡 */
  conversion_scene: {
    id: 'conversion_scene',
    name: '场景转换质量关卡',
    description: '检查单个场景转换的格式和内容质量',
    phase: 'conversion',
    criteria: {
      minScore: 70,
      requiredDimensions: ['format', 'coherence'],
      maxIssues: 2,
    },
    onFail: 'retry',
    maxRetries: 3,
    weights: { format: 0.35, consistency: 0.2, coherence: 0.25, drama: 0.2 },
  },

  /** 合并校验关卡 */
  merge_validation: {
    id: 'merge_validation',
    name: '合并校验关卡',
    description: '检查最终剧本的整体质量和一致性',
    phase: 'merge',
    criteria: {
      minScore: 75,
      requiredDimensions: ['format', 'consistency', 'coherence'],
      maxIssues: 3,
    },
    onFail: 'manual_review',
    maxRetries: 1,
    weights: { format: 0.25, consistency: 0.3, coherence: 0.3, drama: 0.15 },
  },

  /** 最终质量关卡 */
  final_quality: {
    id: 'final_quality',
    name: '最终质量关卡',
    description: '剧本最终质量检查',
    phase: 'final',
    criteria: {
      minScore: 80,
      requiredDimensions: ['format', 'consistency', 'coherence', 'drama'],
      maxIssues: 2,
    },
    onFail: 'manual_review',
    maxRetries: 0,
    weights: { format: 0.2, consistency: 0.3, coherence: 0.25, drama: 0.25 },
  },
};

/**
 * 评估质量
 *
 * 若提供 validator，则调用它获取真实 LLM 质量评估；
 * 否则使用基于内容的启发式评估（仅用于无 LLM 时的降级路径）。
 */
export async function evaluateQuality(
  content: string,
  config: GateConfig,
  validator?: (context: GateContext) => Promise<QualityAssessment>,
): Promise<QualityAssessment> {
  // 如果提供了自定义验证器，使用它（真实 LLM 评估）
  if (validator) {
    try {
      const assessment = await validator({
        taskId: 'task',
        phase: config.phase,
        content,
        metadata: {},
      });
      return assessment;
    } catch (err) {
      console.error(`[ReviewGate] validator 评估失败，使用启发式降级:`, err);
    }
  }

  // 默认评估逻辑（启发式降级）
  const textLength = content.trim().length;
  const hasSceneMarker = /^(场景|scene|INT\.|EXT\.)/im.test(content);
  const hasDialogue = /["“”「」]/.test(content);

  const format = textLength > 0 ? (hasSceneMarker ? 85 : 70) : 0;
  const consistency = textLength > 0 ? 80 : 0;
  const coherence = textLength > 0 ? (hasDialogue ? 80 : 65) : 0;
  const drama = textLength > 100 ? 75 : 50;

  const assessment: QualityAssessment = {
    score: Math.round((format + consistency + coherence + drama) / 4),
    passed: textLength > 0,
    dimensions: { format, consistency, coherence, drama },
    issues: textLength === 0 ? ['输出内容为空'] : [],
    suggestions:
      !hasSceneMarker && textLength > 0
        ? ['建议添加场景标题标记（INT./EXT.）']
        : [],
  };

  return assessment;
}

/**
 * 根据质量评估做出关卡决策
 */
export function makeGateDecision(
  assessment: QualityAssessment,
  config: GateConfig,
): { decision: GateDecision; reason: string } {
  // 检查必须通过的维度
  if (config.criteria.requiredDimensions) {
    for (const dim of config.criteria.requiredDimensions) {
      if (assessment.dimensions[dim] < config.criteria.minScore) {
        return {
          decision: 'fail',
          reason: `维度 "${dim}" 分数 ${assessment.dimensions[dim]} 低于最低要求 ${config.criteria.minScore}`,
        };
      }
    }
  }

  // 检查问题数量
  if (assessment.issues.length > config.criteria.maxIssues) {
    return {
      decision: 'fail',
      reason: `问题数量 ${assessment.issues.length} 超过允许的最大值 ${config.criteria.maxIssues}`,
    };
  }

  // 检查总分
  if (assessment.score < config.criteria.minScore) {
    return {
      decision: 'fail',
      reason: `总分 ${assessment.score} 低于最低要求 ${config.criteria.minScore}`,
    };
  }

  // 分数在临界区，需要人工审核
  const threshold = config.criteria.minScore + 10;
  if (assessment.score < threshold) {
    return {
      decision: 'review',
      reason: `分数 ${assessment.score} 在临界区，建议人工审核`,
    };
  }

  return {
    decision: 'pass',
    reason: '通过质量关卡检查',
  };
}

/**
 * 计算加权质量分数
 */
export function calculateWeightedScore(
  dimensions: QualityAssessment['dimensions'],
  weights: Partial<QualityAssessment['dimensions']>,
): number {
  const defaultWeights = {
    format: 0.25,
    consistency: 0.25,
    coherence: 0.25,
    drama: 0.25,
  };

  const finalWeights = { ...defaultWeights, ...weights };

  return Math.round(
    dimensions.format * finalWeights.format +
    dimensions.consistency * finalWeights.consistency +
    dimensions.coherence * finalWeights.coherence +
    dimensions.drama * finalWeights.drama
  );
}
