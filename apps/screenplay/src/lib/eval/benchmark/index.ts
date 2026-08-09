/**
 * 质量基准运行器（P-评估）
 *
 * 对基准集逐样本调用 LLM 评估器打分，输出报告：
 * - 每个样本的 score / 四维分数 / 命中档位
 * - 校验样本排序：excellent > fair > poor 是否成立（区分度）
 *
 * 手动触发：POST /api/debug/quality-benchmark（需登录，消耗真实 LLM 调用）
 */

import type { LLMProvider } from '../../llm/types';
import type { QualityAssessment } from '../../multi-agent/handoff-protocol';
import { assessWithLLM, serializeScreenplayForEval } from '../llm-quality';
import { BENCHMARK_SAMPLES, type BenchmarkSample, type ExpectedGrade } from './samples';

export interface BenchmarkSampleResult {
  id: string;
  name: string;
  expectedGrade: ExpectedGrade;
  score: number;
  grade: ExpectedGrade;
  dimensions: QualityAssessment['dimensions'];
  passed: boolean;
  suggestions: string[];
  /** 是否落在预期档位（含相邻一档容差） */
  withinExpectation: boolean;
}

export interface BenchmarkReport {
  /** 按 score 降序排序的样本结果（用于查看区分度） */
  samples: BenchmarkSampleResult[];
  /** 排序是否符合 expectedGrade 的预设档位顺序 */
  orderValid: boolean;
  /** 逐条说明 */
  notes: string[];
  durationMs: number;
  evaluatedAt: string;
}

const GRADE_RANK: Record<ExpectedGrade, number> = { poor: 0, fair: 1, good: 2, excellent: 3 };

export function scoreToGrade(score: number): ExpectedGrade {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 55) return 'fair';
  return 'poor';
}

/** 样本得分落在预期档位（或相邻一档）即视为合理，避免绝对档位过严 */
export function withinExpectation(sample: BenchmarkSample, score: number): boolean {
  const actualRank = GRADE_RANK[scoreToGrade(score)];
  const expectedRank = GRADE_RANK[sample.expectedGrade];
  return Math.abs(actualRank - expectedRank) <= 1;
}

export async function runBenchmark(provider: LLMProvider): Promise<BenchmarkReport> {
  const started = Date.now();

  const results: BenchmarkSampleResult[] = [];
  for (const sample of BENCHMARK_SAMPLES) {
    const text = serializeScreenplayForEval(sample.screenplay);
    let assessment: QualityAssessment;
    try {
      assessment = await assessWithLLM(provider, text);
    } catch (err) {
      // LLM 调用失败：记录低分占位，避免整轮中断
      console.error(`[Benchmark] ${sample.id} 评估失败:`, err);
      assessment = { score: 0, passed: false, dimensions: { format: 0, consistency: 0, coherence: 0, drama: 0 }, issues: ['LLM 评估失败'], suggestions: [] };
    }

    results.push({
      id: sample.id,
      name: sample.name,
      expectedGrade: sample.expectedGrade,
      score: assessment.score,
      grade: scoreToGrade(assessment.score),
      dimensions: assessment.dimensions,
      passed: assessment.passed,
      suggestions: assessment.suggestions,
      withinExpectation: withinExpectation(sample, assessment.score),
    });
  }

  // 排序校验：excellent 应 > fair > poor（fair/good 相邻容差）
  const byId = new Map(results.map((r) => [r.id, r]));
  const orderValid = byId.get('excellent')!.score > byId.get('fair')!.score &&
    byId.get('fair')!.score > byId.get('poor')!.score;

  const notes: string[] = [
    orderValid
      ? '排序有效：excellent > fair > poor，评估器具备区分度'
      : '排序异常：高分样本未显著高于低分样本，建议检查评估 Prompt 或调参',
  ];
  for (const r of results) {
    notes.push(`${r.id}: score=${r.score}（预期 ${r.expectedGrade}，实际 ${r.grade}${r.withinExpectation ? ' ✓' : ' ✗ 偏离'})`);
  }

  return {
    samples: [...results].sort((a, b) => b.score - a.score),
    orderValid,
    notes,
    durationMs: Date.now() - started,
    evaluatedAt: new Date().toISOString(),
  };
}
