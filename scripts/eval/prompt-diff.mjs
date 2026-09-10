#!/usr/bin/env node
/**
 * Prompt 版本对比工具（B-07；首例 = FIX-10 VO 决策的 baseline 对比）
 *
 * 用法：
 *   node scripts/eval/prompt-diff.mjs --name vo-baseline --sample zhanlan-short \
 *     --old-file git:HEAD~ --new-file builtin \
 *     [--base-old http://localhost:3001] [--base-new http://localhost:3002] \
 *     [--model deepseek-chat] [--out docs/conversion-quality/prompt-diff-<name>.md] \
 *     [--dump-prompt-files <dir>] [--only old|new] [--report-only] [--force] [--dry-run]
 *
 * 输入形式：
 *   --old-file/--new-file  <path>       纯文本提示词文件
 *                          builtin      当前工作区 convert-scene.ts 的内置提示词
 *                          git:<ref>    指定 git 版本（如 git:1f1fd71^）的提示词
 *
 * 机制：HTTP 驱动在 scripts/eval/convert-driver.mjs（共享基建），
 *   - 两侧产物命名 prompt-diff-<name>-<side>.{scenes,run}.json；manifest 指纹缓存按 hash 不重付；
 *   - Next 16 dev server 为项目级单实例锁 → 单侧串行：--only old → 换 server → --only new → --report-only。
 *
 * 环境前提：dev server 带 CONVERT_PROMPT_FILE=<对应提示词文件>（--dump-prompt-files 可落盘）、
 *   DB_DIR/DB_FILE 指向本工具读取的隔离库（默认 apps/screenplay/data-test/1b-data.db）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EvalCache, createFileCache, sha256Hex } from './manifest.mjs';
import { computeOccupancy } from './occupancy.mjs';
import { runIdentityRules, IDENTITY_RULES } from './identity.mjs';
import { driveConversion } from './convert-driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES_DIR = path.join(ROOT, 'scripts', 'eval', 'samples');
const PROMPT_TS = 'apps/screenplay/src/lib/llm/prompts/convert-scene.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ── 纯函数（可测） ─────────────────────────────────────────────────────────

/** 从 convert-scene.ts 源码中提取 SYSTEM_PROMPT 模板字符串内容 */
export function extractPromptFromTs(source) {
  const m = source.match(/const BUILTIN_SYSTEM_PROMPT = `([\s\S]*?)`;/)
    ?? source.match(/export const SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (!m) throw new Error('未能从 TS 源中提取提示词模板');
  return m[1];
}

/** 行尾归一化：git blob（LF）与工作区（CRLF）内容等价，hash/注入必须同源可比 */
function normalizeEol(text) {
  return text.replace(/\r\n/g, '\n');
}

/** 身份断言格（三条确定性规则） */
export function buildIdentityGrid(annotation, scenesJson) {
  const data = {
    scenes: scenesJson.scenes,
    charIdToName: scenesJson.charIdToName,
    deadCharacters: annotation.deadCharacters,
    reveals: annotation.reveals,
    aliasIndex: annotation.aliasIndex,
  };
  const ruleIds = [
    IDENTITY_RULES.deadCharacterNoSpeak.ruleId,
    IDENTITY_RULES.revealBeforeChapter.ruleId,
    IDENTITY_RULES.unresolvedAliasAsId.ruleId,
  ];
  return runIdentityRules(ruleIds, data);
}

function gridCell(results) {
  return results.map((r) => `${r.ruleId}: ${r.passed ? 'PASS' : `FAIL(${r.failures.length})`}`).join('；');
}

function pct(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

/** 生成对比报告（Markdown）——纯函数 */
export function buildPromptDiffReport(input) {
  const {
    name, sample, model, generatedAt,
    oldSide, newSide, oldGrid, newGrid, oldOcc, newOcc, oldRun, newRun,
  } = input;

  const lines = [];
  lines.push(`# Prompt 版本对比：${name}`);
  lines.push('');
  lines.push(`> 生成时间：${generatedAt} ｜ 样本：\`${sample}\` ｜ 模型：\`${model}\`　工具：\`scripts/eval/prompt-diff.mjs\`（B-07）`);
  lines.push('');
  lines.push('## 版本指纹');
  lines.push('');
  lines.push('| 侧 | 来源 | prompt sha256（前 16） | 字符数 |');
  lines.push('|---|---|---|---|');
  lines.push(`| old | ${oldSide.source} | ${oldSide.hash.slice(0, 16)} | ${oldSide.text.length} |`);
  lines.push(`| new | ${newSide.source} | ${newSide.hash.slice(0, 16)} | ${newSide.text.length} |`);
  lines.push('');
  lines.push('## 身份断言格（确定性规则，PASS 为佳）');
  lines.push('');
  lines.push('| 侧 | 规则结果 |');
  lines.push('|---|---|');
  lines.push(`| old | ${gridCell(oldGrid)} |`);
  lines.push(`| new | ${gridCell(newGrid)} |`);
  lines.push('');
  lines.push('## 占位率（越低越好）');
  lines.push('');
  lines.push('| 侧 | 前段 | 中段 | 后段 | 全段 | 占位/总数 |');
  lines.push('|---|---|---|---|---|---|');
  for (const [label, occ] of [['old', oldOcc], ['new', newOcc]]) {
    lines.push(`| ${label} | ${pct(occ.front.rate)} | ${pct(occ.mid.rate)} | ${pct(occ.back.rate)} | ${pct(occ.overall.rate)} | ${occ.overall.placeholder}/${occ.overall.total} |`);
  }
  const backDeltaPt = ((newOcc.back.rate - oldOcc.back.rate) * 100).toFixed(1);
  const overallDeltaPt = ((newOcc.overall.rate - oldOcc.overall.rate) * 100).toFixed(1);
  lines.push('');
  lines.push(`**差值（新 − 旧）**：全段 ${overallDeltaPt}pt ｜ 后段 ${backDeltaPt}pt（负=改善）。`);
  lines.push('');
  lines.push('## 运行元数据');
  lines.push('');
  lines.push('| 侧 | 耗时(min) | 场景数 | 参考卡角色 | 估算成本(¥) | 终态 |');
  lines.push('|---|---|---|---|---|---|');
  for (const [label, run] of [['old', oldRun], ['new', newRun]]) {
    lines.push(`| ${label} | ${run ? (run.elapsedMs / 60000).toFixed(1) : '—'} | ${run?.scenes ?? '—'} | ${run?.charIdSet ?? '—'} | ${run?.estimatedCostCny ?? '—'} | ${run?.finalStatus ?? '—'} |`);
  }
  lines.push('');
  lines.push('## 预注册判据提示（人工裁决，工具不自动下结论）');
  lines.push('');
  lines.push('- 断言格出现新 FAIL：除非新 FAIL 数 < 旧 FAIL 数（净改善），否则不得采纳新提示词。');
  lines.push('- 占位率差值：与噪声带/Δ_tail 口径比较（见 docs/conversion-quality 既有决策记录），n=1 仅作方向性证据。');
  lines.push('- 结论必须回写决策记录（flip-decision-record 风格）；阴性结果同样入档。');
  lines.push('');
  lines.push('## 复现命令');
  lines.push('');
  lines.push('```bash');
  lines.push('# server A（旧提示词）: CONVERT_PROMPT_FILE=<old.txt> 端口 3001，DB_DIR/DB_FILE 指向 data-test/1b-data.db');
  lines.push('# server B（新提示词）: CONVERT_PROMPT_FILE=<new.txt> 端口 3002，同一隔离库');
  lines.push(`node scripts/eval/prompt-diff.mjs --name ${name} --sample ${sample} --old-file <old.txt|git:ref> --new-file <new.txt|builtin>`);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

/** 解析一侧的提示词来源 → { text, source } */
export function resolvePromptSide(spec) {
  if (!spec || spec === 'builtin') {
    return { text: normalizeEol(extractPromptFromTs(readFileSync(path.join(ROOT, PROMPT_TS), 'utf8'))), source: 'builtin@worktree' };
  }
  if (spec.startsWith('git:')) {
    const ref = spec.slice(4);
    const r = spawnSync('git', ['show', `${ref}:${PROMPT_TS}`], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git show ${ref}:${PROMPT_TS} 失败: ${r.stderr?.slice(0, 200)}`);
    return { text: normalizeEol(extractPromptFromTs(r.stdout)), source: `git:${ref}` };
  }
  return { text: normalizeEol(readFileSync(spec, 'utf8')), source: spec };
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  const name = arg('name');
  const sample = arg('sample', 'zhanlan-short');
  const model = arg('model', 'deepseek-chat');
  const baseOld = arg('base-old', 'http://localhost:3001');
  const baseNew = arg('base-new', 'http://localhost:3002');
  const timeoutMin = Number(arg('timeout-min', '90'));
  const costCapCny = Number(arg('cost-cap-cny', '20'));
  const dbDir = arg('db-dir', process.env.DB_DIR || path.join(ROOT, 'apps', 'screenplay', 'data-test'));
  const dbFile = arg('db-file', process.env.DB_FILE || '1b-data.db');
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');

  if (!name) {
    console.error('用法：node scripts/eval/prompt-diff.mjs --name <label> [--sample <id>] --old-file <path|git:ref|builtin> --new-file <path|git:ref|builtin>');
    process.exit(2);
  }

  const sampleDir = path.join(SAMPLES_DIR, sample);
  if (!existsSync(path.join(sampleDir, 'chapters.txt'))) throw new Error(`样本缺失: ${sampleDir}/chapters.txt`);

  const oldSide = { ...resolvePromptSide(arg('old-file')), hash: '' };
  const newSide = { ...resolvePromptSide(arg('new-file')), hash: '' };
  oldSide.hash = sha256Hex(oldSide.text);
  newSide.hash = sha256Hex(newSide.text);

  const datasetHash = sha256Hex(readFileSync(path.join(sampleDir, 'chapters.txt'), 'utf8'));
  const cache = new EvalCache(createFileCache(path.join(ROOT, 'data', 'eval-cache.jsonl')));
  const cellFor = (side, hash) => ({
    set: `prompt-diff:${name}`, sampleId: sample, stage: 'convert', assertionId: 'run',
    modelId: model, params: { side, promptHash: hash }, datasetHash, judgePromptHash: 'none',
  });
  const oldCell = cellFor('old', oldSide.hash);
  const newCell = cellFor('new', newSide.hash);

  console.log(`[prompt-diff] ${name} sample=${sample}`);
  console.log(`  old: ${oldSide.source} hash=${oldSide.hash.slice(0, 16)} len=${oldSide.text.length}`);
  console.log(`  new: ${newSide.source} hash=${newSide.hash.slice(0, 16)} len=${newSide.text.length}`);
  console.log(`  cache: old=${cache.get(oldCell) ? 'HIT' : 'MISS'} new=${cache.get(newCell) ? 'HIT' : 'MISS'}${force ? '（--force 强制重跑）' : ''}`);

  const dumpDir = arg('dump-prompt-files');
  if (dumpDir) {
    mkdirSync(dumpDir, { recursive: true });
    const oldFile = path.join(dumpDir, `${name}-old.txt`);
    const newFile = path.join(dumpDir, `${name}-new.txt`);
    writeFileSync(oldFile, oldSide.text);
    writeFileSync(newFile, newSide.text);
    console.log(`[prompt-diff] 提示词已落盘：\n  old → ${oldFile}\n  new → ${newFile}`);
    console.log(`  启动命令示例（两个终端）：`);
    console.log(`    CONVERT_PROMPT_FILE="${oldFile}" PORT=3001 npm run dev -w @novel/screenplay`);
    console.log(`    CONVERT_PROMPT_FILE="${newFile}" PORT=3002 npm run dev -w @novel/screenplay`);
  }

  if (dryRun) {
    console.log(`[prompt-diff] --dry-run：计划就绪（不发起转换）`);
    return;
  }

  // Next 16 dev server 为项目级单实例锁——支持串行执行：
  //   --only old / --only new（换 server 后分别跑）；--report-only 仅汇总
  const only = arg('only');
  const reportOnly = process.argv.includes('--report-only');
  if (only && !['old', 'new'].includes(only)) {
    console.error('[prompt-diff] --only 须为 old 或 new');
    process.exit(2);
  }

  const readJson = (file) => JSON.parse(readFileSync(path.join(sampleDir, file), 'utf8'));
  const scenesFileOf = (side) => `prompt-diff-${name}-${side}.scenes.json`;
  const loadSideArtifacts = (side) => ({
    scenesJson: readJson(scenesFileOf(side)),
    run: readJson(`prompt-diff-${name}-${side}.run.json`),
  });

  const runSide = async (side, base, cell, hash) => {
    if (reportOnly) return loadSideArtifacts(side);
    const cached = !force && cache.get(cell) && existsSync(path.join(sampleDir, scenesFileOf(side)));
    if (cached) {
      console.log(`[prompt-diff] ${side} 命中缓存，跳过 LLM 运行`);
      return loadSideArtifacts(side);
    }
    const result = await driveConversion({
      base, sampleDir, runLabel: name, side, model, timeoutMin, costCapCny, dbDir, dbFile,
    });
    cache.set(cell, { ranAt: new Date().toISOString(), promptHash: hash, side });
    return result;
  };

  const oldResult = (!only || only === 'old') ? await runSide('old', baseOld, oldCell, oldSide.hash) : null;
  const newResult = (!only || only === 'new') ? await runSide('new', baseNew, newCell, newSide.hash) : null;

  if (only) {
    console.log(`[prompt-diff] 单侧（${only}）完成；另一侧跑完后用 --report-only 出报告`);
    return;
  }

  const annotation = readJson('annotation.json');
  const report = buildPromptDiffReport({
    name, sample, model, generatedAt: new Date().toISOString(),
    oldSide, newSide,
    oldGrid: buildIdentityGrid(annotation, oldResult.scenesJson),
    newGrid: buildIdentityGrid(annotation, newResult.scenesJson),
    oldOcc: computeOccupancy(oldResult.scenesJson.scenes, oldResult.scenesJson.charIdSet),
    newOcc: computeOccupancy(newResult.scenesJson.scenes, newResult.scenesJson.charIdSet),
    oldRun: oldResult.run, newRun: newResult.run,
  });

  const outFile = arg('out', path.join(ROOT, 'docs', 'conversion-quality', `prompt-diff-${name}.md`));
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, report);
  console.log(`[prompt-diff] 报告已写入 → ${outFile}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => { console.error(`[prompt-diff] 失败: ${err.message}`); process.exitCode = 1; });
}
