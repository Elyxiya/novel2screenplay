#!/usr/bin/env node
/**
 * 输出稳定性脚本（B-02）：同一提示词 N 次复跑 → 三元组指标（先测量后定阈）
 *
 *   ① 场景边界方差：sceneCount 的 mean/var/min/max + 每章场景数的平均 L1 漂移
 *   ② 角色集合 Jaccard：run 级引用角色名集合的两两 Jaccard（均值/最小）
 *   ③ 事件一致率：对话事件向量（key = ch<章>|<说话人>）的两两 Ruzicka 相似度（均值/最小）
 *
 * 用法：
 *   node scripts/eval/drift.mjs --name fix10-prompt --sample zhanlan-short --runs 3 \
 *     [--base http://localhost:3001] [--model deepseek-chat] [--prompt-file <path>] \
 *     [--out docs/conversion-quality/drift-<name>.md] [--jsonl data/eval-drift.jsonl] \
 *     [--only-run <i>] [--report-only] [--force]
 *
 * 说明：产物 drift-<name>-r<i>.{scenes,run}.json；manifest 指纹缓存（params.run=i，按 hash 不重付）；
 *       --prompt-file 用于把 server 实际使用的提示词 hash 记入 manifest（可选）；
 *       单 server 即可（同一提示词），无需 Next 单实例锁的串行换场。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvalCache, createFileCache, sha256Hex } from './manifest.mjs';
import { driveConversion } from './convert-driver.mjs';
import { sceneSourceChapter } from './identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES_DIR = path.join(ROOT, 'scripts', 'eval', 'samples');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ── 纯函数（可测） ─────────────────────────────────────────────────────────

/** run 级引用角色名集合：场景 characterIds + 对白说话人，经 charIdToName 归一 */
export function referencedNames(scenesJson) {
  const map = scenesJson.charIdToName ?? {};
  const names = new Set();
  for (const scene of scenesJson.scenes ?? []) {
    for (const id of scene.characterIds ?? []) names.add(map[id] ?? id);
    for (const block of scene.content ?? []) {
      if (block.type === 'dialogue' && block.characterId) names.add(map[block.characterId] ?? block.characterId);
    }
  }
  return names;
}

export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** 每章场景数向量 → { ch: count } */
export function scenesPerChapter(scenesJson) {
  const out = new Map();
  for (const scene of scenesJson.scenes ?? []) {
    const ch = sceneSourceChapter(scene);
    out.set(ch, (out.get(ch) ?? 0) + 1);
  }
  return out;
}

/** ① 场景边界方差（跨 run） */
export function sceneBoundaryMetrics(artifacts) {
  const counts = artifacts.map((a) => (a.scenesJson.scenes ?? []).length);
  const mean = counts.reduce((s, v) => s + v, 0) / counts.length;
  const variance = counts.reduce((s, v) => s + (v - mean) ** 2, 0) / counts.length;

  const perChapterVectors = artifacts.map((a) => scenesPerChapter(a.scenesJson));
  let l1Sum = 0;
  let pairs = 0;
  for (let i = 0; i < perChapterVectors.length; i++) {
    for (let j = i + 1; j < perChapterVectors.length; j++) {
      const allCh = new Set([...perChapterVectors[i].keys(), ...perChapterVectors[j].keys()]);
      let l1 = 0;
      for (const ch of allCh) {
        l1 += Math.abs((perChapterVectors[i].get(ch) ?? 0) - (perChapterVectors[j].get(ch) ?? 0));
      }
      l1Sum += l1;
      pairs += 1;
    }
  }

  return {
    counts,
    mean: Number(mean.toFixed(2)),
    variance: Number(variance.toFixed(2)),
    min: Math.min(...counts),
    max: Math.max(...counts),
    perChapterMeanL1: pairs > 0 ? Number((l1Sum / pairs).toFixed(2)) : 0,
  };
}

/** ② 角色集合 Jaccard（两两） */
export function characterSetMetrics(artifacts) {
  const sets = artifacts.map((a) => referencedNames(a.scenesJson));
  const values = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) values.push(jaccard(sets[i], sets[j]));
  }
  return {
    sizes: sets.map((s) => s.size),
    pairwise: values.map((v) => Number(v.toFixed(4))),
    mean: values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(4)) : 1,
    min: values.length ? Number(Math.min(...values).toFixed(4)) : 1,
  };
}

