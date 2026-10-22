/**
 * 批量给多个 job 打分：一次跑完「P1 准确率 / P2 准确率 / 溯源率」，并给出均值±σ。
 *
 * 为什么需要：P0 收口要对比「同一配置的多次运行」，手工逐个 score 容易抄错，
 * 也看不出波动。这里只读库里已落库的运行，不花钱、不改数据。
 *
 * 用法：
 *   node scripts/eval/score-jobs.mjs --sample zhanlan-short --jobs job_a,job_b,job_c
 *   可选：--db-dir apps/screenplay/data-test --db-file 1b-data.db
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { extractPrediction, scorePhase1, scorePhase2, scoreTraceability } from './annotation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.sample || !args.jobs) {
  console.error('用法: node scripts/eval/score-jobs.mjs --sample <id> --jobs job_a,job_b [--db-dir ...] [--db-file ...]');
  process.exit(1);
}

const goldPath = path.join(ROOT, 'scripts/eval/samples', args.sample, 'gold.json');
if (!fs.existsSync(goldPath)) {
  console.error(`[score-jobs] 缺 ${args.sample} 的金标注（gold.json），无法打分`);
  process.exit(1);
}
const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));

const dbPath = path.join(ROOT, args['db-dir'] ?? 'apps/screenplay/data-test', args['db-file'] ?? '1b-data.db');
const db = new Database(dbPath, { readonly: true });

const mean = (xs) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : NaN);
const sd = (xs) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, n) => s + (n - m) ** 2, 0) / (xs.length - 1));
};
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(3) : '—');

const rows = [];
for (const jobId of String(args.jobs).split(',').map((s) => s.trim()).filter(Boolean)) {
  const row = db.prepare('SELECT chapter_texts, pipeline_state FROM jobs WHERE id=?').get(jobId);
  if (!row) {
    console.log(`| ${jobId} | 缺失 | — | — | — | — |`);
    continue;
  }
  const chapters = JSON.parse(row.chapter_texts);
  const st = JSON.parse(row.pipeline_state);
  const pred = extractPrediction(st);
  const p1 = scorePhase1(gold.characters, pred.characters);
  const p2 = scorePhase2(gold.scenes, pred.scenes);
  const tr = scoreTraceability(pred.phase3Scenes, chapters);
  rows.push({
    jobId,
    scenes: pred.scenes.length,
    chars: st.phase1Output?.characters?.length ?? '—',
    p1: p1.f1,
    p2: p2.f1,
    trace: tr.hitRate,
  });
}
db.close();

console.log(`\n样本 ${args.sample}（金标注 ${gold.characters.length} 角色 / ${gold.scenes.length} 场景）\n`);
console.log('| jobId | 场景 | 角色 | P1 F1 | P2 F1 | 溯源 |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.jobId} | ${r.scenes} | ${r.chars} | ${fmt(r.p1)} | ${fmt(r.p2)} | ${(r.trace * 100).toFixed(1)}% |`);
}
if (rows.length) {
  console.log(
    `\n均值：P1 ${fmt(mean(rows.map((r) => r.p1)))} ± ${fmt(sd(rows.map((r) => r.p1)))} ｜ ` +
      `P2 ${fmt(mean(rows.map((r) => r.p2)))} ± ${fmt(sd(rows.map((r) => r.p2)))} ｜ ` +
      `溯源 ${(mean(rows.map((r) => r.trace)) * 100).toFixed(1)}%`,
  );
}
