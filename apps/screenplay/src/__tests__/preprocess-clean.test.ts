import { describe, it, expect } from 'vitest';
import { cleanNovelText, classifyNoiseLine } from '@/lib/preprocess/clean';

describe('网文噪声行清洗（FIX-11）', () => {
  it('命中：站点水印 / 章尾引导 / 短广告行 / 乱码行', () => {
    expect(classifyNoiseLine('最新网址 www.xbiquge.com，请记住本站！')).toBe('watermark');
    expect(classifyNoiseLine('本章未完，点击下一页继续阅读')).toBe('chapter-tail');
    expect(classifyNoiseLine('天才一秒记住本站，最新章节最快更新')).toBe('ad');
    expect(classifyNoiseLine('�#@$%^&*()_+{}|<>?~`')).toBe('garbled');
  });

  it('白名单：长正文行含广告词也保留（>60 字）', () => {
    const longProse =
      '他站在山巅望着远处的云海，忽然想起师父临终前说过的那句话，求月票这三个字当然不会出现在这里。山风猎猎，衣袂翻飞，他的眼神逐渐坚定。';
    expect(longProse.length).toBeGreaterThan(60);
    expect(classifyNoiseLine(longProse)).toBeNull();
  });

  it('白名单：普通对白与叙述原样保留', () => {
    expect(classifyNoiseLine('“你来了。”他淡淡地说。')).toBeNull();
    expect(classifyNoiseLine('第一章 开端')).toBeNull();
    expect(classifyNoiseLine('')).toBeNull();
  });

  it('清洗主流程：文本重组 + 分规则计数 + 样本截断', () => {
    const raw = [
      '第一章 开端',
      '',
      '他推门而入。',
      '请记住本站 www.example-novel.com',
      '天才一秒记住本站，最新章节最快更新',
      '',
      '屋内空无一人。',
      '本章未完，点击下一页继续阅读',
      '�#@$%^&*()_+{}|:<>?~`',
      '窗外雷声滚滚。',
    ].join('\n');

    const { text, report } = cleanNovelText(raw);

    expect(report.removedLines).toBe(4);
    expect(report.byRule).toEqual({ watermark: 1, 'chapter-tail': 1, garbled: 1, ad: 1 });
    expect(report.samples).toHaveLength(4);
    expect(report.samples[0].length).toBeLessThanOrEqual(60);

    // 保留行与空白行结构不被破坏
    const lines = text.split('\n');
    expect(lines).toContain('第一章 开端');
    expect(lines).toContain('他推门而入。');
    expect(lines).toContain('屋内空无一人。');
    expect(lines).toContain('窗外雷声滚滚。');
    expect(text).not.toContain('www.example-novel.com');
    expect(text).not.toContain('本章未完');
  });

  it('零命中：文本原样返回（逐字符相等）', () => {
    const raw = '第一章 开端\n\n他推门而入。\n“你来了。”';
    const { text, report } = cleanNovelText(raw);
    expect(text).toBe(raw);
    expect(report.removedLines).toBe(0);
    expect(report.byRule).toEqual({});
  });

  it('样本上限可配', () => {
    const raw = Array.from({ length: 5 }, (_, i) => `本章未完，点击下一页 ${i}`).join('\n');
    const { report } = cleanNovelText(raw, { maxSamples: 2 });
    expect(report.removedLines).toBe(5);
    expect(report.samples).toHaveLength(2);
  });
});
