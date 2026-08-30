#!/usr/bin/env node
/**
 * stability + judge 纯函数零成本单测（T2-C4 稳定性基线下地）
 *
 *   node scripts/eval/stability.test.mjs
 *
 * 目的：judge 稳定性基线的统计核（mean/stdDev/噪声带/Δ_tail）与 judge 解析
 *   是「Δ_tail 判据」的地基，必须在论文档前先有零成本守卫。不跑 LLM，
 *   node 原生 assert（与 contract.test.mjs 同模式）。
 */

import assert from 'node:assert/strict';
import { parseJudgeVerdicts, passRate } from './judge.mjs';
import {
  mean,
  stdDev,
  ciHalfWidth,
  judgeNoiseBand,
  deltaTailThreshold,
  buildStabilityReport,
} from './stability.mjs';

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

// ── stability.mjs（统计核） ──────────────────────────────────────────
check('mean 基础值', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.ok(Number.isNaN(mean([])));
});

check('stdDev Bessel 校正（n=2 全额差）', () => {
  assert.equal(stdDev([0, 10]), Math.sqrt(50)); // ((0-5)^2+(10-5)^2)/1 = 50
  assert.ok(Number.isNaN(stdDev([5])));
});

check('ciHalfWidth 95% = 1.96*SD/sqrt(n)', () => {
  const sd = stdDev([0, 10]);
  assert.ok(Math.abs(ciHalfWidth([0, 10]) - (1.96 * sd) / Math.SQRT2) < 1e-9);
});

check('judgeNoiseBand = max(2SD, CI半宽)，单样本 null', () => {
  assert.equal(judgeNoiseBand([0, 10]), Math.max(2 * stdDev([0, 10]), ciHalfWidth([0, 10])));
  assert.equal(judgeNoiseBand([5]), null);
});

check('deltaTailThreshold 无方差回退 minDelta=5', () => {
  assert.equal(deltaTailThreshold([100, 100, 100]), 5);
  assert.equal(deltaTailThreshold([]), 5);
});

check('deltaTailThreshold 有方差向上取整且不低于 min', () => {
  // SD=√5000≈70.71 → band=max(2*70.71≈141.4, CI≈98)=141.4 → ceil=142
  assert.equal(deltaTailThreshold([0, 100]), 142);
});

check('buildStabilityReport 输出字段齐全且含阈值', () => {
  const [r] = buildStabilityReport([{ assertionId: 'x', scores: [0, 100] }]);
  assert.equal(r.assertionId, 'x');
  assert.equal(typeof r.mean, 'number');
  assert.equal(typeof r.stdDev, 'number');
  assert.equal(typeof r.noiseBand, 'number');
  assert.equal(typeof r.deltaTailThreshold, 'number');
});

// ── judge.mjs（解析与通过率，judgeSemanticCell 需真实 LLM 不在此处跑） ──
check('parseJudgeVerdicts 解析纯 JSON', () => {
  const v = parseJudgeVerdicts('{"scenes":[{"sceneNumber":1,"verdict":"fail","reason":"r"}]}');
  assert.equal(v.length, 1);
  assert.equal(v[0].sceneNumber, 1);
  assert.equal(v[0].verdict, 'fail');
});

check('parseJudgeVerdicts 从夹杂文字中提取对象', () => {
  const v = parseJudgeVerdicts('好的，结果为 {"scenes":[{"sceneNumber":2,"verdict":"pass"}]}');
  assert.equal(v.length, 1);
  assert.equal(v[0].verdict, 'pass');
});

check('parseJudgeVerdicts 非法输入退化空数组', () => {
  assert.deepEqual(parseJudgeVerdicts('not json'), []);
  assert.deepEqual(parseJudgeVerdicts('{"scenes": "nope"}'), []);
});

check('parseJudgeVerdicts 非 fail 一律归 pass', () => {
  const v = parseJudgeVerdicts('{"scenes":[{"sceneNumber":1,"verdict":"whatever"}]}');
  assert.equal(v[0].verdict, 'pass');
});

check('passRate = pass/可判，无场景回退 1', () => {
  assert.equal(passRate([{ verdict: 'pass' }, { verdict: 'fail' }]), 0.5);
  assert.equal(passRate([{ verdict: 'pass' }]), 1);
  assert.equal(passRate([]), 1);
});

// ── 一致性：矛盾格高分差的稳定核能喂出非 min 的 Δ_tail（呼应实测 35） ──
check('矛盾格 high-sep 分数喂出 Δ_tail>5', () => {
  // 模拟 judge 对矛盾内容 0/100 摇摆：稳定核应给出大于 min 的阈值
  const t = deltaTailThreshold([0, 100, 0, 100, 0, 100, 0, 100, 0, 100]);
  assert.ok(t > 5, `期望 >5，实得 ${t}`);
});

console.log(`\nstability.test.mjs: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);