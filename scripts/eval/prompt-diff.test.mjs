#!/usr/bin/env node
/**
 * prompt-diff 纯函数测试（B-07）
 * 运行：node --test scripts/eval/prompt-diff.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPromptFromTs, buildIdentityGrid, buildPromptDiffReport } from './prompt-diff.mjs';

test('extractPromptFromTs：提取内置提示词模板内容', () => {
  const src = 'const BUILTIN_SYSTEM_PROMPT = `你是一位编辑。\n规则1：可见可听。`;\n\nexport const SYSTEM_PROMPT = resolveSystemPrompt();';
  assert.equal(extractPromptFromTs(src), '你是一位编辑。\n规则1：可见可听。');
});

test('extractPromptFromTs：兼容旧式直接导出的写法', () => {
  const src = 'export const SYSTEM_PROMPT = `旧格式模板`;';
  assert.equal(extractPromptFromTs(src), '旧格式模板');
});

test('extractPromptFromTs：无法提取时抛错', () => {
  assert.throws(() => extractPromptFromTs('const x = 1;'), /未能从 TS 源中提取提示词模板/);
});

test('buildIdentityGrid：空场景 → 三条规则全 PASS', () => {
  const annotation = {
    deadCharacters: [{ name: '甲', deathChapter: 2 }],
    reveals: [{ secretName: '乙', revealChapter: 3 }],
    aliasIndex: { 别名丙: '丙' },
  };
  const scenesJson = { scenes: [], charIdToName: {}, charIdSet: [] };
  const grid = buildIdentityGrid(annotation, scenesJson);
  assert.equal(grid.length, 3);
  for (const r of grid) {
    assert.equal(r.passed, true, `${r.ruleId} 应为 PASS`);
  }
});

test('buildPromptDiffReport：包含指纹/断言格/占位率/复現命令', () => {
  const grid = [{ ruleId: 'dead-character-no-speak', passed: true, failures: [] }];
  const occ = (rate) => ({ front: { rate, total: 10, placeholder: 1 }, mid: { rate, total: 10, placeholder: 1 }, back: { rate, total: 10, placeholder: 1 }, overall: { rate, total: 30, placeholder: 3 } });
  const report = buildPromptDiffReport({
    name: 'demo', sample: 'zhanlan-short', model: 'deepseek-chat', generatedAt: '2026-09-11T00:00:00Z',
    oldSide: { source: 'git:HEAD~', hash: 'a'.repeat(64), text: 'old-prompt' },
    newSide: { source: 'builtin@worktree', hash: 'b'.repeat(64), text: 'new-prompt-longer' },
    oldGrid: grid, newGrid: grid, oldOcc: occ(0.2), newOcc: occ(0.1),
    oldRun: { elapsedMs: 60000, scenes: 12, charIdSet: 5, estimatedCostCny: 0.5, finalStatus: 'completed' },
    newRun: { elapsedMs: 61000, scenes: 12, charIdSet: 6, estimatedCostCny: 0.5, finalStatus: 'completed' },
  });

  assert.match(report, /Prompt 版本对比：demo/);
  assert.match(report, /git:HEAD~/);
  assert.match(report, /aaaaaaaaaaaaaaaa/);
  assert.match(report, /dead-character-no-speak: PASS/);
  assert.match(report, /全段 -10\.0pt/);
  assert.match(report, /prompt-diff\.mjs --name demo/);
});
