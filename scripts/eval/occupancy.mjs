#!/usr/bin/env node
/**
 * 占位率分层模块（点 1b · 第二信号，零 LLM）
 *
 * 占位信号定义（与 1b-data-chain-medium-plan.md §0/§3.3 一致）：
 *   场景 characterIds 中**不在参考集 id 集**的引用数 / 场景总引用数。
 *   参考集 = phase1Output.characters（分析卡）的 id 集。
 * 依据 Phase4Merger（L101）：未解析 id 保留原始名进入 scene.characterIds，
 *   但 phase4.characters 只由 phase1.characters 去重产出、不会自动收占位角色。
 *   → 占位引用恒存在、占位率不会恒 0。
 *
 * CLI：node scripts/eval/occupancy.mjs <tag>.scenes.json
 *   输入 JSON 结构：{ scenes, charIdToName, charIdSet （可选，缺省取 charIdToName 的键） }
 *   输出按章占位率序列 + 前/中/后各三分之一聚合 + 全段合计。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** 仅当直接以 node occupancy.mjs 运行时才走 CLI（被 import 时不触发）。 */
const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);

/**
 * 单场景占位率。
 * @param {import('@novel/contracts/screenplay').Scene} scene
 * @param {Set<string>} refIds 参考集（phase1 char id）
 * @returns {{ total: number, resolution: number, occupancyRate: number, placeholderIds: string[] }}
 */
export function sceneOccupancy(scene, refIds) {
  const ids = new Set(scene.characterIds || []);
  for (const block of scene.content || []) {
    if (block.type === 'dialogue' && block.characterId) ids.add(block.characterId);
  }
  const total = ids.size;
  const placeholderIds = [...ids].filter((id) => !refIds.has(id));
  const resolution = total - placeholderIds.length;
  return {
    total,
    resolution,
    occupancyRate: total === 0 ? 0 : placeholderIds.length / total,
    placeholderIds,
  };
}

/** 场景源章节（与 identity.mjs sceneSourceChapter 同源，取 sourceChapterRange[0]）。 */
function sceneSourceChapter(scene) {
  if (Array.isArray(scene.sourceChapterRange) && scene.sourceChapterRange.length) {
    return scene.sourceChapterRange[0];
  }
  return null;
}

/** 按一章聚合：{ chapter, total, placeholder, rate }。 */
function byChapter(scenes, refIds) {
  const map = new Map();
  for (const scene of scenes) {
    const ch = sceneSourceChapter(scene);
    if (ch === null) continue;
    const occ = sceneOccupancy(scene, refIds);
    const e = map.get(ch) ?? { chapter: ch, total: 0, placeholder: 0 };
    e.total += occ.total;
    e.placeholder += occ.placeholderIds.length;
    map.set(ch, e);
  }
  return [...map.values()]
    .sort((a, b) => a.chapter - b.chapter)
    .map((e) => ({ ...e, rate: e.total === 0 ? 0 : Math.round((e.placeholder / e.total) * 1000) / 1000 }));
}

/** 前/中/后各三分之一聚合。 */
function chunk(series, n) {
  if (series.length === 0) return { total: 0, placeholder: 0, rate: 0 };
  const head = series.slice(0, Math.max(1, Math.ceil(n)));
  return head.reduce(
    (acc, e) => {
      acc.total += e.total;
      acc.placeholder += e.placeholder;
      return acc;
    },
    { total: 0, placeholder: 0 },
  );
}

/**
 * 占位率分层汇总。
 * @returns {{ perChapter: Array, front: object, mid: object, back: object, overall: object }}
 */
export function computeOccupancy(scenes, refCharIds) {
  const refIds = new Set(refCharIds || Object.keys(scenes?.charIdToName ?? {}));
  const perChapter = byChapter(scenes, refIds);
  const n = perChapter.length;
  const third = Math.ceil(n / 3);
  const front = chunk(perChapter.slice(0, third), perChapter.slice(0, third).length);
  const mid = chunk(perChapter.slice(third, 2 * third), perChapter.slice(third, 2 * third).length);
  const back = chunk(perChapter.slice(2 * third), perChapter.slice(2 * third).length);
  const overall = perChapter.reduce(
    (acc, e) => {
      acc.total += e.total;
      acc.placeholder += e.placeholder;
      return acc;
    },
    { total: 0, placeholder: 0 },
  );
  const rateOf = (e) => (e.total === 0 ? 0 : Math.round((e.placeholder / e.total) * 1000) / 1000);
  return {
    perChapter,
    front: { total: front.total, placeholder: front.placeholder, rate: rateOf(front) },
    mid: { total: mid.total, placeholder: mid.placeholder, rate: rateOf(mid) },
    back: { total: back.total, placeholder: back.placeholder, rate: rateOf(back) },
    overall: { total: overall.total, placeholder: overall.placeholder, rate: rateOf(overall) },
  };
}

function printReport(tag, report) {
  console.log(`\n[占位率] ${tag}`);
  for (const e of report.perChapter) {
    console.log(`  ch${String(e.chapter).padStart(3)} 占位=${String(e.placeholder).padStart(2)}/${String(e.total).padStart(2)} rate=${(e.rate * 100).toFixed(1)}%`);
  }
  console.log(`  前段 rate=${(report.front.rate * 100).toFixed(1)}%  中段=${(report.mid.rate * 100).toFixed(1)}%  后段=${(report.back.rate * 100).toFixed(1)}%`);
  console.log(`  全段 rate=${(report.overall.rate * 100).toFixed(1)}%（占位 ${report.overall.placeholder}/${report.overall.total}）`);
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('用法：node scripts/eval/occupancy.mjs <tag>.scenes.json');
    process.exit(2);
  }
  let input;
  try {
    input = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    console.error(`读取 ${file} 失败: ${err.message}`);
    process.exit(2);
  }
  const scenes = input.scenes || input;
  const refIds = input.charIdSet ? new Set(input.charIdSet) : new Set(Object.keys(input.charIdToName || {}));
  printReport(file, computeOccupancy(scenes, refIds));
}

if (isMain) {
  main();
}