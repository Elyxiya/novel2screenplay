#!/usr/bin/env node
/**
 * 第二步：judge 稳定性 + 迷你分层曲线窄入口（点 1b · §3.4）
 *
 *   node scripts/eval/run-layered-curve.mjs \
 *       --old samples/xiuzhen-medium/old.scenes.json \
 *       --new samples/xiuzhen-medium/new.scenes.json \
 *       --out docs/conversion-quality/1b-layered-curve.md
 *
 * 复用既有 eval 基建：identity.mjs 确定性规则（零 LLM）+ occupancy.mjs 占位率。
 * 语义格：默认按「语义断言为零 → 退化判据」处理（预注册口径）；仅当样本提供
 *   --semantic-json <annotation.json> 且其 semanticAssertions 非空时才窗口化跑 judge。
 *
 * 判据（1b-data-chain-medium-plan.md §3.4）：
 *   - Δ_tail 阈值判据只当语义格存在（stability 噪声带可算）时启用；
 *   - 语义格为零 → 退化判据 = 规则格确定性差异 + 占位率差，受 n=1 管线级方差限制（方向性证据）。
 *   - 前段阴性对照给容差（差≈0 不必严格为 0）。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIdentityRules, IDENTITY_RULES } from './identity.mjs';
import { computeOccupancy } from './occupancy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RULE_IDS = [
  IDENTITY_RULES.deadCharacterNoSpeak.ruleId,
  IDENTITY_RULES.revealBeforeChapter.ruleId,
  IDENTITY_RULES.unresolvedAliasAsId.ruleId,
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadScenes(file) {
  if (!existsSync(file)) throw new Error(`缺 scenes 文件: ${file}`);
  const input = JSON.parse(readFileSync(file, 'utf-8'));
  const scenes = input.scenes || input;
  const refIds = input.charIdSet ? new Set(input.charIdSet) : new Set(Object.keys(input.charIdToName || {}));
  return { scenes, refIds, charIdToName: input.charIdToName ?? {}, aliasIndex: input.aliasIndex ?? {} };
}

/**
 * 读 annotation（人工标注），抽取规则判分所需的事实断言。
 * 语义 ground truth 纪律（1b-data-chain-medium-plan.md §0/§3.4）：
 * 判分基准必须是人工标注事实（描述原文、非输出推导），绝不拿各路径自己的设定卡当判分事实。
 * @param {string|null} file annotation.json 路径
 * @returns {{ deadCharacters: Array, reveals: Array, aliasIndex: Record<string,string>, semanticAssertions: Array }}
 */
function loadAnnotation(file) {
  if (!file) return { deadCharacters: [], reveals: [], aliasIndex: {}, semanticAssertions: [] };
  if (!existsSync(file)) return { deadCharacters: [], reveals: [], aliasIndex: {}, semanticAssertions: [] };
  const ann = JSON.parse(readFileSync(file, 'utf-8'));
  return {
    deadCharacters: Array.isArray(ann.deadCharacters) ? ann.deadCharacters : [],
    reveals: Array.isArray(ann.reveals) ? ann.reveals : [],
    aliasIndex: ann.aliasIndex ?? {},
    semanticAssertions: Array.isArray(ann.semanticAssertions) ? ann.semanticAssertions : [],
  };
}

function layeredTable(title, occupancy) {
  const line = (label, e) => `${label} | ${e.total} | ${e.placeholder} | ${(e.rate * 100).toFixed(1)}%`;
  return [
    `**${title} 占位率分层**`,
    '',
    '| 段 | 引用总数 | 占位数 | 占位率 |',
    '|---|---|---|---|',
    line('前段', occupancy.front),
    line('中段', occupancy.mid),
    line('后段', occupancy.back),
    line('全段', occupancy.overall),
    '',
  ];
}

function runRules(data) {
  // 合并 annotation 人工断言（deadCharacters/reveals）——缺失时兜空数组，杜绝 undefined.find 崩溃。
  return runIdentityRules(RULE_IDS, {
    scenes: data.scenes,
    charIdToName: data.charIdToName ?? {},
    aliasIndex: data.aliasIndex ?? {},
    deadCharacters: data.deadCharacters ?? [],
    reveals: data.reveals ?? [],
  });
}

