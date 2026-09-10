#!/usr/bin/env node
/**
 * 模型 × 样本评测矩阵（B-04）
 *
 * 用法：
 *   node scripts/eval/model-matrix.mjs --name base --sample zhanlan-short \
 *     --models deepseek-chat,openai [--base http://localhost:3001] \
 *     [--prompt-file <path>] [--out docs/conversion-quality/model-matrix-<name>.md] \
 *     [--only <model>] [--report-only] [--force]
 *
 * 每格：同一提示词/样本下跑一次转换（复用 convert-driver 共享驱动与 manifest 指纹缓存），
 * 汇总：实际模型（含**静默回退检测**）/身份断言格/占位率三段/规模/耗时/成本。
 *
 * ⚠ 重要：app 侧 resolveProvider 对未知 modelId 会**静默回退默认 provider**
 * （本仓默认 DeepSeek）。因此请求 'gpt-4o' 这类别名可能实际跑 deepseek——
 * 本报告以落库 job.config.modelId 为"实际模型"，与预期映射不符时打 ⚠。
 * 请求侧可靠写法：'deepseek-chat'（deepseek 家族）或 'openai'（provider 名，实际模型 gpt-4o）。
 *
 * 环境前提：dev server 就绪；DB_DIR/DB_FILE 指向本脚本读取的隔离库；server 持有的 key 决定可用格。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvalCache, createFileCache, sha256Hex } from './manifest.mjs';
import { driveConversion } from './convert-driver.mjs';
import { buildIdentityGrid } from './prompt-diff.mjs';
import { computeOccupancy } from './occupancy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES_DIR = path.join(ROOT, 'scripts', 'eval', 'samples');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ── 纯函数（可测） ─────────────────────────────────────────────────────────

/** 文件名安全的模型名 */
export function safeModelName(model) {
  return String(model).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

/**
 * 预期实际模型（用于回退检测）：
 * - deepseek 家族 → deepseek-chat（provider 固定该模型，别名如 deepseek-reasoner 不生效）
 * - 'openai' provider 名 → gpt-4o；而按 OpenAI 模型名（gpt 系 / o1 系 / o3 系）请求时，
 *   会因 registry 找不到 supportedModels 而静默回退默认（DeepSeek）→ 预判为 gpt-4o，
 *   命中回退则打 ⚠
 */
export function expectedActualModel(model) {
  if (/^deepseek/i.test(model)) return 'deepseek-chat';
  if (model === 'openai') return 'gpt-4o';
  if (/^(gpt|o[13])/i.test(model)) return 'gpt-4o';
  return null; // 未知：不预判（以落库 actual 为准）
}

/** 生成矩阵报告（Markdown）——纯函数 */
export function buildModelMatrixReport({ name, sample, promptHash, generatedAt, cells }) {
  const lines = [];
  lines.push(`# 模型 × 样本评测矩阵：${name}`);
  lines.push('');
  lines.push(`> 生成时间：${generatedAt} ｜ 样本：\`${sample}\` ｜ 格数：${cells.length}　工具：\`scripts/eval/model-matrix.mjs\`（B-04）`);
  lines.push(`> 提示词指纹：${promptHash ? `\`${promptHash.slice(0, 16)}\`` : '未提供（--prompt-file 可记录）'} —— 各格之间必须同一提示词与样本。`);
  lines.push('');
  lines.push('## 主表');
  lines.push('');
  lines.push('| 请求模型 | 实际模型 | 回退 | 断言格 | 占位率 全段/后段 | 场景数 | 耗时(min) | 估算成本(¥) | 终态 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const c of cells) {
    const expected = expectedActualModel(c.requestedModel);
    const fellBack = c.actualModelId && expected && c.actualModelId !== expected;
    const unknownModel = !c.actualModelId;
    const grid = c.grid ? c.grid.map((r) => `${r.ruleId}:${r.passed ? 'PASS' : `FAIL(${r.failures.length})`}`).join(' ') : '—';
    const occ = c.occ ? `${(c.occ.overall.rate * 100).toFixed(1)}% / ${(c.occ.back.rate * 100).toFixed(1)}%` : '—';
    lines.push(`| ${c.requestedModel} | ${c.actualModelId ?? '未知'} | ${fellBack || unknownModel ? '⚠' : ''} | ${grid} | ${occ} | ${c.run?.scenes ?? '—'} | ${c.run ? (c.run.elapsedMs / 60000).toFixed(1) : '—'} | ${c.run?.estimatedCostCny ?? '—'} | ${c.run?.finalStatus ?? '—'} |`);
  }
  lines.push('');
  if (cells.some((c) => {
    const expected = expectedActualModel(c.requestedModel);
    return (c.actualModelId && expected && c.actualModelId !== expected) || !c.actualModelId;
  })) {
    lines.push('> ⚠ 存在"请求模型 ≠ 实际模型"的格：app 侧对未知 modelId 会静默回退默认 provider，');
    lines.push('> 请按"实际模型"列解读结果；请求侧可靠写法见本文件头注释。');
    lines.push('');
  }
  lines.push('## 解读提示（人工裁决，工具不自动下结论）');
  lines.push('');
  lines.push('- 断言格：FAIL 数少者优；任一格 FAIL 数 >0 时不得以该格作为"扩张默认模型"的依据。');
  lines.push('- 占位率与成本对比同一口径（本矩阵为 n=1，参考 B-02 噪声基线：同模型复跑的占位/事件差异可达数 pt 量级——小于噪声级的差距不作模型取舍依据）。');
  lines.push('- 结论按纪律回写决策记录（含阴性结果）。');
  lines.push('');
  lines.push('## 复现');
  lines.push('');
  lines.push('```bash');
  lines.push(`node scripts/eval/model-matrix.mjs --name ${name} --sample ${sample} --models ${cells.map((c) => c.requestedModel).join(',')} --base <server>`);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  const name = arg('name');
  const sample = arg('sample', 'zhanlan-short');
  const base = arg('base', 'http://localhost:3001');
  const timeoutMin = Number(arg('timeout-min', '25'));
  const costCapCny = Number(arg('cost-cap-cny', '20'));
  const dbDir = arg('db-dir', process.env.DB_DIR || path.join(ROOT, 'apps', 'screenplay', 'data-test'));
  const dbFile = arg('db-file', process.env.DB_FILE || '1b-data.db');
  const force = process.argv.includes('--force');
  const reportOnly = process.argv.includes('--report-only');
  const only = arg('only');
  const models = arg('models', 'deepseek-chat').split(',').map((m) => m.trim()).filter(Boolean);

  if (!name) {
    console.error('用法：node scripts/eval/model-matrix.mjs --name <label> --sample <id> --models a,b,c [--base URL]');
    process.exit(2);
  }

  const sampleDir = path.join(SAMPLES_DIR, sample);
  if (!existsSync(path.join(sampleDir, 'chapters.txt'))) throw new Error(`样本缺失: ${sampleDir}/chapters.txt`);

  const promptFile = arg('prompt-file');
  const promptHash = promptFile ? sha256Hex(readFileSync(promptFile, 'utf8').replace(/\r\n/g, '\n')) : null;
  const datasetHash = sha256Hex(readFileSync(path.join(sampleDir, 'chapters.txt'), 'utf8'));
  const cache = new EvalCache(createFileCache(path.join(ROOT, 'data', 'eval-cache.jsonl')));
  const readJson = (file) => JSON.parse(readFileSync(path.join(sampleDir, file), 'utf8'));
  const labelOf = (model) => `${name}-${safeModelName(model)}`;

  const cells = [];
  for (const model of models) {
    const label = labelOf(model);
    const scenesFile = `model-matrix-${label}-m.scenes.json`;
    const cell = {
      set: `model-matrix:${name}`, sampleId: sample, stage: 'convert', assertionId: 'run',
      modelId: model, params: { model, promptHash: promptHash ?? 'unset' }, datasetHash, judgePromptHash: 'none',
    };
    let scenesJson;
    let run;
    if (reportOnly) {
      scenesJson = readJson(scenesFile);
      run = readJson(`model-matrix-${label}-m.run.json`);
    } else if (!force && cache.get(cell) && existsSync(path.join(sampleDir, scenesFile))) {
      console.log(`[model-matrix] ${model} 命中缓存，跳过 LLM 运行`);
      scenesJson = readJson(scenesFile);
      run = readJson(`model-matrix-${label}-m.run.json`);
    } else {
      if (only && only !== model) continue;
      const result = await driveConversion({
        base, sampleDir, runLabel: label, side: 'm', model, timeoutMin, costCapCny, dbDir, dbFile, titlePrefix: 'model-matrix',
      });
      cache.set(cell, { ranAt: new Date().toISOString(), model });
      scenesJson = result.scenesJson;
      run = result.run;
    }
    const annotation = readJson('annotation.json');
    cells.push({
      requestedModel: model,
      actualModelId: run.actualModelId ?? null,
      grid: buildIdentityGrid(annotation, scenesJson),
      occ: computeOccupancy(scenesJson.scenes, scenesJson.charIdSet),
      run,
    });
    console.log(`[model-matrix] ${model}: 实际=${run.actualModelId ?? '未知'} 场景=${run.scenes} 占位=${(computeOccupancy(scenesJson.scenes, scenesJson.charIdSet).overall.rate * 100).toFixed(1)}%`);
  }

  const report = buildModelMatrixReport({ name, sample, promptHash, generatedAt: new Date().toISOString(), cells });
  const outFile = arg('out', path.join(ROOT, 'docs', 'conversion-quality', `model-matrix-${name}.md`));
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, report);
  console.log(`[model-matrix] 报告已写入 → ${outFile}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => { console.error(`[model-matrix] 失败: ${err.message}`); process.exit(1); });
}
