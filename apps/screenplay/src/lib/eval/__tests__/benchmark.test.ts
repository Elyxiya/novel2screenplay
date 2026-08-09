import { describe, it, expect, vi } from 'vitest';
import { BENCHMARK_SAMPLES, type ExpectedGrade } from '../benchmark/samples';
import {
  runBenchmark,
  scoreToGrade,
  withinExpectation,
  type BenchmarkSampleResult,
} from '../benchmark';
import { serializeScreenplayForEval } from '../llm-quality';
import type { LLMProvider } from '../../llm/types';

const GRADES: ExpectedGrade[] = ['excellent', 'good', 'fair', 'poor'];

describe('benchmark samples', () => {
  it('has 3 samples with unique ids and valid grades', () => {
    expect(BENCHMARK_SAMPLES).toHaveLength(3);
    const ids = BENCHMARK_SAMPLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    for (const s of BENCHMARK_SAMPLES) {
      expect(GRADES).toContain(s.expectedGrade);
    }
  });

  it('all samples are valid screenplays and serializable', () => {
    for (const s of BENCHMARK_SAMPLES) {
      const yaml = serializeScreenplayForEval(s.screenplay);
      expect(yaml.length).toBeGreaterThan(50);
      // 标题正确写入
      expect(yaml).toContain(s.screenplay.metadata.title);
    }
  });

  it('poor sample is structurally weaker than excellent', () => {
    const excellent = BENCHMARK_SAMPLES.find((s) => s.id === 'excellent')!.screenplay;
    const poor = BENCHMARK_SAMPLES.find((s) => s.id === 'poor')!.screenplay;
    expect(excellent.scenes.length).toBeGreaterThan(poor.scenes.length);
    expect(excellent.metadata.totalScenes).toBeGreaterThan(poor.metadata.totalScenes);
    // 差样本对白占比为 0
    expect(poor.analytics?.dialoguePercentage ?? 0).toBe(0);
    expect(excellent.analytics?.dialoguePercentage ?? 0).toBeGreaterThan(0);
  });
});

describe('scoreToGrade', () => {
  it('maps score ranges to grades', () => {
    expect(scoreToGrade(90)).toBe('excellent');
    expect(scoreToGrade(85)).toBe('excellent');
    expect(scoreToGrade(75)).toBe('good');
    expect(scoreToGrade(60)).toBe('fair');
    expect(scoreToGrade(40)).toBe('poor');
  });
});

describe('withinExpectation', () => {
  it('allows adjacent grade tolerance', () => {
    const fair = BENCHMARK_SAMPLES.find((s) => s.id === 'fair')!;
    expect(withinExpectation(fair, 75)).toBe(true); // fair 得 good 档，相邻
    expect(withinExpectation(fair, 60)).toBe(true); // fair 得 fair 档
    expect(withinExpectation(fair, 90)).toBe(false); // 偏离 2 档
  });
});

describe('runBenchmark', () => {
  it('reports order validity when scores are correctly ranked', async () => {
    // runBenchmark 按样本顺序调用：excellent → fair → poor
    const scores = [90, 65, 40];
    let call = 0;
    const provider = {
      name: 'mock',
      modelId: 'mock-model',
      chat: vi.fn().mockImplementation(async () => {
        return { content: JSON.stringify({ overall: scores[call++] }), usage: undefined };
      }),
    } as unknown as LLMProvider;

    const report = await runBenchmark(provider);
    expect(report.orderValid).toBe(true);
    expect(report.samples).toHaveLength(3);
    const sorted = report.samples as BenchmarkSampleResult[];
    expect(sorted[0].score).toBeGreaterThan(sorted[1].score);
    expect(sorted[1].score).toBeGreaterThan(sorted[2].score);
  });

  it('reports order invalid when ranking is broken', async () => {
    const provider = {
      name: 'mock',
      modelId: 'mock-model',
      chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ overall: 50 }), usage: undefined }),
    } as unknown as LLMProvider;

    const report = await runBenchmark(provider);
    expect(report.orderValid).toBe(false);
  });

  it('tolerates LLM failure with zero-score placeholder', async () => {
    const provider = {
      name: 'mock',
      modelId: 'mock-model',
      chat: vi.fn().mockRejectedValue(new Error('LLM down')),
    } as unknown as LLMProvider;

    const report = await runBenchmark(provider);
    expect(report.samples).toHaveLength(3);
    expect(report.samples.every((s) => s.score === 0)).toBe(true);
    expect(report.orderValid).toBe(false);
  });
});
