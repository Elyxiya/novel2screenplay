#!/usr/bin/env node
/**
 * 评分（P2）
 *
 *   # 单样本：直接从一个真实任务取产物
 *   node scripts/eval/score.mjs --sample xiuzhen-short --job job_xxx \
 *        [--db-dir apps/screenplay/data-test] [--db-file 1b-data.db] [--json]
 *
 *   # 单样本：离线产物（转换跑批导出的 run.json）
 *   node scripts/eval/score.mjs --sample xiuzhen-short --state samples/xiuzhen-short/run.json
 *
 *   # 全量：按 manifest 遍历，读取 samples/<id>/run.json
 *   node scripts/eval/score.mjs --all
 *
 * 指标口径（与 annotation.mjs 一致）：
 *   Phase1  角色 P/R/F1（别名归一后贪心 1:1）
 *   Phase2  场景边界 P/R/F1（同章段落区间 IoU ≥ 0.5）
 *   Phase3  可溯源性（sourceRef.excerpt 是否真在原文出现）
 *
 * 只把 reviewed=true 的样本计入 official；其余进 pending 并在结论里显式标出。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkIndependence,
  extractPrediction,
  scorePhase1,
  scorePhase2,
  scoreTraceability,
  summarizeEvaluation,
  validateGold,
} from './annotation.mjs';
import { readJobConfig, readPipelineState, splitChapters } from './convert-driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES_DIR = path.join(ROOT, 'scripts', 'eval', 'samples');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

/** 读取一次运行的产物：{ pipelineState, chapterTexts, modelId } */
async function loadRun(sampleId, opts) {
  if (opts.state) {
    const state = JSON.parse(readFileSync(path.resolve(ROOT, opts.state), 'utf8'));
    return {
      pipelineState: state.pipelineState ?? state,
      chapterTexts: state.chapterTexts ?? null,
      modelId: state.modelId ?? null,
    };
  }

  if (opts.job) {
    const dbDir = path.resolve(ROOT, opts['db-dir'] ?? 'apps/screenplay/data-test');
    const dbFile = opts['db-file'] ?? '1b-data.db';
    const pipelineState = readPipelineState(opts.job, dbDir, dbFile);
    const config = readJobConfig(opts.job, dbDir, dbFile);
    return { pipelineState, chapterTexts: null, modelId: config?.modelId ?? null };
  }

  const fallback = path.join(SAMPLES_DIR, sampleId, 'run.json');
  if (existsSync(fallback)) {
    const state = JSON.parse(readFileSync(fallback, 'utf8'));
    return {
      pipelineState: state.pipelineState ?? state,
      chapterTexts: state.chapterTexts ?? null,
      modelId: state.modelId ?? null,
    };
  }

  throw new Error(`样本 ${sampleId} 没有运行产物：请传 --job/--state，或放置 ${path.relative(ROOT, fallback)}`);
}

/** 从 chapters.txt 还原「按章分好的正文」，供溯源性检查（与 convert-driver 同一套分章口径） */
function chapterTextsFromFile(sampleId) {
  const raw = readFileSync(path.join(SAMPLES_DIR, sampleId, 'chapters.txt'), 'utf8');
  return splitChapters(raw).map((c) => c.text);
}

async function scoreSample(sampleId, opts) {
  const goldPath = path.join(SAMPLES_DIR, sampleId, 'annotation.json');
  if (!existsSync(goldPath)) throw new Error(`样本 ${sampleId} 未冻结金标注（缺 annotation.json）`);

  const gold = JSON.parse(readFileSync(goldPath, 'utf8'));
  const { ok, errors } = validateGold(gold);
  if (!ok) throw new Error(`金标注校验失败：${errors.join('；')}`);

  const run = await loadRun(sampleId, opts);
  if (!run.pipelineState) throw new Error(`样本 ${sampleId} 的运行产物为空`);

  const pred = extractPrediction(run.pipelineState);
  const chapterTexts = run.chapterTexts ?? chapterTextsFromFile(sampleId);

  const phase1 = scorePhase1(gold.characters, pred.characters);
  const phase2 = scorePhase2(gold.scenes, pred.scenes);
  const traceability = scoreTraceability(pred.phase3Scenes, chapterTexts);

  const warnings = [];
  const circular = checkIndependence(gold, { modelId: run.modelId, promptHash: opts['prompt-hash'] });
  if (circular) warnings.push(circular);

  return {
    sampleId,
    reviewed: Boolean(gold.meta?.reviewed),
    split: gold.meta?.split ?? 'train',
    modelId: run.modelId,
    phase1,
    phase2,
    traceability,
    warnings,
  };
}

function printRecord(r) {
  console.log(`\n[${r.sampleId}] split=${r.split} reviewed=${r.reviewed} model=${r.modelId ?? '—'}`);
  console.log(`  Phase1 角色   P ${r.phase1.precision}  R ${r.phase1.recall}  F1 ${r.phase1.f1}  (命中 ${r.phase1.matched}/${r.phase1.goldCount})`);
  console.log(`  Phase2 场景   P ${r.phase2.precision}  R ${r.phase2.recall}  F1 ${r.phase2.f1}  (命中 ${r.phase2.matched}/${r.phase2.goldCount})`);
  console.log(`  Phase3 溯源   命中率 ${r.traceability.hitRate}  有据块 ${r.traceability.withRefs}/${r.traceability.blocks}`);
  if (r.phase1.missing.length) console.log(`  漏抽角色: ${r.phase1.missing.join('、')}`);
  if (r.phase2.missing.length) console.log(`  漏切场景: ${r.phase2.missing.join('、')}`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
}

(async () => {
  try {
    if (args.all) {
      const manifestPath = path.join(SAMPLES_DIR, 'manifest.json');
      if (!existsSync(manifestPath)) throw new Error('缺 manifest.json，先运行 freeze.mjs');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const records = [];
      for (const s of manifest.samples) {
        try {
          records.push(await scoreSample(s.sampleId, args));
        } catch (err) {
          console.warn(`  ! 跳过 ${s.sampleId}：${err.message}`);
        }
      }
      records.forEach(printRecord);
      const summary = summarizeEvaluation(records);
      console.log('\n=== 汇总（仅 reviewed=true 计入 official）===');
      console.log(`  样本 ${summary.total} ｜ official ${summary.officialCount} ｜ pending ${summary.pendingCount}`);
      for (const [k, v] of Object.entries(summary.official)) console.log(`  ${k.padEnd(20)} ${v ?? '—'}`);
      for (const w of summary.warnings) console.log(`  ! ${w}`);

      const outDir = path.join(ROOT, 'pr-evidence');
      mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `eval-score-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(outPath, `${JSON.stringify({ summary, records }, null, 2)}\n`, 'utf8');
      console.log(`\n报告已写入 ${path.relative(ROOT, outPath)}`);
      process.exit(0);
    }

    if (!args.sample) {
      console.error('用法: node scripts/eval/score.mjs --sample <id> (--job <jobId> | --state <file>)  |  --all');
      process.exit(1);
    }

    const record = await scoreSample(args.sample, args);
    if (args.json) {
      console.log(JSON.stringify(record, null, 2));
    } else {
      printRecord(record);
    }
    process.exit(0);
  } catch (err) {
    console.error(`[score] ${err.message}`);
    process.exit(1);
  }
})();
