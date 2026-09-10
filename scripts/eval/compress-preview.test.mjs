#!/usr/bin/env node
/**
 * compress-preview 纯函数测试（FIX-19 POC / ADR-0003）
 * 运行：node --test scripts/eval/compress-preview.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCompression, protectedChapters, majorCharacterNames, sceneTextStats, buildOutlineMarkdown, PROFILES } from './compress-preview.mjs';

const CHAR_MAP = { c1: '主角甲', c2: '配角乙' };
const PHASE1 = {
  characters: [
    { name: '主角甲', isMajor: true, aliases: [] },
    { name: '配角乙', isMajor: false, aliases: [] },
  ],
  settingCard: { chapterSummaries: [], openThreads: [{ id: 't1', startChapterIndex: 3, endChapterIndex: 7 }] },
};
const ANNOTATION = {
  deadCharacters: [{ name: '配角乙', deathChapter: 5 }],
  reveals: [{ secretName: '主角甲', revealChapter: 9 }],
  aliasIndex: {},
};

function scene(num, ch, charIds, text = '动作。', type = 'action') {
  return {
    sceneNumber: num,
    sourceChapterRange: [ch, ch],
    slugline: '内景. 客厅 - 夜',
    characterIds: charIds,
    content: [{ type, description: type === 'action' ? text : undefined, line: type === 'dialogue' ? text : undefined, characterId: type === 'dialogue' ? charIds[0] : undefined }],
    summary: `场景${num}`,
  };
}

test('protectedChapters：死亡章 ∪ 揭示章 ∪ open threads 起止章', () => {
  const set = protectedChapters(ANNOTATION, PHASE1.settingCard);
  assert.deepEqual([...set].sort((a, b) => a - b), [3, 5, 7, 9]);
});

test('majorCharacterNames：isMajor!==false 全收（缺省视为主要）', () => {
  assert.deepEqual([...majorCharacterNames(PHASE1)], ['主角甲']);
});

test('light：次要场不 DROP；保护章场景 KEEP（即使只有配角）', () => {
  // 两个场景取不同 slugline，隔离"非被测的 MERGE 折叠"
  const scenesJson = {
    charIdToName: CHAR_MAP,
    scenes: [
      scene(1, 5, ['c2']),
      { ...scene(2, 2, ['c2']), slugline: '外景. 街道 - 日' },
    ],
  };
  const plan = planCompression({ scenesJson, phase1: PHASE1, annotation: ANNOTATION, profile: PROFILES.light });
  assert.equal(plan.stats.dropped, 0);
  assert.equal(plan.decisions[0].ruleId, 'R-PROTECT-CHAPTER'); // 章 5 是死亡章
  assert.equal(plan.decisions[1].action !== 'DROP', true);
});

test('standard：保护章外次要场 DROP；空角色场保守 KEEP；主角场 KEEP', () => {
  const scenesJson = {
    charIdToName: CHAR_MAP,
    scenes: [
      scene(1, 2, ['c2']),
      scene(2, 2, []),
      { ...scene(3, 2, ['c1']), slugline: '外景. 街道 - 日' }, // 与场景 2 不同 slugline，隔离 MERGE
    ],
  };
  const plan = planCompression({ scenesJson, phase1: PHASE1, annotation: ANNOTATION, profile: PROFILES.standard });
  assert.equal(plan.decisions[0].action, 'DROP');
  assert.equal(plan.decisions[0].ruleId, 'R-DROP-MINOR');
  assert.equal(plan.decisions[1].action, 'KEEP'); // 空角色 → 不判支线
  assert.equal(plan.decisions[2].ruleId, 'R-PROTECT-MAJOR');
  assert.equal(plan.stats.dropped, 1);
});

test('MERGE：相邻同地点同时段双短场合并，输出场景数-1', () => {
  const mk = (n) => ({ ...scene(n, 2, ['c1'], '短动作'), slugline: '内景. 客厅 - 夜' });
  const scenesJson = { charIdToName: CHAR_MAP, scenes: [mk(1), mk(2)] };
  const plan = planCompression({ scenesJson, phase1: PHASE1, annotation: ANNOTATION, profile: PROFILES.light });
  assert.equal(plan.stats.merged, 1);
  assert.equal(plan.stats.outputScenes, 1);
  assert.deepEqual(plan.decisions[0].mergedWith, [2]);
});

test('CONDENSE 标记：动作占比高且超阈值', () => {
  const heavy = { ...scene(1, 2, ['c1'], '动'.repeat(900)), content: [
    { type: 'action', description: '动'.repeat(900), sourceRefs: [] },
    { type: 'dialogue', characterId: 'c1', line: '短', sourceRefs: [] },
  ] };
  const plan = planCompression({ scenesJson: { charIdToName: CHAR_MAP, scenes: [heavy] }, phase1: PHASE1, annotation: ANNOTATION, profile: PROFILES.light });
  assert.equal(plan.decisions[0].action, 'CONDENSE');
});

test('off：全 KEEP 零变化；sceneTextStats 分列统计', () => {
  const s = {
    ...scene(1, 2, ['c1']),
    content: [
      { type: 'action', description: '动'.repeat(10), sourceRefs: [] },
      { type: 'dialogue', characterId: 'c1', line: '言'.repeat(4), sourceRefs: [] },
    ],
  };
  assert.deepEqual(sceneTextStats(s), { actionChars: 10, dialogueChars: 4, total: 14 });
  const plan = planCompression({ scenesJson: { charIdToName: CHAR_MAP, scenes: [s] }, phase1: PHASE1, annotation: ANNOTATION, profile: PROFILES.off });
  assert.equal(plan.decisions[0].action, 'KEEP');
  assert.equal(plan.stats.outputScenes, 1);
});

test('buildOutlineMarkdown：含保护集报表与评审要点', () => {
  const scenesJson = { charIdToName: CHAR_MAP, scenes: [scene(1, 5, ['c2']), scene(2, 2, ['c2'])] };
  const plan = planCompression({ scenesJson, phase1: PHASE1, annotation: ANNOTATION, profile: PROFILES.standard });
  const md = buildOutlineMarkdown({ sample: 's', profile: 'standard', scenesJson, plan, jobId: 'job_x' });
  assert.match(md, /压缩预览大纲：s × profile=standard/);
  assert.match(md, /保护集命中/);
  assert.match(md, /人工评审要点/);
  assert.match(md, /DROP 1/);
});
