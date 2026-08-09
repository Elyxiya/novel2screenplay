import { describe, it, expect, vi } from 'vitest';
import {
  assessWithLLM,
  serializeScreenplayForEval,
  safeJsonParse,
  clampScore,
} from '../llm-quality';
import type { LLMProvider } from '../../llm/types';
import { BENCHMARK_SAMPLES } from '../benchmark/samples';

function mockProvider(content: string): LLMProvider {
  return {
    name: 'mock',
    modelId: 'mock-model',
    chat: vi.fn().mockResolvedValue({ content, usage: undefined }),
  } as unknown as LLMProvider;
}

describe('clampScore', () => {
  it('clamps out-of-range scores', () => {
    expect(clampScore(-10)).toBe(0);
    expect(clampScore(150)).toBe(100);
    expect(clampScore(95.4)).toBe(95);
  });

  it('falls back to 70 for non-numeric input', () => {
    expect(clampScore(undefined)).toBe(70);
    expect(clampScore('abc')).toBe(70);
    expect(clampScore(NaN)).toBe(70);
  });
});

describe('safeJsonParse', () => {
  it('parses plain JSON', () => {
    expect(safeJsonParse('{"overall": 88}')).toEqual({ overall: 88 });
  });

  it('extracts JSON from wrapped markdown', () => {
    const text = '```json\n{"overall": 88}\n```';
    expect(safeJsonParse(text)).toEqual({ overall: 88 });
  });

  it('returns empty object on failure', () => {
    expect(safeJsonParse('not json at all')).toEqual({});
  });
});

describe('assessWithLLM', () => {
  it('parses LLM JSON into QualityAssessment', async () => {
    const provider = mockProvider(
      JSON.stringify({
        format: 80,
        consistency: 75,
        coherence: 90,
        dramaticTension: 85,
        overall: 82,
        suggestions: ['加强场景转换', '细化角色动机'],
      }),
    );

    const a = await assessWithLLM(provider, '剧本内容');
    expect(a.score).toBe(82);
    expect(a.passed).toBe(true); // 82 >= 75
    expect(a.dimensions).toEqual({ format: 80, consistency: 75, coherence: 90, drama: 85 });
    expect(a.suggestions).toHaveLength(2);
  });

  it('uses custom passThreshold', async () => {
    const provider = mockProvider(JSON.stringify({ overall: 82 }));
    const a = await assessWithLLM(provider, 'x', { passThreshold: 90 });
    expect(a.passed).toBe(false);
  });

  it('degrades to 70 fallback on invalid JSON', async () => {
    const provider = mockProvider('LLM 返回了纯文本而非 JSON');
    const a = await assessWithLLM(provider, 'x');
    expect(a.score).toBe(70);
    expect(a.dimensions.format).toBe(70);
  });

  it('clamps extreme scores', async () => {
    const provider = mockProvider(JSON.stringify({ overall: 500, format: -5 }));
    const a = await assessWithLLM(provider, 'x');
    expect(a.score).toBe(100);
    expect(a.dimensions.format).toBe(0);
  });

  it('truncates long content to maxContentChars', async () => {
    const provider = mockProvider(JSON.stringify({ overall: 70 }));
    const longContent = 'a'.repeat(20000);
    await assessWithLLM(provider, longContent, { maxContentChars: 100 });
    const call = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const userMsg = (call[0] as Array<{ content: string }>)[1].content;
    expect(userMsg.length).toBeLessThan(20000);
    expect(userMsg).toContain('a'.repeat(100));
  });
});

describe('serializeScreenplayForEval', () => {
  it('serializes benchmark samples to text', () => {
    for (const sample of BENCHMARK_SAMPLES) {
      const text = serializeScreenplayForEval(sample.screenplay);
      expect(text.length).toBeGreaterThan(50);
    }
  });
});
