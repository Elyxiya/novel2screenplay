#!/usr/bin/env node
/**
 * model-matrix 纯函数测试（B-04）
 * 运行：node --test scripts/eval/model-matrix.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeModelName, expectedActualModel, buildModelMatrixReport } from './model-matrix.mjs';

test('safeModelName：非字母数字字符归一', () => {
  assert.equal(safeModelName('deepseek-chat'), 'deepseek-chat');
  assert.equal(safeModelName('gpt-4o/2024-08'), 'gpt-4o-2024-08');
});

test('expectedActualModel：deepseek 家族与 openai provider', () => {
  assert.equal(expectedActualModel('deepseek-chat'), 'deepseek-chat');
  assert.equal(expectedActualModel('deepseek-reasoner'), 'deepseek-chat');
  assert.equal(expectedActualModel('openai'), 'gpt-4o');
  assert.equal(expectedActualModel('some-custom'), null);
});

test('buildModelMatrixReport：主表 + 回退警示', () => {
  const grid = [{ ruleId: 'dead-character-no-speak', passed: true, failures: [] }];
  const occ = (rate) => ({ front: { rate }, mid: { rate }, back: { rate }, overall: { rate } });
  const report = buildModelMatrixReport({
    name: 'base', sample: 'zhanlan-short', promptHash: 'a'.repeat(64), generatedAt: '2026-09-11T00:00:00Z',
    cells: [
      {
        requestedModel: 'deepseek-chat', actualModelId: 'deepseek-chat', grid, occ: occ(0.1),
        run: { scenes: 29, elapsedMs: 66000, estimatedCostCny: 0.04, finalStatus: 'completed' },
      },
      {
        requestedModel: 'gpt-4o', actualModelId: 'deepseek-chat', grid, occ: occ(0.12),
        run: { scenes: 27, elapsedMs: 70000, estimatedCostCny: 0.04, finalStatus: 'completed' },
      },
    ],
  });

  assert.match(report, /模型 × 样本评测矩阵：base/);
  assert.match(report, /\| deepseek-chat \| deepseek-chat \| {2}\|/);
  assert.match(report, /\| gpt-4o \| deepseek-chat \| ⚠ \|/); // 回退标记
  assert.match(report, /存在"请求模型 ≠ 实际模型"的格/);
  assert.match(report, /--models deepseek-chat,gpt-4o/);
});

test('buildModelMatrixReport：无回退时不出现警示段', () => {
  const grid = [{ ruleId: 'r', passed: true, failures: [] }];
  const occ = { front: { rate: 0 }, mid: { rate: 0 }, back: { rate: 0 }, overall: { rate: 0 } };
  const report = buildModelMatrixReport({
    name: 'clean', sample: 's', promptHash: null, generatedAt: 't',
    cells: [{ requestedModel: 'deepseek-chat', actualModelId: 'deepseek-chat', grid, occ, run: { scenes: 1, elapsedMs: 1, estimatedCostCny: 0, finalStatus: 'completed' } }],
  });
  assert.doesNotMatch(report, /⚠ 存在/);
});
