/**
 * Eval runner 核心单测（T2-C1 ~ T2-C4）
 *
 * 直接 import scripts/eval/*.mjs（逻辑单源，node 可直跑、vitest 可测）。
 */

import { describe, it, expect } from 'vitest';

import {
  runDeadCharacterNoSpeakRule,
  runRevealBeforeChapterRule,
  runUnresolvedAliasAsIdRule,
  runIdentityRule,
  sceneSourceChapter,
} from '../../../../../scripts/eval/identity.mjs';

import {
  mean,
  stdDev,
  ciHalfWidth,
  judgeNoiseBand,
  deltaTailThreshold,
  buildStabilityReport,
} from '../../../../../scripts/eval/stability.mjs';

import {
  canonicalize,
  fingerprintCell,
  EvalCache,
} from '../../../../../scripts/eval/manifest.mjs';

import { estimateTokensSync, computeDryRunBudget } from '../../../../../scripts/eval/token-budget.mjs';

import { buildIdentityCells, listSets } from '../../../../../scripts/eval/sets.mjs';

import { parseJudgeVerdicts, passRate, judgeSemanticCell } from '../../../../../scripts/eval/judge.mjs';

import type { Scene, ContentBlock } from '@novel/contracts/screenplay';

// ── 辅助 scene 构造 ──────────────────────────────────────────────────────

const dlg = (characterId: string, line: string, chapterIndex: number) => ({
  type: 'dialogue' as const,
  characterId,
  line,
  sourceRefs: [{ chapterIndex, paragraphIndex: 0, excerpt: line }],
});

function mkScene(sceneNumber: number, sourceChapter: number, content: ContentBlock[], characterIds: string[] = []): Scene {
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

// ── identity 确定性规则 ──────────────────────────────────────────────────

describe('identity rules', () => {
  it('sceneSourceChapter: sourceChapterRange 优先，无则取 sourceRefs 最小章', () => {
    expect(sceneSourceChapter(mkScene(1, 4, [dlg('c', 'x', 7)]))).toBe(4);
    const noRange = { ...mkScene(2, 4, [dlg('c', 'x', 7)]), sourceChapterRange: undefined };
    expect(sceneSourceChapter(noRange)).toBe(7);
    expect(sceneSourceChapter({ ...noRange, content: [] })).toBe(null);
  });

  it('dead-character-no-speak: 死亡章之后的对白 → 失败', () => {
    const scenes = [
      mkScene(1, 4, [dlg('char_1', '交代后事', 4)], ['char_1']),
      mkScene(2, 7, [dlg('char_1', '死后开口', 7)], ['char_1']),
    ];
    const r = runDeadCharacterNoSpeakRule({
      scenes,
      charIdToName: { char_1: '老秦' },
      deadCharacters: [{ name: '老秦', deathChapter: 5 }],
    });
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].message).toContain('老秦');
  });

  it('dead-character-no-speak: 死亡章之前/当章 → 通过', () => {
    const scenes = [mkScene(1, 4, [dlg('char_1', '死前说话', 4)], ['char_1'])];
    const r = runDeadCharacterNoSpeakRule({
      scenes,
      charIdToName: { char_1: '老秦' },
      deadCharacters: [{ name: '老秦', deathChapter: 5 }],
    });
    expect(r.passed).toBe(true);
  });

  it('reveal-before-chapter: 揭示章前点名隐藏身份 → 失败', () => {
    const scenes = [mkScene(1, 3, [dlg('char_2', '我乃前朝公主。', 3)], ['char_2'])];
    const r = runRevealBeforeChapterRule({
      scenes,
      charIdToName: { char_2: '苏晚' },
      reveals: [{ secretName: '前朝公主', revealChapter: 8 }],
    });
    expect(r.passed).toBe(false);
  });

  it('reveal-before-chapter: 揭示章后点名 → 通过', () => {
    const scenes = [mkScene(1, 9, [dlg('char_2', '我乃前朝公主。', 9)], ['char_2'])];
    const r = runRevealBeforeChapterRule({
      scenes,
      charIdToName: { char_2: '苏晚' },
      reveals: [{ secretName: '前朝公主', revealChapter: 8 }],
    });
    expect(r.passed).toBe(true);
  });

  it('unresolved-alias-as-id: 别名直接当 characterId → 失败', () => {
    const scenes = [mkScene(1, 2, [dlg('秦爷', '交给我。', 2)], ['秦爷'])];
    const r = runUnresolvedAliasAsIdRule({
      scenes,
      aliasIndex: { 老秦: 'char_1', 秦爷: 'char_1' },
    });
    expect(r.passed).toBe(false);
    expect(r.failures[0].message).toContain('秦爷');
  });

  it('unresolved-alias-as-id: 已解析为 char_N → 通过', () => {
    const scenes = [mkScene(1, 2, [dlg('char_1', '交给我。', 2)], ['char_1'])];
    const r = runUnresolvedAliasAsIdRule({ scenes, aliasIndex: { 秦爷: 'char_1' } });
    expect(r.passed).toBe(true);
  });

  it('runIdentityRule: 未知 ruleId 返回失败哨兵', () => {
    const r = runIdentityRule('nope', {});
    expect(r.passed).toBe(false);
    expect(r.failures[0].message).toContain('未知规则');
  });
});

