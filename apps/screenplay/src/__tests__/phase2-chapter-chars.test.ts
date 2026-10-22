import { describe, it, expect } from 'vitest';
import { selectChapterCharacters } from '@/lib/pipeline/phase2-chapter-chars';

const card = [
  { name: '黎恩·怀特', aliases: ['黎恩'] },
  { name: '尼斯·拉尔森', aliases: [] },
  { name: '琼斯', aliases: [] },
];

describe('selectChapterCharacters —— 按原文出现裁剪', () => {
  it('只保留本章出现的角色（含别名）', () => {
    const text = '黎恩抬起头，看向琼斯。';
    const r = selectChapterCharacters(card, text);
    expect(r.selected.map((c) => c.name)).toEqual(['黎恩·怀特', '琼斯']);
    expect(r.cropped).toBe(true);
  });

  it('全名在原文出现也算', () => {
    const r = selectChapterCharacters(card, '尼斯·拉尔森推开门。');
    expect(r.selected.map((c) => c.name)).toEqual(['尼斯·拉尔森']);
  });

  it('一个都没命中 → 回落全量（不让模型盲切）', () => {
    const r = selectChapterCharacters(card, '海风吹过空无一人的甲板。');
    expect(r.selected).toHaveLength(3);
    expect(r.cropped).toBe(false);
    expect(r.hits).toBe(0);
  });

  it('全量都命中 → 不算裁剪', () => {
    const r = selectChapterCharacters(card, '黎恩·怀特、尼斯·拉尔森与琼斯在三楼对视。');
    expect(r.cropped).toBe(false);
    expect(r.selected).toHaveLength(3);
  });

  it('空角色卡不崩', () => {
    const r = selectChapterCharacters([], '任意文本');
    expect(r.selected).toHaveLength(0);
  });
});
