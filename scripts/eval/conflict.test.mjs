#!/usr/bin/env node
/**
 * conflict.mjs 测试（B-05）：合成矛盾必红 + 阴性对照不误报
 * 运行：node --test scripts/eval/conflict.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTimelineRule, runDeadPresenceRule, runPropStateRule, runConflictRules, expectedPropState, formatConflictReport } from './conflict.mjs';

const scene = (num, ch, { charIds = [], text = '动作。', summary = '' } = {}) => ({
  sceneNumber: num,
  sourceChapterRange: [ch, ch],
  characterIds: charIds,
  content: [{ type: 'action', description: text, sourceRefs: [] }],
  summary,
});
const CHAR_MAP = { c1: '主角', c2: '白斯' };

test('R-TIMELINE：单调 PASS；回退 FAIL；有闪回标注则放行', () => {
  assert.equal(runTimelineRule({ scenes: [scene(1, 0), scene(2, 1), scene(3, 2)] }).passed, true);

  const back = runTimelineRule({ scenes: [scene(1, 2), scene(2, 1)] });
  assert.equal(back.passed, false);
  assert.match(back.failures[0].message, /时间线回退/);

  const flashback = runTimelineRule({ scenes: [scene(1, 2), scene(2, 1, { summary: '回忆：三年前的雨夜' })] });
  assert.equal(flashback.passed, true);
});

test('R-DEAD-PRESENCE：死亡章后出场/说话必红；之前正常；无标注 skipped', () => {
  const ann = [{ name: '白斯', deathChapter: 5 }];
  const before = runDeadPresenceRule({ scenes: [scene(1, 4, { charIds: ['c2'] })], charIdToName: CHAR_MAP, deadCharacters: ann });
  assert.equal(before.passed, true);

  const after = runDeadPresenceRule({ scenes: [scene(1, 7, { charIds: ['c2'] })], charIdToName: CHAR_MAP, deadCharacters: ann });
  assert.equal(after.passed, false);
  assert.match(after.failures[0].message, /已死角色出场：白斯/);

  const dialogueAfter = runDeadPresenceRule({
    scenes: [{ ...scene(1, 7), content: [{ type: 'dialogue', characterId: 'c2', line: '我还在。', sourceRefs: [] }] }],
    charIdToName: CHAR_MAP,
    deadCharacters: ann,
  });
  assert.equal(dialogueAfter.passed, false);

  assert.equal(runDeadPresenceRule({ scenes: [scene(1, 7, { charIds: ['c2'] })], charIdToName: CHAR_MAP }).skipped, '无死亡标注');
});

test('R-PROP-STATE：状态机矛盾必红；一致 PASS；无 props skipped', () => {
  const props = [{ name: '断剑', states: [{ chapterIndex: 3, state: 'intact' }, { chapterIndex: 6, state: 'broken' }] }];

  assert.equal(expectedPropState(props[0], 2), 'intact');
  assert.equal(expectedPropState(props[0], 6), 'broken');

  const consistent = runPropStateRule({ scenes: [scene(1, 7, { text: '他握着断裂的断剑。' })], props });
  assert.equal(consistent.passed, true);

  const conflict = runPropStateRule({ scenes: [scene(1, 7, { text: '断剑依旧完好无损。' })], props });
  assert.equal(conflict.passed, false);
  assert.match(conflict.failures[0].message, /物品状态矛盾：断剑/);

  assert.equal(runPropStateRule({ scenes: [scene(1, 7)], props: undefined }).skipped, '未提供 props 输入');
});

test('runConflictRules + formatConflictReport：汇总三规则并输出', () => {
  const results = runConflictRules({
    scenes: [scene(1, 2), scene(2, 1), scene(3, 7, { charIds: ['c2'] })],
    charIdToName: CHAR_MAP,
    annotation: { deadCharacters: [{ name: '白斯', deathChapter: 5 }] },
    props: [{ name: '玉佩', states: [{ chapterIndex: 1, state: 'intact' }, { chapterIndex: 3, state: 'lost' }] }],
  });
  const report = formatConflictReport(results);
  assert.match(report, /timeline-monotonic: FAIL\(1\)/);
  assert.match(report, /dead-character-presence: FAIL\(1\)/);
  assert.match(report, /prop-state-consistency: (PASS|SKIP)/);
});
