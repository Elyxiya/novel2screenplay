/**
 * identity-rules（TS 运行时版）单测（Task 4.1）
 *
 * 与 scripts/eval/identity.mjs 的确定性规则保持同口径（runner.test.ts 已有 .mjs 版覆盖），
 * 此处验证 TS 移植 + runIdentityAssessment 聚合 + 与 gate 的集成语义。
 */

import { describe, it, expect } from 'vitest';
import type { Scene, ContentBlock } from '@novel/contracts/screenplay';
import {
  DEFAULT_IDENTITY_RULE_IDS,
  sceneSourceChapter,
  runDeadCharacterNoSpeakRule,
  runRevealBeforeChapterRule,
  runUnresolvedAliasAsIdRule,
  runIdentityRule,
  runIdentityAssessment,
  type IdentityRuleData,
} from '@/lib/eval/identity-rules';

// ── 辅助 scene 构造（与 runner.test.ts 同口径） ──────────────────────────

const dlg = (characterId: string, line: string, chapterIndex: number): ContentBlock => ({
  type: 'dialogue',
  characterId,
  line,
  sourceRefs: [{ chapterIndex, paragraphIndex: 0, excerpt: line }],
});

function mkScene(
  sceneNumber: number,
  sourceChapter: number,
  content: ContentBlock[],
  characterIds: string[] = [],
): Scene {
  return {
    sceneNumber,
    slugline: `SC ${sceneNumber}`,
    timeOfDay: 'night',
    locationId: 'loc_1',
    characterIds,
    content,
    sourceChapterRange: [sourceChapter, sourceChapter],
    summary: '',
  };
}

const baseData = (scenes: Scene[]): IdentityRuleData => ({
  scenes,
  charIdToName: {},
  deadCharacters: [],
  reveals: [],
  aliasIndex: {},
});

describe('identity-rules · sceneSourceChapter', () => {
  it('sourceChapterRange 优先，无则取 sourceRefs 最小章', () => {
    expect(sceneSourceChapter(mkScene(1, 4, [dlg('c', 'x', 7)]))).toBe(4);
    const noRange = { ...mkScene(2, 4, [dlg('c', 'x', 7)]), sourceChapterRange: undefined };
    expect(sceneSourceChapter(noRange)).toBe(7);
    expect(sceneSourceChapter({ ...noRange, content: [] })).toBe(null);
  });
});

describe('identity-rules · dead-character-no-speak', () => {
  it('死亡章之后的对白 → 失败（带场景号）', () => {
    const scenes = [mkScene(3, 6, [dlg('char_1', '我还活着', 6)])];
    const r = runDeadCharacterNoSpeakRule({
      ...baseData(scenes),
      charIdToName: { char_1: '老秦' },
      deadCharacters: [{ name: '老秦', deathChapter: 5 }],
    });
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].sceneNumber).toBe(3);
    expect(r.failures[0].message).toContain('老秦');
  });

  it('死亡章之前/同章的对白 → 通过', () => {
    const scenes = [mkScene(2, 4, [dlg('char_1', '还在', 4)])];
    const r = runDeadCharacterNoSpeakRule({
      ...baseData(scenes),
      charIdToName: { char_1: '老秦' },
      deadCharacters: [{ name: '老秦', deathChapter: 5 }],
    });
    expect(r.passed).toBe(true);
  });
});

describe('identity-rules · reveal-before-chapter', () => {
  it('揭示章前点名隐藏身份 → 失败', () => {
    const scenes = [mkScene(4, 3, [dlg('char_2', '我乃前朝公主。', 3)], ['char_2'])];
    const r = runRevealBeforeChapterRule({
      ...baseData(scenes),
      charIdToName: { char_2: '苏晚' },
      reveals: [{ secretName: '前朝公主', revealChapter: 8 }],
    });
    expect(r.passed).toBe(false);
    expect(r.failures[0].sceneNumber).toBe(4);
  });

  it('揭示章后点名 → 通过', () => {
    const scenes = [mkScene(9, 9, [dlg('char_2', '我乃前朝公主。', 9)], ['char_2'])];
    const r = runRevealBeforeChapterRule({
      ...baseData(scenes),
      charIdToName: { char_2: '苏晚' },
      reveals: [{ secretName: '前朝公主', revealChapter: 8 }],
    });
    expect(r.passed).toBe(true);
  });
});

describe('identity-rules · unresolved-alias-as-id', () => {
  it('别名直接当 characterId → 失败', () => {
    const scenes = [mkScene(5, 2, [dlg('秦爷', '动手', 2)])];
    const r = runUnresolvedAliasAsIdRule({
      ...baseData(scenes),
      aliasIndex: { 秦爷: 'char_1' },
    });
    expect(r.passed).toBe(false);
    expect(r.failures[0].sceneNumber).toBe(5);
    expect(r.failures[0].message).toContain('秦爷');
  });

  it('规范 char_N id → 通过', () => {
    const scenes = [mkScene(5, 2, [dlg('char_1', '动手', 2)])];
    const r = runUnresolvedAliasAsIdRule({
      ...baseData(scenes),
      aliasIndex: { 秦爷: 'char_1' },
    });
    expect(r.passed).toBe(true);
  });
});

describe('identity-rules · runIdentityRule / runIdentityAssessment', () => {
  it('未知规则 → 明确失败并提示未知规则', () => {
    const r = runIdentityRule('no-such-rule', baseData([]));
    expect(r.passed).toBe(false);
    expect(r.failures[0].message).toContain('未知规则');
  });

  it('空标注 → 全规则通过（零误报）', () => {
    const signal = runIdentityAssessment(baseData([mkScene(1, 1, [dlg('char_1', 'hi', 1)])]));
    expect(signal.passed).toBe(true);
    expect(signal.score).toBe(100);
    expect(signal.failures).toHaveLength(0);
  });

  it('聚合：多规则失败累计入 failures，扣分按失败数计', () => {
    const scenes = [
      mkScene(3, 6, [dlg('char_1', '我还活着', 6)]),
      mkScene(5, 2, [dlg('秦爷', '动手', 2)]),
    ];
    const signal = runIdentityAssessment({
      ...baseData(scenes),
      charIdToName: { char_1: '老秦' },
      deadCharacters: [{ name: '老秦', deathChapter: 5 }],
      aliasIndex: { 秦爷: 'char_1' },
    });
    expect(signal.passed).toBe(false);
    expect(signal.failures).toHaveLength(2);
    expect(signal.failures.map((f) => f.sceneNumber).sort()).toEqual([3, 5]);
    expect(signal.score).toBe(100 - 2 * 20);
  });

  it('默认规则集 = 三个确定性规则', () => {
    expect(DEFAULT_IDENTITY_RULE_IDS).toEqual([
      'dead-character-no-speak',
      'reveal-before-chapter',
      'unresolved-alias-as-id',
    ]);
  });
});
