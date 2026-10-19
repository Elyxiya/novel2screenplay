// @vitest-environment node
/**
 * 输入形态矩阵（P0 之后的回归护栏）
 *
 * 前三轮修掉的 bug 都是同一类：**实现假设 vs 真实文本形态**不一致——
 *   · 溯源章号：模型数原书章号，管线数输入序号
 *   · 行尾：Windows txt 是 CRLF，偏移按 2 字符累加
 *   · 段落：网文单换行分段，管线按空行分块
 * 这里把「换行 × 分段 × 章号写法」的常见组合固化成断言：
 * 同一份逻辑内容，无论以哪种形态进来，解析结果与场景偏移必须一致。
 */
import { describe, it, expect } from 'vitest';
import { parseNovel } from '../lib/novel/parser';
import { Phase2Segmenter } from '../lib/pipeline/Phase2Segmenter';
import type { LLMProvider } from '../lib/llm/types';

const analysis = { characters: [], locations: [], timelineHints: [], rawResponse: '' };
const ctxManager = { truncateToTokens: async (t: string) => t, countTokens: async () => 1 } as never;

/** 12 个非空行，每行 20 字左右 */
const LINES = Array.from({ length: 12 }, (_, i) => `第${i + 1}行正文内容，用于检验段落口径是否一致。`);

function buildDoc(newline: string, mode: 'single' | 'blank' | 'none'): string {
  const joiner = mode === 'blank' ? `${newline}${newline}` : newline;
  const body = mode === 'none' ? LINES.join('') : LINES.join(joiner);
  return `第一章 开端${newline}${newline}${body}`;
}

function providerReturning(scenes: Array<{ s: number; e: number }>): LLMProvider {
  return {
    name: 'matrix-probe',
    modelId: 'matrix-probe-model',
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
      model: 'matrix-probe-model',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }),
    async *chatStream() { /* 探针不需要流式 */ },
  } as unknown as LLMProvider;
}

describe('输入形态矩阵 · 换行', () => {
  const lf = buildDoc('\n', 'single');
  const crlf = buildDoc('\r\n', 'single');
  const cr = buildDoc('\r', 'single');

  it('LF / CRLF / CR 解析出的章节文本完全一致', () => {
    const a = parseNovel(lf);
    const b = parseNovel(crlf);
    const c = parseNovel(cr);

    expect(a.chapters).toHaveLength(1);
    expect(b.chapters).toHaveLength(1);
    expect(c.chapters).toHaveLength(1);

    expect(b.chapters[0].text).toBe(a.chapters[0].text);
    expect(c.chapters[0].text).toBe(a.chapters[0].text);
    expect(b.chapters[0].text).not.toContain('\r');
  });

  it('同一段落口径下，三种换行产出的场景偏移与切片一致', async () => {
    const scenes = [{ s: 0, e: 2 }, { s: 3, e: 5 }, { s: 6, e: 8 }, { s: 9, e: 11 }];
    const seg = new Phase2Segmenter(providerReturning(scenes), ctxManager);

    async function run(doc: string) {
      const text = parseNovel(doc).chapters[0].text;
      const out = await seg.segment([{ index: 0, title: '第一章', text }], analysis as never);
      return out.scenes.map((s) => ({
        start: s.originalStartOffset,
        end: s.originalEndOffset,
        slice: text.slice(s.originalStartOffset, s.originalEndOffset),
      }));
    }

    const fromLf = await run(lf);
    const fromCrlf = await run(crlf);
    const fromCr = await run(cr);

    expect(fromCrlf).toEqual(fromLf);
    expect(fromCr).toEqual(fromLf);
    expect(fromLf).toHaveLength(4);
    for (const s of fromLf) expect(s.slice.trim().length).toBeGreaterThan(0);
  });
});

describe('输入形态矩阵 · 分段', () => {
  it('空行分段与单换行分段解析出的行内容一致（仅分隔符不同）', () => {
    const single = parseNovel(buildDoc('\n', 'single')).chapters[0].text;
    const blank = parseNovel(buildDoc('\n', 'blank')).chapters[0].text;

    const norm = (t: string) => t.split(/\n+/).filter((l) => l.trim()).join('\n');
    expect(norm(blank)).toBe(norm(single));
  });

  it('无空行长文本仍能被场景切分覆盖（不因段落太少而塌成 1 段）', async () => {
    const doc = buildDoc('\n', 'none');
    const text = parseNovel(doc).chapters[0].text;
    const seg = new Phase2Segmenter(providerReturning([{ s: 0, e: 0 }]), ctxManager);

    const out = await seg.segment([{ index: 0, title: '第一章', text }], analysis as never);
    expect(out.scenes).toHaveLength(1);
    expect(out.scenes[0].originalEndOffset).toBeGreaterThan(0);
    expect(out.scenes[0].originalEndOffset).toBeLessThanOrEqual(text.length);
  });
});

describe('输入形态矩阵 · 章号写法', () => {
  const variants = [
    ['第1章 开端', 1],
    ['第一章：开端', 1],
    ['第 一 章 开端', 0], // 含空格：当前正则不支持，走兜底
    ['序章：开端', 1],
    ['Chapter 1: 开端', 1],
  ] as const;

  for (const [heading, expected] of variants) {
    it(`「${heading}」→ ${expected} 章（0 表示走兜底切分）`, () => {
      const text = `${heading}\n\n${LINES.join('\n')}`;
      const result = parseNovel(text);
      if (expected === 0) {
        // 当前正则不支持「第 一 章」这种带空格写法 → 应走兜底并按段落数切分，且给出告警
        expect(result.warnings.some((w) => w.includes('未检测到章节标记'))).toBe(true);
        expect(result.chapters.length).toBeGreaterThanOrEqual(1);
        return;
      }
      expect(result.chapters).toHaveLength(expected);
      expect(result.chapters[0].title.length).toBeGreaterThan(0);
    });
  }

  it('多章混排时章数正确且顺序稳定', () => {
    const doc = [
      '第一章 开端', '', LINES.slice(0, 4).join('\n'),
      '第二章 转折', '', LINES.slice(4, 8).join('\n'),
      '第三章 收束', '', LINES.slice(8).join('\n'),
    ].join('\n\n');
    const result = parseNovel(doc);
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters.map((c) => c.title)).toEqual(['开端', '转折', '收束']);
  });
});

describe('输入形态矩阵 · 其他脏数据', () => {
  it('UTF-8 BOM + 全角空格缩进仍能识别章节', () => {
    const doc = `\uFEFF\u3000第一章 开端\n\n\u3000\u3000${LINES.join('\n\u3000\u3000')}`;
    const result = parseNovel(doc);
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].text).toContain('第1行正文内容');
  });

  it('连续空行不会让章节文本出现空白碎片', () => {
    const doc = `第一章 开端\n\n\n\n${LINES.join('\n\n\n')}`;
    const result = parseNovel(doc);
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].paragraphs.every((p) => p.trim().length > 0)).toBe(true);
  });
});
