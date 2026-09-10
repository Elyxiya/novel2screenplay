#!/usr/bin/env node
/**
 * 漂移检测最小版（FIX-09）：消费 data/eval-drift.jsonl 时序 + 阈值比对 + Mock 硬门
 *
 * 用法：
 *   node scripts/eval/drift-check.mjs [--jsonl data/eval-drift.jsonl] \
 *     [--thresholds data/drift-thresholds.json] [--name <label>] [--mock-gate] [--report-only]
 *
 * 模式：
 *   ① 检查模式（默认）：读时序 → 取指定 name（或全部最新一条）→ 与阈值比对 →
 *      违例即 ALERT 并 exitCode=1；未提供 thresholds 时仅输出趋势并提示"未定阈"（exit 0）。
 *   ② Mock 硬门（--mock-gate 或无 server 场景）：不调用任何 LLM——运行评估工具的
 *      确定性测试（drift/prompt-diff/model-matrix 的 node --test），全绿才算通过，
 *      保证"无 key 环境体系不腐烂"（移植 HelloAgents nightly 的 Mock 硬门思路）。
 *
 * 阈值文件（示例见 docs/conversion-quality/drift-thresholds.example.json）：
 *   { "maxSceneVariance": 4, "maxPerChapterL1": 10,
 *     "minCharacterJaccard": 0.6, "minEventConsistency": 0.55 }
 *   缺省字段不检查；**必须来自人工按目标声明（先测量后定阈，B-02 基线详见 drift-fix10-prompt.md）**。
 *
 * 调度：CI/nightly 建议——先跑 `node scripts/eval/drift.mjs --name <label> … --runs 3`（需 key+server），
 *   再 `node scripts/eval/drift-check.mjs --mock-gate`；无 key 环境仅跑第二条即可守住确定性面。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ── 纯函数（可测） ─────────────────────────────────────────────────────────

/** 解析 JSONL 时序（坏行跳过并计数） */
export function parseDriftSeries(text) {
  const records = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.metrics) records.push(row);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { records, skipped };
}

/** 取指定 name 的最新记录；未给 name 时取全局最新一条 */
export function pickLatest(records, name) {
  const pool = name ? records.filter((r) => r.name === name) : records;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => String(a.ts).localeCompare(String(b.ts))).at(-1);
}

/** 阈值比对：返回违例列表（阈值缺省字段不检查） */
export function evaluateThresholds(record, thresholds) {
  const violations = [];
  if (!record || !thresholds) return violations;
  const m = record.metrics;
  const checkMax = (field, value, limit) => {
    if (typeof limit === 'number' && typeof value === 'number' && value > limit) {
      violations.push(`${field}=${value} 超过上限 ${limit}`);
    }
  };
  const checkMin = (field, value, limit) => {
    if (typeof limit === 'number' && typeof value === 'number' && value < limit) {
      violations.push(`${field}=${value} 低于下限 ${limit}`);
    }
  };
  checkMax('boundary.variance', m?.boundary?.variance, thresholds.maxSceneVariance);
  checkMax('boundary.perChapterMeanL1', m?.boundary?.perChapterMeanL1, thresholds.maxPerChapterL1);
  checkMin('characters.mean', m?.characters?.mean, thresholds.minCharacterJaccard);
  checkMin('events.mean', m?.events?.mean, thresholds.minEventConsistency);
  return violations;
}

/** 格式化检查输出（纯函数，可测） */
export function formatCheckText(record, violations, thresholdsProvided) {
  if (!record) return '[drift-check] 时序为空：尚无 drift 记录（先跑 drift.mjs）';
  const m = record.metrics;
  const lines = [];
  lines.push(`[drift-check] name=${record.name} ts=${record.ts} sample=${record.sample} runs=${record.runs}`);
  lines.push(`  边界方差=${m.boundary.variance}（28/32/29 类）perChapterL1=${m.boundary.perChapterMeanL1}`);
  lines.push(`  角色 Jaccard mean=${m.characters.mean} min=${m.characters.min} ｜ 事件一致率 mean=${m.events.mean} min=${m.events.min}`);
  if (!thresholdsProvided) {
    lines.push('  ⚠ 未提供阈值文件：仅报告趋势，不做判定（先测量后定阈——阈值须人工按目标声明）');
  } else if (violations.length > 0) {
    lines.push(`  🚨 ALERT：${violations.length} 项超阈`);
    for (const v of violations) lines.push(`    - ${v}`);
  } else {
    lines.push('  ✅ 阈值检查通过');
  }
  return lines.join('\n');
}

// ── Mock 硬门 ─────────────────────────────────────────────────────────────

const GATE_TESTS = ['drift.test.mjs', 'prompt-diff.test.mjs', 'model-matrix.test.mjs'];

/** 无 LLM 的确定性硬门：评估工具纯函数测试必须全绿 */
export function runMockGate() {
  const results = [];
  for (const t of GATE_TESTS) {
    const r = spawnSync(process.execPath, ['--test', path.join(ROOT, 'scripts', 'eval', t)], { encoding: 'utf8' });
    results.push({ test: t, ok: r.status === 0, tail: (r.stdout ?? '').split('\n').filter((l) => l.startsWith('ℹ')).join(' ') });
  }
  return results;
}

// ── 主流程 ────────────────────────────────────────────────────────────────

function main() {
  const jsonl = arg('jsonl', path.join(ROOT, 'data', 'eval-drift.jsonl'));
  const thresholdsFile = arg('thresholds', path.join(ROOT, 'data', 'drift-thresholds.json'));
  const name = arg('name');
  const mockGate = process.argv.includes('--mock-gate');
  const reportOnly = process.argv.includes('--report-only');

  let failed = false;

  // ① 时序检查
  if (existsSync(jsonl)) {
    const { records, skipped } = parseDriftSeries(readFileSync(jsonl, 'utf8'));
    if (skipped > 0) console.log(`[drift-check] JSONL 坏行跳过 ${skipped} 条`);
    const latest = pickLatest(records, name);
    const hasThresholds = existsSync(thresholdsFile);
    const thresholds = hasThresholds ? JSON.parse(readFileSync(thresholdsFile, 'utf8')) : null;
    const violations = hasThresholds && !reportOnly ? evaluateThresholds(latest, thresholds) : [];
    console.log(formatCheckText(latest, violations, hasThresholds && !reportOnly));
    if (violations.length > 0) failed = true;
  } else {
    console.log(`[drift-check] 时序文件不存在（${jsonl}）：跳过趋势检查（先跑 drift.mjs）`);
  }

  // ② Mock 硬门
  if (mockGate) {
    console.log('[drift-check] Mock 硬门（无 LLM 确定性测试）：');
    for (const r of runMockGate()) {
      console.log(`  ${r.ok ? '✅' : '🚨'} ${r.test}${r.ok ? '' : ` — ${r.tail}`}`);
      if (!r.ok) failed = true;
    }
  }

  if (failed) {
    console.error('[drift-check] 结论：存在违例/硬门失败');
    process.exitCode = 1;
  } else {
    console.log('[drift-check] 结论：通过');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); } catch (err) { console.error(`[drift-check] 失败: ${err.message}`); process.exitCode = 1; }
}
