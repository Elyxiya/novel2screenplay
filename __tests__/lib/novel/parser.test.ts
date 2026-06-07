import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseNovel, validateFile } from '../../../src/lib/novel/parser';

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, '../../fixtures', name), 'utf-8');
}

describe('Novel Parser', () => {
  it('should parse a multi-chapter novel', () => {
    const text = loadFixture('sample-chapter1.txt') +
      '\n\n' + loadFixture('sample-chapter2.txt') +
      '\n\n' + loadFixture('sample-chapter3.txt');
    const result = parseNovel(text);
    expect(result.chapters.length).toBeGreaterThanOrEqual(1);
    expect(result.title).toBeTruthy();
  });

  it('should detect chapter headers', () => {
    const text = '第一章 青云山巅\n\n内容...\n\n第二章 旧梦如昨\n\n内容...';
    const result = parseNovel(text);
    expect(result.chapters.length).toBe(2);
  });

  it('should handle empty text', () => {
    const result = parseNovel('');
    expect(result.chapters).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should handle text without chapter markers', () => {
    const text = '这是一段没有章节标记的文本。\n\n这是第二段。\n\n这是第三段。';
    const result = parseNovel(text);
    expect(result.chapters.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should extract paragraphs from chapters', () => {
    const result = parseNovel('第一章 测试\n\n段落一。\n\n段落二。\n\n段落三。');
    if (result.chapters.length > 0) {
      expect(result.chapters[0].paragraphs.length).toBeGreaterThan(0);
    }
  });
});

describe('File Validation', () => {
  it('should accept .txt files', () => {
    expect(validateFile({ name: 'test.txt', size: 100 })).toBeNull();
  });

  it('should reject non-txt files', () => {
    expect(validateFile({ name: 'test.pdf', size: 100 })).not.toBeNull();
  });

  it('should reject files over 2MB', () => {
    expect(validateFile({ name: 'test.txt', size: 3 * 1024 * 1024 })).not.toBeNull();
  });

  it('should reject empty files', () => {
    expect(validateFile({ name: 'test.txt', size: 0 })).not.toBeNull();
  });
});
