#!/usr/bin/env node
/**
 * drift-check 纯函数测试（FIX-09）
 * 运行：node --test scripts/eval/drift-check.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDriftSeries, pickLatest, evaluateThresholds, formatCheckText } from './drift-check.mjs';

const mkRecord = (ts, name, variance, jaccard) => ({
  ts, name, sample: 's', model: 'm', runs: 3, promptHash: 'h',
  metrics: {
    boundary: { counts: [2, 3, 2], mean: 2.3, variance, min: 2, max: 3, perChapterMeanL1: 7.33 },
    characters: { sizes: [1, 2, 1], pairwise: [0.5], mean: jaccard, min: jaccard },
    events: { eventCounts: [1, 2], pairwise: [0.5], mean: 0.6, min: 0.5 },
  },
});

test('parseDriftSeries：坏行跳过并计数', () => {
  const text = `${JSON.stringify(mkRecord('2026-01-01', 'a', 1, 0.9))}\nnot-json\n{"no":"metrics"}\n`;
  const { records, skipped } = parseDriftSeries(text);
  assert.equal(records.length, 1);
  assert.equal(skipped, 2);
});

test('pickLatest：按 name 过滤取最新', () => {
  const records = [mkRecord('2026-01-01', 'a', 1, 0.9), mkRecord('2026-01-02', 'a', 2, 0.8), mkRecord('2026-01-03', 'b', 5, 0.5)];
  assert.equal(pickLatest(records, 'a').metrics.boundary.variance, 2);
  assert.equal(pickLatest(records).name, 'b');
  assert.equal(pickLatest(records, 'zzz'), null);
});

test('evaluateThresholds：上限/下限/latest 缺省字段不检查', () => {
  const record = mkRecord('2026-01-03', 'a', 5, 0.5);
  const all = evaluateThresholds(record, {
    maxSceneVariance: 4, maxPerChapterL1: 10, minCharacterJaccard: 0.6, minEventConsistency: 0.7,
  });
  assert.equal(all.length, 3); // 方差超、Jaccard 低、事件 0.6<0.7 低
  assert.ok(all[0].includes('boundary.variance=5'));

  const partial = evaluateThresholds(record, { maxSceneVariance: 10 });
  assert.equal(partial.length, 0);
  assert.equal(evaluateThresholds(null, { maxSceneVariance: 1 }).length, 0);
});

test('formatCheckText：未定阈提示 / ALERT / 通过', () => {
  const record = mkRecord('2026-01-03', 'a', 5, 0.5);
  assert.match(formatCheckText(record, [], false), /未提供阈值文件/);
  assert.match(formatCheckText(record, ['x 超阈'], true), /🚨 ALERT/);
  assert.match(formatCheckText(record, [], true), /✅ 阈值检查通过/);
  assert.match(formatCheckText(null, [], true), /时序为空/);
});