/** 对话事件向量：key = ch<章>|<说话人名>，value = 出现次数 */
export function dialogueEventVector(scenesJson) {
  const map = scenesJson.charIdToName ?? {};
  const vec = new Map();
  for (const scene of scenesJson.scenes ?? []) {
    const ch = sceneSourceChapter(scene);
    for (const block of scene.content ?? []) {
      if (block.type !== 'dialogue' || !block.characterId) continue;
      const speaker = map[block.characterId] ?? block.characterId;
      const key = `ch${ch}|${speaker}`;
      vec.set(key, (vec.get(key) ?? 0) + 1);
    }
  }
  return vec;
}

/** Ruzicka（加权 Jaccard）相似度：Σmin / Σmax */
export function ruzicka(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let minSum = 0;
  let maxSum = 0;
  for (const k of keys) {
    const av = a.get(k) ?? 0;
    const bv = b.get(k) ?? 0;
    minSum += Math.min(av, bv);
    maxSum += Math.max(av, bv);
  }
  return maxSum === 0 ? 1 : minSum / maxSum;
}

/** ③ 事件一致率（两两 Ruzicka） */
export function eventConsistencyMetrics(artifacts) {
  const vectors = artifacts.map((a) => dialogueEventVector(a.scenesJson));
  const values = [];
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) values.push(ruzicka(vectors[i], vectors[j]));
  }
  return {
    eventCounts: vectors.map((v) => [...v.values()].reduce((s, n) => s + n, 0)),
    pairwise: values.map((v) => Number(v.toFixed(4))),
    mean: values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(4)) : 1,
    min: values.length ? Number(Math.min(...values).toFixed(4)) : 1,
  };
}

/** 汇总三元组 */
export function computeDriftMetrics(artifacts) {
  return {
    boundary: sceneBoundaryMetrics(artifacts),
    characters: characterSetMetrics(artifacts),
    events: eventConsistencyMetrics(artifacts),
  };
}

