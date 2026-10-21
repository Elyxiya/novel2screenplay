/**
 * Phase 1 模式 A/B：truncate（默认）vs mapreduce
 *
 * 为什么单独有这条脚本：`flip-decision-record.md` 的 R1/R2/R3 判据看的是
 * 「尾段占位率 / judge 分层」，而截断最直接的损伤其实是**角色召回**——
 * 后段才登场的角色根本进不了角色卡。这条轴之前的 A/B 没覆盖，用它补上。
 *
 * 用法：node scripts/eval/phase1-ab.mjs
 * 修改：直接改下面的 SAMPLES 常量（或后续接 --sample/--mr/--base 参数）。
 *
 * 注意：Phase 1 的 precision 会被「描述性实体」拉低（月白衣袍老者、瓜子脸女孩…），
 * 那是另一个问题（实体归一），不是召回问题；看结论时要分开读。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  extractPrediction,
  scorePhase1,
  scorePhase2,
  scoreTraceability,
  scoreExposition,
} from './annotation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'apps/screenplay/data-test/1b-data.db');
const SAMPLES_DIR = path.join(ROOT, 'scripts/eval/samples');

/**
 * 每样本：mapreduce 运行 + 3 次 truncate 运行（取均值）。
 *
 * 注意 mapreduce 的 jobId 要指向**当前代码**（含 segment prompt v2）下的运行，
 * 否则 A/B 表会混入旧 prompt 的结果。（2026-10-21 刷新为 v2 运行。）
 * 口径：本表读的是 Phase1 **原始**输出（未过 character-sanitizer），
 * 所以与 §七 准确率（实际管线产物）会有小幅差异。
 */
const SAMPLES = {
  'doupo-short': {
    mr: 'job_1792558119587_204gjr',
    base: ['job_1792418104222_qf2qr0', 'job_1792474421049_lf95um', 'job_1792474526728_a3r3sy'],
  },
  'zhanlan-short': {
    mr: 'job_1792576365385_p5asci',
    base: ['job_1792421566811_8we0fn', 'job_1792474612173_uf9kha', 'job_1792474702600_ix47nx'],
  },
  'xiuzhen-short': {
    mr: 'job_1792557928865_qkaylc',
    base: ['job_1792421684668_hzmwlo', 'job_1792474788071_dsfm2j', 'job_1792474994320_x30vag'],
  },
};

const db = new Database(DB, { readonly: true });

function load(jobId) {
  const row = db.prepare('SELECT chapter_texts, pipeline_state FROM jobs WHERE id=?').get(jobId);
  if (!row) throw new Error(`job 不存在: ${jobId}`);
  return { chapters: JSON.parse(row.chapter_texts), st: JSON.parse(row.pipeline_state) };
}

function evaluate(jobId, ref) {
  const { chapters, st } = load(jobId);
  const pred = extractPrediction(st);
  return {
    card: st.phase1Output.characters.length,
    p1: scorePhase1(ref.characters, pred.characters),
    p2: scorePhase2(ref.scenes, pred.scenes),
    tr: scoreTraceability(pred.phase3Scenes, chapters),
    ex: scoreExposition(pred.phase3Scenes),
  };
}

const avg = (xs) => Number((xs.reduce((s, n) => s + n, 0) / xs.length).toFixed(4));

const rows = [];
for (const [sampleId, cfg] of Object.entries(SAMPLES)) {
  const dir = path.join(SAMPLES_DIR, sampleId);
  const refFile = fs.existsSync(path.join(dir, 'gold.json')) ? 'gold.json' : 'annotation.draft.json';
  const ref = JSON.parse(fs.readFileSync(path.join(dir, refFile), 'utf8'));

  const base = cfg.base.map((id) => evaluate(id, ref));
  const mr = evaluate(cfg.mr, ref);

  rows.push({
    sampleId,
    refFile,
    truncate: {
      card: avg(base.map((b) => b.card)),
      p1: { p: avg(base.map((b) => b.p1.precision)), r: avg(base.map((b) => b.p1.recall)), f1: avg(base.map((b) => b.p1.f1)) },
      p2f1: avg(base.map((b) => b.p2.f1)),
      trace: avg(base.map((b) => b.tr.hitRate)),
      ex: avg(base.map((b) => b.ex.expositionRate)),
    },
    mapreduce: {
      card: mr.card,
      p1: { p: mr.p1.precision, r: mr.p1.recall, f1: mr.p1.f1 },
      p2f1: mr.p2.f1,
      trace: mr.tr.hitRate,
      ex: mr.ex.expositionRate,
      missing: mr.p1.missing,
    },
  });
}
db.close();

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const lines = [];
lines.push('| 样本 | 模式 | 角色卡 | P1 P | P1 R | P1 F1 | P2 F1 | 溯源 | 倾倒 |');
lines.push('|------|------|--------|------|------|-------|-------|------|------|');
for (const r of rows) {
  lines.push(
    `| ${r.sampleId} | truncate | ${r.truncate.card} | ${r.truncate.p1.p} | ${r.truncate.p1.r} | ${r.truncate.p1.f1} | ${r.truncate.p2f1} | ${pct(r.truncate.trace)} | ${r.truncate.ex} |`,
  );
  lines.push(
    `| ${r.sampleId} | mapreduce | ${r.mapreduce.card} | ${r.mapreduce.p1.p} | ${r.mapreduce.p1.r} | ${r.mapreduce.p1.f1} | ${r.mapreduce.p2f1} | ${pct(r.mapreduce.trace)} | ${r.mapreduce.ex} |`,
  );
}
lines.push('');
for (const r of rows) {
  if (r.mapreduce.missing.length) lines.push(`- ${r.sampleId} mapreduce 漏抽：${r.mapreduce.missing.join('、')}`);
}

console.log(lines.join('\n'));
