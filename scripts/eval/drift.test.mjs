#!/usr/bin/env node
/**
 * drift 三元组指标纯函数测试（B-02）
 * 运行：node --test scripts/eval/drift.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  referencedNames, jaccard, sceneBoundaryMetrics, characterSetMetrics,
  dialogueEventVector, ruzicka, eventConsistencyMetrics, computeDriftMetrics, buildDriftReport,
} from './drift.mjs';

const CHAR_MAP = { char_1: '甲', char_2: '乙' };

function scene(n, ch, charIds, dialogueSpeakers = []) {
  return {
    sceneNumber: n,
    sourceChapterRange: [ch, ch],
    characterIds: charIds,
    content: dialogueSpeakers.map((speaker, i) => ({
      type: 'dialogue', characterId: speaker, line: `line-${n}-${i}`,
    })),
  };
}

const mkArtifact = (scenes) => ({ scenesJson: { scenes, charIdToName: CHAR_MAP } });

test('referencedNames：characterIds 与对白说话人经 charIdToName 归一', () => {
  const a = mkArtifact([scene(1, 0, ['char_1'], ['char_2'])]);
  assert.deepEqual([...referencedNames(a.scenesJson)].sort(), ['乙', '甲']);
});

test('jaccard：基础与空集', () => {
  assert.equal(jaccard(new Set([1, 2]), new Set([2, 3])), 1 / 3);
  assert.equal(jaccard(new Set(), new Set()), 1);
});

test('sceneBoundaryMetrics：counts/mean/var 与每章 L1 漂移', () => {
  const A = mkArtifact([scene(1, 0, []), scene(2, 1, [])]);                       // ch0×1, ch1×1
  const B = mkArtifact([scene(1, 0, []), scene(2, 0, []), scene(3, 1, [])]);      // ch0×2, ch1×1
  const C = mkArtifact([scene(1, 0, []), scene(2, 1, [])]);                       // ch0×1, ch1×1

  const m = sceneBoundaryMetrics([A, B, C]);
  assert.deepEqual(m.counts, [2, 3, 2]);
  assert.equal(m.mean, 2.33);
  assert.equal(m.variance, 0.22);
  assert.equal(m.min, 2);
  assert.equal(m.max, 3);
  // 两两 L1：(A,B)=1, (A,C)=0, (B,C)=1 → mean 0.67
  assert.equal(m.perChapterMeanL1, 0.67);
});

test('characterSetMetrics：角色集合两两 Jaccard', () => {
  const A = mkArtifact([scene(1, 0, ['char_1'])]);
  const B = mkArtifact([scene(1, 0, ['char_1', 'char_2'])]);
  const C = mkArtifact([scene(1, 0, ['char_2'])]);

  const m = characterSetMetrics([A, B, C]);
  assert.deepEqual(m.sizes, [1, 2, 1]);
  assert.deepEqual(m.pairwise, [0.5, 0, 0.5]);
  assert.equal(m.mean, 0.3333);
  assert.equal(m.min, 0);
});

test('ruzicka：加权 Jaccard（Σmin/Σmax）', () => {
  const a = new Map([['ch0|甲', 2]]);
  const b = new Map([['ch0|甲', 1], ['ch0|乙', 1]]);
  assert.equal(ruzicka(a, b), 1 / 3);
  assert.equal(ruzicka(new Map(), new Map()), 1);
});

test('dialogueEventVector + eventConsistencyMetrics：事件向量与一致率', () => {
  const A = mkArtifact([scene(1, 0, [], ['char_1', 'char_1'])]);
  const B = mkArtifact([scene(1, 0, [], ['char_1', 'char_2'])]);

  const va = dialogueEventVector(A.scenesJson);
  assert.deepEqual([...va.entries()], [['ch0|甲', 2]]);

  const m = eventConsistencyMetrics([A, B]);
  assert.deepEqual(m.eventCounts, [2, 2]);
  assert.equal(m.mean, 0.3333);
});

test('computeDriftMetrics + buildDriftReport：三元组汇总与报告结构', () => {
  const A = mkArtifact([scene(1, 0, ['char_1'], ['char_1'])]);
  const B = mkArtifact([scene(1, 0, ['char_1'], ['char_1'])]);

  const metrics = computeDriftMetrics([A, B]);
  const report = buildDriftReport({
    name: 'demo', sample: 'zhanlan-short', model: 'deepseek-chat', promptHash: 'f'.repeat(64),
    generatedAt: '2026-09-11T00:00:00Z',
    runsMeta: [
      { elapsedMs: 66000, finalStatus: 'completed' },
      { elapsedMs: 67000, finalStatus: 'completed' },
    ],
    metrics,
  });

  assert.match(report, /输出稳定性（drift）：demo/);
  assert.match(report, /复跑次数：2/);
  assert.match(report, /ffffffffffffffff/);
  assert.match(report, /\| r1 \| 1 \|/);
  assert.match(report, /先测量后定阈/);
});
