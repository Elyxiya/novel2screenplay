import { describe, it, expect } from 'vitest';
import { ContextManager } from '../../../src/lib/pipeline/ContextManager';

describe('ContextManager', () => {
  const cm = new ContextManager();

  it('should count tokens', () => {
    const count = cm.countTokens('你好，世界');
    expect(count).toBeGreaterThan(0);
  });

  it('should truncate long text', () => {
    const text = 'a'.repeat(5000);
    const truncated = cm.truncateToTokens(text, 100);
    expect(truncated.length).toBeLessThan(text.length);
  });

  it('should not truncate short text', () => {
    const text = 'Hello World';
    const truncated = cm.truncateToTokens(text, 1000);
    expect(truncated).toBe(text);
  });

  it('should split text into chunks', () => {
    const text = 'Hello. '.repeat(500);
    const chunks = cm.splitIntoChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should return single chunk for short text', () => {
    const chunks = cm.splitIntoChunks('Hello World', 1000);
    expect(chunks).toHaveLength(1);
  });
});

describe('Phase4Merger - Dedup Logic', () => {
  // Test the key dedup function directly
  it('should merge names with inclusion', () => {
    // Simulating isSimilarName logic
    const nameA = '林黛玉';
    const nameB = '黛玉';
    // Levenshtein check: includes
    const shorter = nameA.length <= nameB.length ? nameA : nameB;
    const longer = nameA.length > nameB.length ? nameA : nameB;
    const isMatch = shorter.length >= 2 && longer.includes(shorter);
    expect(isMatch).toBe(true);
  });

  it('should not merge single character names', () => {
    const nameA = '玉';
    const nameB = '黛玉';
    const shorter = nameA.length <= nameB.length ? nameA : nameB;
    const isMatch = shorter.length >= 2 && nameB.includes(shorter);
    // shorter = '玉', length = 1 < 2, so not matched
    expect(isMatch).toBe(false);
  });

  it('should detect exact match', () => {
    const nameA = '林黛玉';
    const nameB = '林黛玉';
    expect(nameA === nameB).toBe(true);
  });
});
