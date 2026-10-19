#!/usr/bin/env node
/**
 * 金标注 / 评分纯函数零成本单测
 *
 *   node scripts/eval/annotation.test.mjs
 *
 * 不跑 LLM、不读库：只守卫「口径」本身——同名/别名匹配、IoU 阈值、
 * 确定性切分、循环论证检查、reviewed 样本才计入正式分数。
 */

import assert from 'node:assert/strict';
import {
  GOLD_SCHEMA,
  aliasSetOf,
  buildDraftAnnotation,
  checkIndependence,
  hashString,
  iou,
  macroAverage,
  normalizeName,
  scorePhase1,
  scorePhase2,
  scoreTraceability,
  splitFor,
  summarizeEvaluation,
  validateGold,
} from './annotation.mjs';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

// ── 规范化 ──────────────────────────────────────────────────────────────
check('normalizeName 去空白/间隔号/标点并小写', () => {
  assert.equal(normalizeName('白 冷叶'), '白冷叶');
  assert.equal(normalizeName('白·冷叶'), '白冷叶');
  assert.equal(normalizeName('  ABC '), 'abc');
  assert.equal(normalizeName(undefined), '');
});

check('aliasSetOf 合并 canonical 与 aliases', () => {
  const set = aliasSetOf({ name: '白冷叶', aliases: ['韩晓龙', '韩少'] });
  assert.ok(set.has('白冷叶'));
  assert.ok(set.has('韩晓龙'));
  assert.equal(set.size, 3);
});

// ── 校验 ────────────────────────────────────────────────────────────────
const baseGold = () => ({
  schema: GOLD_SCHEMA,
  sampleId: 's1',
  meta: { chapterCount: 2, reviewed: true },
  characters: [
    { name: '白冷叶', aliases: ['韩晓龙'], isMajor: true },
    { name: '方晓语', aliases: [], isMajor: false },
  ],
  scenes: [
    { chapterIndex: 0, startParagraph: 0, endParagraph: 2 },
    { chapterIndex: 1, startParagraph: 0, endParagraph: 1 },
  ],
  keyDialogues: [],
});

check('合法标注通过校验', () => {
  const r = validateGold(baseGold());
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.errors.length, 0);
});

check('schema 不符 / 缺 sampleId 报错', () => {
  const bad = { ...baseGold(), schema: 'other', sampleId: '' };
  const r = validateGold(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('schema')));
  assert.ok(r.errors.some((e) => e.includes('sampleId')));
});

check('角色重名报错', () => {
  const gold = baseGold();
  gold.characters.push({ name: '白 冷叶', aliases: [] });
  const r = validateGold(gold);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('角色重名')));
});

check('章号越界 / 段落倒置报错', () => {
  const gold = baseGold();
  gold.scenes.push({ chapterIndex: 9, startParagraph: 0, endParagraph: 0 });
  gold.scenes.push({ chapterIndex: 0, startParagraph: 5, endParagraph: 1 });
  const r = validateGold(gold);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('超出章节数')));
  assert.ok(r.errors.some((e) => e.includes('startParagraph')));
});

check('未抽检样本给 warning 而非 error', () => {
  const gold = baseGold();
  gold.meta.reviewed = false;
  const r = validateGold(gold);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes('尚未抽检')));
});

// ── 确定性切分 ──────────────────────────────────────────────────────────
check('hashString 稳定且非负', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.ok(Number.isInteger(hashString('abc')) && hashString('abc') >= 0);
});

check('splitFor 同样本永远同桶，且两桶都非空', () => {
  assert.equal(splitFor('xiuzhen-short'), splitFor('xiuzhen-short'));
  const buckets = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((s) => splitFor(s)));
  assert.deepEqual([...buckets].sort(), ['holdout', 'train']);
});

// ── Phase 1 匹配 ────────────────────────────────────────────────────────
check('别名命中算匹配（韩晓龙 → 白冷叶）', () => {
  const r = scorePhase1(baseGold().characters, [
    { name: '韩晓龙', aliases: [] },
    { name: '方晓语', aliases: [] },
  ]);
  assert.equal(r.matched, 2);
  assert.equal(r.precision, 1);
  assert.equal(r.recall, 1);
});

check('漏抽与多抽分别进 missing / extra，并影响 P/R', () => {
  const r = scorePhase1(baseGold().characters, [{ name: '白冷叶', aliases: [] }, { name: '路人甲', aliases: [] }]);
  assert.equal(r.matched, 1);
  assert.deepEqual(r.missing, ['方晓语']);
  assert.deepEqual(r.extra, ['路人甲']);
  assert.equal(r.precision, 0.5);
  assert.equal(r.recall, 0.5);
  assert.equal(r.f1, 0.5);
});

check('同义词不会重复匹配同一个金标注角色', () => {
  const r = scorePhase1(baseGold().characters, [
    { name: '白冷叶', aliases: [] },
    { name: '韩晓龙', aliases: [] }, // 与上一条指向同一人
  ]);
  assert.equal(r.matched, 1);
  assert.equal(r.extra.length, 1);
});

check('空预测 → precision 0 且 recall 0（不除零）', () => {
  const r = scorePhase1(baseGold().characters, []);
  assert.equal(r.precision, 0);
  assert.equal(r.recall, 0);
  assert.equal(r.f1, 0);
});

// ── Phase 2 IoU ────────────────────────────────────────────────────────
check('iou 区间计算（闭区间）', () => {
  assert.equal(iou({ startParagraph: 0, endParagraph: 2 }, { startParagraph: 0, endParagraph: 2 }), 1);
  assert.equal(iou({ startParagraph: 0, endParagraph: 2 }, { startParagraph: 0, endParagraph: 0 }), 1 / 3);
  assert.equal(iou({ startParagraph: 0, endParagraph: 0 }, { startParagraph: 5, endParagraph: 6 }), 0);
});