// ── judge ────────────────────────────────────────────────────────────────

describe('judge', () => {
  it('parseJudgeVerdicts: 从 JSON 文本解析场景裁决', () => {
    const v = parseJudgeVerdicts('{"scenes":[{"sceneNumber":1,"verdict":"pass"},{"sceneNumber":2,"verdict":"fail","reason":"矛盾"}]}');
    expect(v).toHaveLength(2);
    expect(v[1].verdict).toBe('fail');
  });

  it('parseJudgeVerdicts: 容错（带前后缀文本）', () => {
    const v = parseJudgeVerdicts('好的，结果如下：{"scenes":[{"sceneNumber":1,"verdict":"fail"}]} 结束');
    expect(v[0].verdict).toBe('fail');
  });

  it('passRate: pass 占比', () => {
    expect(passRate([{ verdict: 'pass' }, { verdict: 'fail' }])).toBe(0.5);
    expect(passRate([])).toBe(1);
  });

  it('judgeSemanticCell: 双评委两次调用，取平均分', async () => {
    const caller = {
      call: async (
        messages: Array<{ role: string; content: string }>,
        opts?: Record<string, unknown>,
      ) => {
        const t = opts?.temperature;
        if (t === 0.2) return '{"scenes":[{"sceneNumber":1,"verdict":"pass"}]}';
        return '{"scenes":[{"sceneNumber":1,"verdict":"pass"}]}';
      },
    };
    const r = await judgeSemanticCell({ caller, judgePrompt: 'p', content: 'c' });
    expect(r.scores).toEqual([100, 100]);
    expect(r.agreement).toBe(true);
  });
});

// ── stability（T2-C4） ───────────────────────────────────────────────────

describe('stability', () => {
  it('mean/stdDev 基础统计', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdDev([2, 4, 6])).toBeCloseTo(2, 10);
    expect(stdDev([5])).toBeNaN();
  });

  it('judgeNoiseBand: 2×SD 与 CI 半宽取大', () => {
    const scores = [80, 82, 79, 81, 83];
    const sd = stdDev(scores);
    const band = judgeNoiseBand(scores);
    expect(band).toBeGreaterThanOrEqual(2 * sd);
    expect(band).toBeGreaterThanOrEqual(ciHalfWidth(scores));
  });

  it('deltaTailThreshold: 零方差取兜底 minDelta；高方差按噪声带上取整', () => {
    expect(deltaTailThreshold([80, 80, 80, 80, 80])).toBe(5);
    const noisy = [60, 80, 70, 90, 65];
    const t = deltaTailThreshold(noisy);
    const band = judgeNoiseBand(noisy) ?? 0;
    expect(t).toBeGreaterThanOrEqual(band);
    expect(t).toBeGreaterThan(5);
  });

  it('buildStabilityReport: 逐断言输出均值/SD/噪声带/阈值', () => {
    const report = buildStabilityReport([
      { assertionId: 'identity-contradiction', scores: [80, 82, 79] },
    ]);
    expect(report[0].assertionId).toBe('identity-contradiction');
    expect(report[0].mean).toBe(80.33);
    expect(report[0].deltaTailThreshold).toBeGreaterThanOrEqual(5);
  });
});