/** 生成 Markdown 报告（纯函数） */
export function buildDriftReport({ name, sample, model, promptHash, generatedAt, runsMeta, metrics }) {
  const lines = [];
  lines.push(`# 输出稳定性（drift）：${name}`);
  lines.push('');
  lines.push(`> 生成时间：${generatedAt} ｜ 样本：\`${sample}\` ｜ 模型：\`${model}\` ｜ 复跑次数：${runsMeta.length}　工具：\`scripts/eval/drift.mjs\`（B-02）`);
  lines.push(`> 提示词指纹：${promptHash ? `\`${promptHash.slice(0, 16)}\`` : '未提供（--prompt-file 可记录）'} —— 复跑之间必须同一提示词。`);
  lines.push('');
  lines.push('## 各次运行');
  lines.push('');
  lines.push('| 轮 | 场景数 | 引用角色 | 对话事件数 | 耗时(min) | 终态 |');
  lines.push('|---|---|---|---|---|---|');
  runsMeta.forEach((r, i) => {
    lines.push(`| r${i + 1} | ${metrics.boundary.counts[i]} | ${metrics.characters.sizes[i]} | ${metrics.events.eventCounts[i]} | ${(r.elapsedMs / 60000).toFixed(1)} | ${r.finalStatus} |`);
  });
  lines.push('');
  lines.push('## 三元组指标');
  lines.push('');
  lines.push('| 指标 | 数值 | 说明 |');
  lines.push('|---|---|---|');
  lines.push(`| 场景边界数 mean/var/min/max | ${metrics.boundary.mean} / **${metrics.boundary.variance}** / ${metrics.boundary.min} / ${metrics.boundary.max} | 方差越小越稳 |`);
  lines.push(`| 每章场景数平均 L1 漂移 | ${metrics.boundary.perChapterMeanL1} | 章节级切分粒度漂移 |`);
  lines.push(`| 角色集合 Jaccard mean/min | ${metrics.characters.mean} / ${metrics.characters.min} | 1=完全一致 |`);
  lines.push(`| 事件一致率 mean/min | ${metrics.events.mean} / ${metrics.events.min} | Ruzicka（对话事件向量） |`);
  lines.push('');
  lines.push(`两两明细：角色 Jaccard = [${metrics.characters.pairwise.join(', ')}]；事件一致率 = [${metrics.events.pairwise.join(', ')}]`);
  lines.push('');
  lines.push('## 定阈说明（先测量后定阈）');
  lines.push('');
  lines.push('本报告只给测量值，**不自动定阈**。建议以本样本多轮实测为基线，在需要"稳定性门禁"的场景声明初值（示例口径：边界方差 ≤ 1、角色 Jaccard ≥ 0.95、事件一致率 ≥ 0.8），并把阈值与样本绑定写入决策记录。');
  lines.push('');
  lines.push('## 复现');
  lines.push('');
  lines.push('```bash');
  lines.push(`node scripts/eval/drift.mjs --name ${name} --sample ${sample} --runs ${runsMeta.length} --base <server>`);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main() {
  const name = arg('name');
  const sample = arg('sample', 'zhanlan-short');
  const runs = Number(arg('runs', '3'));
  const base = arg('base', 'http://localhost:3001');
  const model = arg('model', 'deepseek-chat');
  const timeoutMin = Number(arg('timeout-min', '25'));
  const costCapCny = Number(arg('cost-cap-cny', '20'));
  const dbDir = arg('db-dir', process.env.DB_DIR || path.join(ROOT, 'apps', 'screenplay', 'data-test'));
  const dbFile = arg('db-file', process.env.DB_FILE || '1b-data.db');
  const force = process.argv.includes('--force');
  const reportOnly = process.argv.includes('--report-only');
  const onlyRun = arg('only-run') ? Number(arg('only-run')) : null;

  if (!name) {
    console.error('用法：node scripts/eval/drift.mjs --name <label> --sample <id> --runs 3 [--base URL]');
    process.exit(2);
  }

  const sampleDir = path.join(SAMPLES_DIR, sample);
  if (!existsSync(path.join(sampleDir, 'chapters.txt'))) throw new Error(`样本缺失: ${sampleDir}/chapters.txt`);

  const promptFile = arg('prompt-file');
  const promptHash = promptFile ? sha256Hex(readFileSync(promptFile, 'utf8').replace(/\r\n/g, '\n')) : null;
  const datasetHash = sha256Hex(readFileSync(path.join(sampleDir, 'chapters.txt'), 'utf8'));
  const cache = new EvalCache(createFileCache(path.join(ROOT, 'data', 'eval-cache.jsonl')));
  const readJson = (file) => JSON.parse(readFileSync(path.join(sampleDir, file), 'utf8'));
  const artifactsOf = (i) => `drift-${name}-r${i + 1}`;

  console.log(`[drift] ${name} sample=${sample} runs=${runs}${promptHash ? ` prompt=${promptHash.slice(0, 16)}` : ''}`);
  const artifacts = [];
  for (let i = 0; i < runs; i++) {
    if (onlyRun !== null && onlyRun !== i + 1) continue;
    const label = artifactsOf(i);
    const cell = {
      set: `drift:${name}`, sampleId: sample, stage: 'convert', assertionId: 'run',
      modelId: model, params: { run: i + 1, promptHash: promptHash ?? 'unset' }, datasetHash, judgePromptHash: 'none',
    };
    if (!reportOnly && (force || !cache.get(cell) || !existsSync(path.join(sampleDir, `${label}.scenes.json`)))) {
      const result = await driveConversion({
        base, sampleDir, runLabel: `${name}-r${i + 1}`, side: 'drift', model, timeoutMin, costCapCny, dbDir, dbFile, titlePrefix: 'drift',
      });
      cache.set(cell, { ranAt: new Date().toISOString(), run: i + 1, promptHash });
      artifacts.push({ i, ...result });
    } else if (existsSync(path.join(sampleDir, `${label}.scenes.json`))) {
      console.log(`[drift] r${i + 1} 复用已有产物（缓存/--report-only）`);
      artifacts.push({ i, scenesJson: readJson(`${label}.scenes.json`), run: readJson(`${label}.run.json`) });
    } else {
      throw new Error(`r${i + 1} 无产物可复用（去掉 --report-only 或加 --force 重跑）`);
    }
  }
  if (artifacts.length < 2) {
    console.log(`[drift] 当前仅 1 次运行产物；至少 2 次才能算两两指标（用 --runs N 全量跑或补齐后 --report-only）`);
    if (onlyRun !== null) return;
  }

  const metrics = computeDriftMetrics(artifacts);
  const report = buildDriftReport({
    name, sample, model, promptHash, generatedAt: new Date().toISOString(),
    runsMeta: artifacts.map((a) => a.run),
    metrics,
  });

  const outFile = arg('out', path.join(ROOT, 'docs', 'conversion-quality', `drift-${name}.md`));
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, report);
  console.log(`[drift] 报告已写入 → ${outFile}`);

  const jsonl = arg('jsonl', path.join(ROOT, 'data', 'eval-drift.jsonl'));
  mkdirSync(path.dirname(jsonl), { recursive: true });
  appendFileSync(jsonl, `${JSON.stringify({
    ts: new Date().toISOString(), name, sample, model, runs: artifacts.length, promptHash, metrics,
  })}\n`);
  console.log(`[drift] 时序记录已追加 → ${jsonl}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => { console.error(`[drift] 失败: ${err.message}`); process.exitCode = 1; });
}
