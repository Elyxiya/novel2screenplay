import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from '@/lib/llm/prompts/segment';

/**
 * Phase 2 prompt 的口径回归。
 *
 * 为什么需要：这两条是「口径」而不是「实现」——实现有单测（calculateCharOffsets 等），
 * 但 prompt 被改坏不会让任何代码测试变红，只会让模型输出悄悄退化。
 * 实测代价：候选池写成角色卡时，豆豆被标进了整章都没提他的第 10 章。
 */
describe('Phase 2 segment prompt 口径', () => {
  it('候选池是本章原文，角色卡只用于归一', () => {
    expect(SYSTEM_PROMPT).toContain('本章原文实际出现');
    expect(SYSTEM_PROMPT).toContain('不是候选池');
    expect(SYSTEM_PROMPT).toContain('归一');
  });

  it('宁可少写，禁止从清单里猜', () => {
    expect(SYSTEM_PROMPT).toContain('宁可少写');
  });

  it('段落口径 = 非空行（与 Phase2Segmenter 的坐标系一致）', () => {
    expect(SYSTEM_PROMPT).toContain('非空行');
    expect(SYSTEM_PROMPT).toContain('startParagraph');
  });

  it('输出契约字段齐全', () => {
    for (const field of ['startParagraph', 'endParagraph', 'draftSlugline', 'keyCharacterNames', 'summary']) {
      expect(SYSTEM_PROMPT).toContain(field);
    }
  });
});
