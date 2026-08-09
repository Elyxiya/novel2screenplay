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
  it('has 8 samples with unique ids, valid grades and 4-grade coverage', () => {
    expect(BENCHMARK_SAMPLES).toHaveLength(8);
    const ids = BENCHMARK_SAMPLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(8);
    for (const s of BENCHMARK_SAMPLES) {
      expect(GRADES).toContain(s.expectedGrade);
    }
    // 四档均有覆盖（excellent/good/fair/poor）
    const grades = new Set(BENCHMARK_SAMPLES.map((s) => s.expectedGrade));
    for (const g of GRADES) expect(grades.has(g)).toBe(true);
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
    // runBenchmark 按样本顺序调用：excellent → good → fair → poor → weak-consistency → weak-coherence → weak-drama → weak-format
    const scores = [92, 78, 65, 42, 62, 48, 52, 42];
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
    expect(report.allWithinExpectation).toBe(true);
    expect(report.samples).toHaveLength(8);
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
    expect(report.samples).toHaveLength(8);
  });

  it('flags expectation drift when a sample misses its expected grade', async () => {
    // excellent 被低估到 fair（差 2 档越界）、fair/poor 被高估到 excellent
    const scores = [55, 80, 90, 85, 60, 60, 60, 60];
    let call = 0;
    const provider = {
      name: 'mock',
      modelId: 'mock-model',
      chat: vi.fn().mockImplementation(async () => {
        return { content: JSON.stringify({ overall: scores[call++] }), usage: undefined };
      }),
    } as unknown as LLMProvider;

    const report = await runBenchmark(provider);
    expect(report.orderValid).toBe(false); // excellent(55) 未高于 fair(90)
    expect(report.allWithinExpectation).toBe(false);
  });

  it('tolerates LLM failure with zero-score placeholder', async () => {
    const provider = {
      name: 'mock',
      modelId: 'mock-model',
      chat: vi.fn().mockRejectedValue(new Error('LLM down')),
    } as unknown as LLMProvider;

    const report = await runBenchmark(provider);
    expect(report.samples).toHaveLength(8);
    expect(report.samples.every((s) => s.score === 0)).toBe(true);
    expect(report.orderValid).toBe(false);
    expect(report.allWithinExpectation).toBe(false);
  });
});