// ── manifest（T2-C1 复现单元） ───────────────────────────────────────────

describe('manifest', () => {
  it('canonicalize: 对象按键排序 → 指纹稳定', () => {
    expect(canonicalize({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
    expect(canonicalize({ a: [2, 1] })).toEqual({ a: [2, 1] });
  });

  it('fingerprintCell: 相同字段 → 相同指纹；任一字段变 → 指纹变', () => {
    const base = {
      set: 'identity', sampleId: 's1', stage: 'convert' as const, assertionId: 'dead-character-no-speak',
      modelId: 'deepseek-chat', params: {}, datasetHash: 'd', judgePromptHash: 'j',
    };
    const f1 = fingerprintCell(base);
    const f2 = fingerprintCell(base);
    const f3 = fingerprintCell({ ...base, modelId: 'deepseek-reasoner' });
    expect(f1).toBe(f2);
    expect(f1).not.toBe(f3);
  });

  it('EvalCache: 内存 store 命中/未命中', () => {
    const store = {
      map: new Map<string, unknown>(),
      read: (k: string) => store.map.get(k) ?? null,
      write: (k: string, r: unknown) => {
        store.map.set(k, r);
      },
    };
    const cache = new EvalCache({ read: store.read, write: store.write });
    const cell = {
      set: 'x', sampleId: 'a', stage: 'convert' as const, assertionId: 'r', modelId: 'm',
      params: {}, datasetHash: 'd', judgePromptHash: 'j',
    };
    expect(cache.get(cell)).toBe(null);
    cache.set(cell, { score: 90 });
    expect(cache.get(cell)).toEqual({ score: 90 });
  });
});

// ── token budget（--dry-run） ────────────────────────────────────────────

describe('token budget', () => {
  it('estimateTokensSync: 字符级兜底估算', () => {
    expect(estimateTokensSync('abcd')).toBe(Math.ceil(4 / 0.77));
  });

  it('computeDryRunBudget: 求和 + 每格明细（注入估算器）', async () => {
    const fake = async (cell: { id: string; inputText: string; outputEstimate?: number }) => ({
      inputTokens: 100,
      outputTokens: cell.outputEstimate ?? 200,
      totalTokens: 300,
    });
    const budget = await computeDryRunBudget(
      [{ id: 'a', inputText: 'x' }, { id: 'b', inputText: 'y', outputEstimate: 50 }],
      fake,
    );
    expect(budget.totalInput).toBe(200);
    expect(budget.totalOutput).toBe(250);
    expect(budget.total).toBe(450);
    expect(budget.perCell).toHaveLength(2);
  });
});

// ── sets 注册 ────────────────────────────────────────────────────────────

describe('sets', () => {
  it('listSets 注册 identity-fixture / identity', () => {
    const sets = listSets();
    expect(sets.map((s) => s.name)).toEqual(['identity-fixture', 'identity']);
  });

  it('buildIdentityCells: fixture 生成 4 样本 × 3 规则 = 12 格', () => {
    const cells = buildIdentityCells('identity-fixture');
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.kind === 'rule')).toBe(true);
    expect(cells.every((c) => c.stage === 'convert')).toBe(true);
    expect(new Set(cells.map((c) => c.assertionId)).size).toBe(3);
  });

  it('fixture 样本触发预期失败（规则端到端）', () => {
    const cells = buildIdentityCells('identity-fixture');
    const byId = new Map(cells.map((c) => [c.id, c]));
    expect(runIdentityRule(byId.get('fixture-dead-speaks:dead-character-no-speak')!.assertionId, byId.get('fixture-dead-speaks:dead-character-no-speak')!.data).passed).toBe(false);
    expect(runIdentityRule(byId.get('fixture-reveal-early:reveal-before-chapter')!.assertionId, byId.get('fixture-reveal-early:reveal-before-chapter')!.data).passed).toBe(false);
    expect(runIdentityRule(byId.get('fixture-alias-as-id:unresolved-alias-as-id')!.assertionId, byId.get('fixture-alias-as-id:unresolved-alias-as-id')!.data).passed).toBe(false);
    expect(runIdentityRule(byId.get('fixture-clean:dead-character-no-speak')!.assertionId, byId.get('fixture-clean:dead-character-no-speak')!.data).passed).toBe(true);
  });
});
