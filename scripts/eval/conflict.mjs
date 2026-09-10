#!/usr/bin/env node
/**
 * 逻辑漏洞检测（B-05）：三类确定性规则 + 合成矛盾必红
 *
 *   R-TIMELINE          时间线单调性：场景按序推进时章号不得回退（闪回需显式标注）
 *   R-DEAD-PRESENCE     已死同场：已死角色不得在死亡章之后的场景出场或说话
 *   R-PROP-STATE        物品状态：场景文本对物品状态的描述需与状态机一致（可选输入）
 *
 * 用法：
 *   node scripts/eval/conflict.mjs --scenes <scenes.json> --annotation <annotation.json> \
 *     [--props <props.json>] [--json]
 *   exitCode=1 表示存在违规（可接 CI/评估链）。
 *
 * 输入：
 *   scenes.json   = { scenes, charIdToName, aliasIndex? }（convert-driver 产物同款）
 *   annotation    = { deadCharacters:[{name,deathChapter}], ... }（样本标注）
 *   props.json    = { props:[{name, aliases?, states:[{chapterIndex, state}]}] }（可选）
 *
 * 设计纪律（与 identity.mjs 同源）：全部确定性、零 LLM；合成矛盾 fixture 必红（见 .test.mjs）；
 * 无法判定的输入（缺 props/缺标注）裁为 skipped 并显式报告，不静默 PASS。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sceneSourceChapter } from './identity.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export const CONFLICT_RULES = {
  timeline: { ruleId: 'timeline-monotonic' },
  deadPresence: { ruleId: 'dead-character-presence' },
  propState: { ruleId: 'prop-state-consistency' },
};

/** 闪回/回忆的显式标注词（命中则允许章号回退） */
const FLASHBACK_MARKERS = /(闪回|回忆|梦境|梦里|倒叙|插叙|多年前|数年前)/;
/** 物品状态关键词 → 归一状态 */
const PROP_STATE_WORDS = {
  完好: 'intact', 完整: 'intact', 无损: 'intact', 崭新: 'intact',
  碎裂: 'broken', 断裂: 'broken', 折断: 'broken', 破损: 'broken', 断裂的: 'broken',
  丢失: 'lost', 遗失: 'lost', 不见了: 'lost',
};

function sceneText(scene) {
  const parts = [scene.summary ?? ''];
  for (const b of scene.content ?? []) parts.push(b.description ?? '', b.line ?? '', b.direction ?? '');
  return parts.join(' ');
}

/** R-TIMELINE：章号单调（回退需显式闪回标注） */
export function runTimelineRule({ scenes }) {
  const failures = [];
  let prevChapter = null;
  for (const scene of scenes ?? []) {
    const ch = sceneSourceChapter(scene);
    if (ch === null) continue;
    if (prevChapter !== null && ch < prevChapter) {
      if (!FLASHBACK_MARKERS.test(sceneText(scene))) {
        failures.push({
          sceneNumber: scene.sceneNumber,
          message: `时间线回退：场景 #${scene.sceneNumber} 位于第 ${ch} 章，前序场景已在第 ${prevChapter} 章，且未标注闪回`,
        });
      }
    } else {
      prevChapter = ch;
    }
  }
  return { ruleId: CONFLICT_RULES.timeline.ruleId, passed: failures.length === 0, failures };
}

/** R-DEAD-PRESENCE：已死角色不得在死亡章之后出场或说话 */
export function runDeadPresenceRule({ scenes, charIdToName, deadCharacters }) {
  const failures = [];
  if (!deadCharacters || deadCharacters.length === 0) {
    return { ruleId: CONFLICT_RULES.deadPresence.ruleId, passed: true, failures, skipped: '无死亡标注' };
  }
  const deadByName = new Map(deadCharacters.map((d) => [d.name, d.deathChapter]));
  const map = charIdToName ?? {};
  for (const scene of scenes ?? []) {
    const ch = sceneSourceChapter(scene);
    if (ch === null) continue;
    const present = new Set();
    for (const id of scene.characterIds ?? []) present.add(map[id] ?? id);
    for (const b of scene.content ?? []) {
      if (b.type === 'dialogue' && b.characterId) present.add(map[b.characterId] ?? b.characterId);
    }
    for (const name of present) {
      const deathChapter = deadByName.get(name);
      if (deathChapter !== undefined && ch > deathChapter) {
        failures.push({
          sceneNumber: scene.sceneNumber,
          message: `已死角色出场：${name}（第 ${deathChapter} 章死亡）出现在第 ${ch} 章场景 #${scene.sceneNumber}`,
        });
      }
    }
  }
  return { ruleId: CONFLICT_RULES.deadPresence.ruleId, passed: failures.length === 0, failures };
}