check('IoU ≥ 0.5 记为命中，< 0.5 记 missing', () => {
  const gold = [{ chapterIndex: 0, startParagraph: 0, endParagraph: 3 }];
  const hit = scorePhase2(gold, [{ chapterIndex: 0, startParagraph: 0, endParagraph: 2 }]); // 3/4 = 0.75
  assert.equal(hit.matched, 1);

  const miss = scorePhase2(gold, [{ chapterIndex: 0, startParagraph: 0, endParagraph: 0 }]); // 1/4 = 0.25
  assert.equal(miss.matched, 0);
  assert.equal(miss.recall, 0);
});

check('跨章节不匹配（即使段落区间相同）', () => {
  const gold = [{ chapterIndex: 0, startParagraph: 0, endParagraph: 1 }];
  const r = scorePhase2(gold, [{ chapterIndex: 1, startParagraph: 0, endParagraph: 1 }]);
  assert.equal(r.matched, 0);
});

check('场景 P/R：多切一个场景会拉低 precision', () => {
  const gold = [
    { chapterIndex: 0, startParagraph: 0, endParagraph: 2 },
    { chapterIndex: 0, startParagraph: 3, endParagraph: 5 },
  ];
  const pred = [
    { chapterIndex: 0, startParagraph: 0, endParagraph: 2 },
    { chapterIndex: 0, startParagraph: 3, endParagraph: 5 },
    { chapterIndex: 0, startParagraph: 6, endParagraph: 7 }, // 多切
  ];
  const r = scorePhase2(gold, pred);
  assert.equal(r.matched, 2);
  assert.equal(r.precision, Number((2 / 3).toFixed(4)));
  assert.equal(r.recall, 1);
});

// ── Phase 3 可溯源性 ────────────────────────────────────────────────────
check('excerpt 命中原文才算溯源成功', () => {
  const chapterTexts = ['甲推门而入。乙抬头看他。'];
  const scenes = [
    {
      content: [
        { type: 'action', description: 'a', sourceRefs: [{ chapterIndex: 0, excerpt: '甲推门而入' }] },
        { type: 'action', description: 'b', sourceRefs: [{ chapterIndex: 0, excerpt: '并不存在的话' }] },
        { type: 'action', description: 'c', sourceRefs: [] },
      ],
    },
  ];
  const r = scoreTraceability(scenes, chapterTexts);
  assert.equal(r.blocks, 3);
  assert.equal(r.withRefs, 2);
  assert.equal(r.hits, 1);
  assert.equal(r.refCoverage, Number((2 / 3).toFixed(4)));
  assert.equal(r.hitRate, 0.5);
});

// ── 草稿标注与独立性 ────────────────────────────────────────────────────
check('buildDraftAnnotation 记录 provenance 且 reviewed=false', () => {
  const draft = buildDraftAnnotation({
    sampleId: 's1',
    chapterCount: 1,
    modelId: 'deepseek-chat',
    jobId: 'job_1',
    pipelineState: {
      phase1Output: { characters: [{ name: '甲', aliases: ['阿甲'], isMajor: true }] },
      phase2Output: { scenes: [{ chapterIndex: 0, startParagraph: 0, endParagraph: 1, keyCharacterNames: ['甲'] }] },
    },
  });
  assert.equal(draft.meta.reviewed, false);
  assert.equal(draft.meta.provenance.source, 'llm-draft');
  assert.equal(draft.meta.provenance.modelId, 'deepseek-chat');
  assert.equal(draft.characters[0].aliases[0], '阿甲');
  assert.equal(draft.scenes.length, 1);
});

check('同模型自标自评触发循环论证告警', () => {
  const gold = { sampleId: 's1', meta: { provenance: { source: 'llm-draft', modelId: 'deepseek-chat', promptHash: 'p1' } } };
  assert.ok(checkIndependence(gold, { modelId: 'deepseek-chat', promptHash: 'p1' }));
  assert.equal(checkIndependence(gold, { modelId: 'gpt-4o', promptHash: 'p1' }), null);
  assert.equal(checkIndependence(gold, { modelId: 'deepseek-chat', promptHash: 'p2' }), null);
  assert.equal(checkIndependence({ sampleId: 's2', meta: { provenance: { source: 'human' } } }, { modelId: 'x' }), null);
});

// ── 汇总 ────────────────────────────────────────────────────────────────
check('macroAverage 等权平均 + 忽略非数值', () => {
  assert.equal(macroAverage([1, 0.5, null, undefined]), 0.75);
  assert.equal(macroAverage([]), null);
});

check('只把 reviewed=true 的样本计入 official', () => {
  const summary = summarizeEvaluation([
    { reviewed: true, phase1: { recall: 1, precision: 1, f1: 1 }, phase2: { recall: 1, precision: 1, f1: 1 }, traceability: { hitRate: 1 } },
    { reviewed: false, phase1: { recall: 0, precision: 0, f1: 0 }, phase2: { recall: 0, precision: 0, f1: 0 }, traceability: { hitRate: 0 } },
  ]);
  assert.equal(summary.total, 2);
  assert.equal(summary.officialCount, 1);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.official.phase1Recall, 1);
  assert.equal(summary.official.phase2F1, 1);
});

check('空输入不崩：official 全为 null', () => {
  const summary = summarizeEvaluation([]);
  assert.equal(summary.official.phase1Recall, null);
  assert.equal(summary.officialCount, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
