#!/usr/bin/env node
/**
 * 点 1b 格式契约零成本单测（T2-C2 链路契约验证）
 *
 *   node scripts/eval/contract.test.mjs
 *
 * 目的：把「管线产物 ↔ judge 输入对不上」的担忧在零成本下证伪或证实，
 *   避免为契约不确定性付转换管线费。不跑 LLM，node 原生 assert。
 *
 * 覆盖三个契约面（与 1b-data-chain-medium-plan.md §3.1 一致）：
 *   a) phase4Output.scenes 形状可被 identity.mjs 的 runIdentityRule 消费；
 *   b) charIdToName（由 phase1.characters id→name 生成）下，death 规则与
 *      unresolved-alias 规则在已知 fatal/should-pass 场景各自 P/F 正确；
 *   c) 占位信号提取：未解析 id 保留原始名进入 scene.characterIds、且不在
 *      phase1 参考集 → occupancy 计数>0（第二信号消费端），同时触发
 *      unresolved-alias 规则（规则消费端）——同一个 fixture 正例两条端都断言。
 */

import assert from 'node:assert/strict';
import { runIdentityRule, runDeadCharacterNoSpeakRule, runUnresolvedAliasAsIdRule } from './identity.mjs';
import { computeOccupancy, sceneOccupancy } from './occupancy.mjs';

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

// ── fixture（Phase4Merger 的形状约定） ───────────────────────────────────
const dlg = (characterId, line, sourceRefs) => ({ type: 'dialogue', characterId, line, sourceRefs });
const act = (description, sourceRefs) => ({ type: 'action', description, sourceRefs });

// phase1 分析卡（参考集来源）：char 1/2，id 集 = {char_1, char_2}
const phase1Characters = [
  { characterId: 'char_1', name: '老秦', aliases: ['秦爷'] },
  { characterId: 'char_2', name: '苏晚', aliases: [] },
];

// phase4 scenes：sc1 含未解析原始名 id「秦爷」；sc2 干净；sc3 老秦在死亡章后仍开口
const scenes = [
  {
    sceneNumber: 1,
    slugline: 'SC 1',
    timeOfDay: 'night',
    locationId: 'loc_1',
    characterIds: ['char_1', '秦爷'], // 秦爷=未解析(未收进 characters) → 占位 + 别名未解析
    content: [dlg('char_1', '此去凶险，你留下', [{ chapterIndex: 2, paragraphIndex: 0, excerpt: 'x' }])],
    sourceChapterRange: [2, 2],
  },
  {
    sceneNumber: 2,
    slugline: 'SC 2',
    timeOfDay: 'day',
    locationId: 'loc_1',
    characterIds: ['char_2'],
    content: [act('苏晚望向远山。', [{ chapterIndex: 3, paragraphIndex: 0, excerpt: 'y' }])],
    sourceChapterRange: [3, 3],
  },
  {
    sceneNumber: 3,
    slugline: 'SC 3',
    timeOfDay: 'night',
    locationId: 'loc_1',
    characterIds: ['char_1'],
    content: [dlg('char_1', '老秦的仇，我来报', [{ chapterIndex: 8, paragraphIndex: 0, excerpt: 'z' }])],
    sourceChapterRange: [8, 8],
  },
];

// 由 phase1.characters（id→name）生成 charIdToName；aliasIndex 来自 phase1 reduce
const charIdToName = Object.fromEntries(phase1Characters.map((c) => [c.characterId, c.name]));
const aliasIndex = { 老秦: 'char_1', 秦爷: 'char_1', 苏晚: 'char_2' };
const deadCharacters = [{ name: '老秦', deathChapter: 5 }];
const refCharIds = phase1Characters.map((c) => c.characterId); // = Object.keys(charIdToName)

const dataAll = { scenes, charIdToName, aliasIndex, deadCharacters, reveals: [] };

console.log(`[contract.test] fixture: scenes=${scenes.length} chars=${refCharIds.length} refSet=${refCharIds.join(',')}`);

// ── a) scenes 形状可被 runIdentityRule 消费（不抛、返回结构完整） ────────
check('a1 三个确定性规则均可消费 scenes 且返回 {ruleId, passed, failures}', () => {
  for (const ruleId of ['dead-character-no-speak', 'reveal-before-chapter', 'unresolved-alias-as-id']) {
    const r = runIdentityRule(ruleId, dataAll);
    assert.equal(typeof r.passed, 'boolean', `${ruleId} 应返回 passed`);
    assert.ok(Array.isArray(r.failures), `${ruleId} 应返回 failures 数组`);
  }
});

// ── b) charIdToName + 规则 P/F 语义 ──────────────────────────────────────
check('b1 death 规则：ch8>deathChapter5 的对话 → 应判 fail', () => {
  const r = runDeadCharacterNoSpeakRule(dataAll);
  assert.equal(r.passed, false);
  assert.ok(r.failures.some((f) => f.sceneNumber === 3));
});

check('b2 death 规则：干净样本（无死亡后开口）→ 应判 pass', () => {
  const clean = { ...dataAll, scenes: scenes.filter((s) => s.sceneNumber !== 3) };
  const r = runDeadCharacterNoSpeakRule(clean);
  assert.equal(r.passed, true);
});

check('b3 unresolved-alias 规则：场景直接用别名「秦爷」作 characterId → 应判 fail', () => {
  const r = runUnresolvedAliasAsIdRule(dataAll);
  assert.equal(r.passed, false);
  assert.ok(r.failures.some((f) => /秦爷/.test(f.message)));
});

// ── c) 占位信号：规则消费端 + occupancy 消费端（同一 fixture 正例） ────
check('c1 occupancy：未解析 id「秦爷」不在参考集 → 占位率>0（第二信号端）', () => {
  const occ = sceneOccupancy(scenes[0], new Set(refCharIds));
  assert.ok(occ.occupancyRate > 0, `预期占位率>0，实际=${occ.occupancyRate}`);
  assert.ok(occ.placeholderIds.includes('秦爷'));
});

check('c2 computeOccupancy 分层：全场占位合计 ≥1（含未被参考集的引用）', () => {
  const rep = computeOccupancy(scenes, refCharIds);
  assert.ok(rep.overall.placeholder >= 1, `整体占位数≥1，实际=${rep.overall.placeholder}`);
  assert.ok(rep.overall.rate > 0);
  assert.ok(rep.perChapter.length === 3, '按章应聚出 3 段');
});

check('c3 双端一致：占位集合 === 规则判 fail 的别名集合（秦爷）', () => {
  const occ = sceneOccupancy(scenes[0], new Set(refCharIds));
  const rule = runUnresolvedAliasAsIdRule(dataAll);
  assert.deepEqual(occ.placeholderIds, ['秦爷']);
  assert.ok(rule.failures.some((f) => /秦爷/.test(f.message)));
});

check('c4 干净场景无占位：sc2 全部命中参考集 → 占位率=0', () => {
  const occ = sceneOccupancy(scenes[1], new Set(refCharIds));
  assert.equal(occ.occupancyRate, 0);
});

console.log(`\n[contract.test] 通过 ${passed} / 共 ${passed + failed}`);
if (failed > 0) {
  console.error(`[contract.test] ${failed} 项失败`);
  process.exit(1);
}