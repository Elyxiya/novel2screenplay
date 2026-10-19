// @vitest-environment node
/**
 * Phase 2 段落口径回归（实测 doupo-short 发现）
 *
 * 背景：中文网文多为**单换行分段**，而旧实现按「空行分块」数段落。
 * 模型返回的是行号（0-7 / 8-18 / 19-29），管线却只有 1 个「空行块」，
 * 越界索引被兜成 0 后整章场景全部退化成 [0, 全文]，
 * 后处理把它们当「完全重叠」丢掉——32 个场景只剩 10 个（每章 1 个）。
 *
 * 本次修复：段落 = 非空行；索引夹紧 + 超出时按比例缩放；空区间显式跳过。
 */
import { describe, it, expect } from 'vitest';
import { Phase2Segmenter } from '../lib/pipeline/Phase2Segmenter';
import type { LLMProvider } from '../lib/llm/types';

const analysis = { characters: [], locations: [], timelineHints: [], rawResponse: '' };
/** 不加载 tiktoken：截断直接透传，测试只关心段落口径 */
const ctxManager = { truncateToTokens: async (t: string) => t, countTokens: async () => 1 } as never;

function providerReturning(scenes: Array<{ s: number; e: number }>): LLMProvider {
  return {
    name: 'phase2-probe',
    modelId: 'phase2-probe-model',
    description: 'probe',
    contextWindow: 128000,
    supportsJSONMode: () => true,
    estimateTokens: async (t: string) => Math.ceil(t.length * 1.3),
    chat: async () => ({
      content: JSON.stringify({
        scenes: scenes.map(({ s, e }, i) => ({
          startParagraph: s,
          endParagraph: e,
          draftSlugline: `内景. 屋${i} - 夜`,
          keyCharacterNames: [],
          summary: `s${i}`,
        })),
      }),
      model: 'phase2-probe-model',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }),
    async *chatStream() { /* 探针不需要流式 */ },
  } as unknown as LLMProvider;
}

/** 单换行分段：12 个非空行，没有空行 */
const LINE_TEXT = Array.from({ length: 12 }, (_, i) => `第${i + 1}行正文内容。`).join('\n');

describe('Phase 2 段落口径（单换行分段）', () => {
  it('模型按行号切 4 段时，4 个场景都保留且偏移递增', async () => {
    const seg = new Phase2Segmenter(providerReturning([
      { s: 0, e: 2 }, { s: 3, e: 5 }, { s: 6, e: 8 }, { s: 9, e: 11 },
    ]), ctxManager);

    const out = await seg.segment([{ index: 0, title: '第一章', text: LINE_TEXT }], analysis as never);

    expect(out.scenes).toHaveLength(4);
    for (const s of out.scenes) {
      expect(s.originalEndOffset).toBeGreaterThan(s.originalStartOffset);
    }
    const starts = out.scenes.map((s) => s.originalStartOffset);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    // 最后一个场景应覆盖到章节末尾
    expect(out.scenes[3].originalEndOffset).toBe(LINE_TEXT.length);
  });

  it('模型给出远超行数的索引时按比例缩放，而不是塌成 1 个场景', async () => {
    const seg = new Phase2Segmenter(providerReturning([
      { s: 0, e: 50 }, { s: 51, e: 99 },
    ]), ctxManager);

    const out = await seg.segment([{ index: 0, title: '第一章', text: LINE_TEXT }], analysis as never);

    expect(out.scenes).toHaveLength(2);
    expect(out.scenes[1].originalStartOffset).toBeGreaterThan(out.scenes[0].originalStartOffset);
    expect(out.scenes[1].originalEndOffset).toBe(LINE_TEXT.length);
  });

  it('空行分段的老样本仍然正确切分（回归保护）', async () => {
    // 每段 20 字 × 6 段：足够长，避免被 mergeAdjacentScenes 合并（<800 字同地点才合并）
    const paras = ['甲', '乙', '丙', '丁', '戊', '己'].map((c) => c.repeat(20));
    const text = paras.join('\n\n');

    const seg = new Phase2Segmenter(providerReturning([
      { s: 0, e: 1 }, { s: 2, e: 3 }, { s: 4, e: 5 },
    ]), ctxManager);

    const out = await seg.segment([{ index: 0, title: '第一章', text }], analysis as never);

    expect(out.scenes).toHaveLength(3);
    expect(out.scenes[0].originalStartOffset).toBe(0);
    expect(out.scenes[2].originalEndOffset).toBe(text.length);
    for (const s of out.scenes) {
      expect(s.originalEndOffset).toBeGreaterThan(s.originalStartOffset);
      expect(s.originalEndOffset).toBeLessThanOrEqual(text.length);
    }
  });
});
