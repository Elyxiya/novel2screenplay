import { describe, it, expect } from 'vitest';
import {
  groupParagraphsIntoScenes,
  splitParagraphsWithOffsets,
} from '@/lib/pipeline/phase2-fallback';

describe('splitParagraphsWithOffsets —— 段落 = 非空行', () => {
  it('行号保留原文位置（空行不占段号）', () => {
    const text = '第一行\n\n第二行\n第三行';
    const paras = splitParagraphsWithOffsets(text);
    expect(paras.map((p) => p.index)).toEqual([0, 2, 3]);
    expect(paras.map((p) => p.text)).toEqual(['第一行', '第二行', '第三行']);
  });

  it('字符偏移能切回原文', () => {
    const text = '甲\n乙乙\n\n丙';
    const paras = splitParagraphsWithOffsets(text);
    for (const p of paras) {
      expect(text.slice(p.start, p.end)).toBe(p.text);
    }
  });

  it('与主路径一致：单换行也成段（不是空行分块）', () => {
    const text = 'A\nB\nC';
    expect(splitParagraphsWithOffsets(text)).toHaveLength(3);
  });
});

describe('groupParagraphsIntoScenes —— 按 token 预算分组', () => {
  const paras = splitParagraphsWithOffsets('a\nb\n\nc\nd');

  it('超预算即切，区间为闭区间行号', () => {
    const spans = groupParagraphsIntoScenes(paras, [10, 10, 10, 10], 25);
    expect(spans).toHaveLength(2);
    expect(spans[0].startParagraph).toBe(0);
    expect(spans[0].endParagraph).toBe(1);
    expect(spans[1].startParagraph).toBe(3);
    expect(spans[1].endParagraph).toBe(4);
  });

  it('全部在预算内 → 一个场景', () => {
    const spans = groupParagraphsIntoScenes(paras, [1, 1, 1, 1], 1000);
    expect(spans).toHaveLength(1);
    expect(spans[0].endParagraph).toBe(4);
  });

  it('空输入不崩', () => {
    expect(groupParagraphsIntoScenes([], [], 100)).toEqual([]);
  });
});