/** 状态机期望值：取 chapterIndex ≤ ch 的最后一条；缺省为首状态 */
export function expectedPropState(prop, chapterIndex) {
  let current = prop.states?.[0]?.state;
  for (const s of prop.states ?? []) {
    if (s.chapterIndex <= chapterIndex) current = s.state;
  }
  return current;
}

/** R-PROP-STATE：物品状态描述与状态机一致（可选输入；缺失即 skipped） */
export function runPropStateRule({ scenes, props }) {
  const failures = [];
  if (!props || props.length === 0) {
    return { ruleId: CONFLICT_RULES.propState.ruleId, passed: true, failures, skipped: '未提供 props 输入' };
  }
  for (const scene of scenes ?? []) {
    const ch = sceneSourceChapter(scene);
    if (ch === null) continue;
    const text = sceneText(scene);
    for (const prop of props) {
      const names = [prop.name, ...(prop.aliases ?? [])].filter(Boolean);
      const mentioned = names.some((n) => text.includes(n));
      if (!mentioned) continue;
      const expected = expectedPropState(prop, ch);
      for (const [word, state] of Object.entries(PROP_STATE_WORDS)) {
        const aroundProp = names.some((n) => new RegExp(`${n}[^。！？]{0,12}${word}|${word}[^。！？]{0,12}${n}`).test(text));
        if (aroundProp && state !== expected) {
          failures.push({
            sceneNumber: scene.sceneNumber,
            message: `物品状态矛盾：${prop.name} 在第 ${ch} 章场景 #${scene.sceneNumber} 被描述为「${word}」(${state})，状态机期望 ${expected}`,
          });
        }
      }
    }
  }
  return { ruleId: CONFLICT_RULES.propState.ruleId, passed: failures.length === 0, failures };
}

/** 汇总全部规则 */
export function runConflictRules({ scenes, charIdToName, annotation, props }) {
  return [
    runTimelineRule({ scenes }),
    runDeadPresenceRule({ scenes, charIdToName, deadCharacters: annotation?.deadCharacters }),
    runPropStateRule({ scenes, props }),
  ];
}

/** 文本报告（纯函数，可测） */
export function formatConflictReport(results) {
  const lines = ['[conflict] 逻辑漏洞检测（B-05）'];
  for (const r of results) {
    const status = r.skipped ? `SKIP（${r.skipped}）` : r.passed ? 'PASS' : `FAIL(${r.failures.length})`;
    lines.push(`  ${r.passed ? '✅' : '❌'} ${r.ruleId}: ${status}`);
    for (const f of r.failures) lines.push(`      - ${f.message}`);
  }
  return lines.join('\n');
}

function main() {
  const scenesFile = arg('scenes');
  const annotationFile = arg('annotation');
  const propsFile = arg('props');
  const asJson = process.argv.includes('--json');
  if (!scenesFile) {
    console.error('用法：node scripts/eval/conflict.mjs --scenes <scenes.json> --annotation <annotation.json> [--props <props.json>] [--json]');
    process.exitCode = 2;
    return;
  }
  const scenesJson = JSON.parse(readFileSync(scenesFile, 'utf8'));
  const annotation = annotationFile ? JSON.parse(readFileSync(annotationFile, 'utf8')) : undefined;
  const propsJson = propsFile ? JSON.parse(readFileSync(propsFile, 'utf8')) : undefined;

  const results = runConflictRules({
    scenes: scenesJson.scenes ?? scenesJson,
    charIdToName: scenesJson.charIdToName,
    annotation,
    props: propsJson?.props,
  });

  if (asJson) console.log(JSON.stringify({ results }, null, 2));
  else console.log(formatConflictReport(results));

  if (results.some((r) => !r.passed && !r.skipped)) process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); } catch (err) { console.error(`[conflict] 失败: ${err.message}`); process.exitCode = 1; }
}