async function main() {
  const oldFile = arg('old');
  const newFile = arg('new');
  const outFile = arg('out');
  if (!oldFile || !newFile) {
    console.error('用法：--old <old.scenes.json> --new <new.scenes.json> [--semantic-json <a.json>] [--out <md>]');
    process.exit(2);
  }
  const semanticFile = arg('semantic-json');

  const ann = loadAnnotation(semanticFile);

  const old = loadScenes(oldFile);
  const newer = loadScenes(newFile);

  // 合并 annotation 人工断言到规则输入（语义 ground truth = 人工标注事实）
  const annotate = (o) => ({ ...o, deadCharacters: ann.deadCharacters, reveals: ann.reveals });
  const ruleOld = runRules(annotate(old));
  const ruleNew = runRules(annotate(newer));
  const occOld = computeOccupancy(old.scenes, old.refIds);
  const occNew = computeOccupancy(newer.scenes, newer.refIds);

  const ruleRows = (title, results) =>
    results.map((r) => `| ${title} | \`${r.ruleId}\` | ${r.passed ? '✅ PASS' : `❌ FAIL(${r.failures.length})`} | ${r.failures.map((f) => f.message).join('；') || '—'} |`);

  // 语义断言（可配置）：默认按退化口径（medium 语义断言为零）
  const semanticAssertions = ann.semanticAssertions;
  let semanticNote;
  if (semanticAssertions.length === 0) {
    semanticNote =
      '**语义格：当前样本未注入人工语义断言（预注册：medium 仅 2 条死亡规则断言）→ 判据退化为「规则格确定性差异 + 占位率差」，受 n=1 管线级方差限制（差异仅作方向性证据，不作统计结论）。**';
  } else {
    semanticNote = `**语义格：已注入 ${semanticAssertions.length} 条人工断言 → Δ_tail 阈值判据启用（需 stability 复跑方差）。**`;
  }

  const lines = [];
  lines.push('# 1b 分层对比曲线（旧路径 vs 新路径）');
  lines.push('');
  lines.push('> 生成时间：' + new Date().toISOString());
  lines.push('> n=1 单次运行，管线级方差未量化；若占位率后段差异显著，先考虑一次定向复跑再下结论。');
  lines.push('');
  lines.push('## 规则格（确定性，零 LLM）');
  lines.push('');
  lines.push('| 路径 | 规则 | 判定 | 明细 |');
  lines.push('|---|---|---|---|');
  lines.push(...ruleRows('旧', ruleOld));
  lines.push(...ruleRows('新', ruleNew));
  lines.push('');
  lines.push('## 占位率分层（第二信号）');
  lines.push('');
  lines.push(...layeredTable('旧路径', occOld));
  lines.push(...layeredTable('新路径', occNew));
  const dBack = occNew.back.rate - occOld.back.rate;
  const dFront = occNew.front.rate - occOld.front.rate;
  lines.push(`**前段差（新−旧）=${(dFront * 100).toFixed(1)}%**（阴性对照，≈0 给容差）｜**后段差=${(dBack * 100).toFixed(1)}%**（截断损伤判别）`);
  lines.push('');
  lines.push('## 语义格与判据');
  lines.push('');
  lines.push(semanticNote);
  lines.push('');
  lines.push('## 结论（如实，不强行）');
  lines.push('');
  lines.push('> 待实测结论回填：仅当规则格差异或后段占位率差超出判据，才可写「支持翻转」并附数字；否则如实记录为「贴线样本无显著差」。');
  lines.push('');

  const content = lines.join('\n');
  if (outFile) {
    const abs = path.isAbsolute(outFile) ? outFile : path.join(ROOT, outFile);
    writeFileSync(abs, content);
    console.log(`[run-layered-curve] 报告 → ${abs}`);
  } else {
    console.log(content);
  }

  console.log(`[run-layered-curve] 旧规则格 FAIL=${ruleOld.filter((r) => !r.passed).length}/${ruleOld.length}  新规则格 FAIL=${ruleNew.filter((r) => !r.passed).length}/${ruleNew.length}`);
  console.log(`[run-layered-curve] 旧占位率 前=${(occOld.front.rate * 100).toFixed(1)}% 后=${(occOld.back.rate * 100).toFixed(1)}%  新占位率 前=${(occNew.front.rate * 100).toFixed(1)}% 后=${(occNew.back.rate * 100).toFixed(1)}%`);
}

main().catch((err) => {
  console.error(`[run-layered-curve] 失败: ${err.message || err}`);
  process.exit(1);
});