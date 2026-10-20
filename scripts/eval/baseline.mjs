/**
 * 基线聚合：每个样本 3 次运行 → 均值 / 标准差 / 自一致性
 *
 * 注意口径：
 * - 「自一致性」= 本次运行 vs run1 的预标草案（同一模型产出）。
 *   它衡量的是**稳定性**，不是准确率；人工抽检冻结后才有 accuracy 口径。
 * - 追溯率不需要金标注，任何运行都能算。
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  scorePhase1,
  scorePhase2,
  scoreTraceability,
  extractPrediction,
  macroAverage,
} from './annotation.mjs';

const DB = 'apps/screenplay/data-test/1b-data.db';
const OUT_DIR = 'pr-evidence/baseline';
const db = new Database(DB, { readonly: true });

const RUNS = {
  'doupo-short': ['job_1792418104222_qf2qr0', 'job_1792474421049_lf95um', 'job_1792474526728_a3r3sy'],
  'zhanlan-short': ['job_1792421566811_8we0fn', 'job_1792474612173_uf9kha', 'job_1792474702600_ix47nx'],
  'xiuzhen-short': ['job_1792421684668_hzmwlo', 'job_1792474788071_dsfm2j', 'job_1792474994320_x30vag'],
};

function load(jobId) {
  const row = db.prepare('SELECT chapter_texts, pipeline_state FROM jobs WHERE id=?').get(jobId);
  if (!row) throw new Error(`job 不存在: ${jobId}`);
  return { chapters: JSON.parse(row.chapter_texts), st: JSON.parse(row.pipeline_state) };
}

function mean(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  return Number((v.reduce((s, n) => s + n, 0) / v.length).toFixed(4));
}
function sd(xs) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (v.length < 2) return null;
  const m = v.reduce((s, n) => s + n, 0) / v.length;
  return Number(Math.sqrt(v.reduce((s, n) => s + (n - m) ** 2, 0) / (v.length - 1)).toFixed(4));
}

const report = { generatedAt: new Date().toISOString(), samples: [] };

for (const [sampleId, jobIds] of Object.entries(RUNS)) {
  const draft = JSON.parse(fs.readFileSync(path.join('scripts', 'eval', 'samples', sampleId, 'annotation.draft.json'), 'utf8'));
  const runs = jobIds.map((jobId, i) => {
    const { chapters, st } = load(jobId);
    const pred = extractPrediction(st);
    const p1 = scorePhase1(draft.characters, pred.characters);
    const p2 = scorePhase2(draft.scenes, pred.scenes);
    const tr = scoreTraceability(pred.phase3Scenes, chapters);
    return {
      run: i + 1,
      jobId,
      scenes: st.phase4Output.scenes.length,
      chapters: chapters.length,
      characters: st.phase1Output.characters.length,
      charactersInScenes: new Set(st.phase2Output.scenes.flatMap((s) => s.keyCharacterNames || [])).size,
      traceability: tr.hitRate,
      judge: st.qualityAssessment?.score ?? null,
      agreeP1F1: p1.f1,
      agreeP2F1: p2.f1,
      elapsedMs: null,
    };
  });

  const agg = {
    scenes: { mean: mean(runs.map((r) => r.scenes)), sd: sd(runs.map((r) => r.scenes)) },
    characters: { mean: mean(runs.map((r) => r.characters)), sd: sd(runs.map((r) => r.characters)) },
    traceability: { mean: mean(runs.map((r) => r.traceability)), sd: sd(runs.map((r) => r.traceability)) },
    judge: { mean: mean(runs.map((r) => r.judge)), sd: sd(runs.map((r) => r.judge)) },
    agreeP1F1: { mean: mean(runs.map((r) => r.agreeP1F1)), sd: sd(runs.map((r) => r.agreeP1F1)) },
    agreeP2F1: { mean: mean(runs.map((r) => r.agreeP2F1)), sd: sd(runs.map((r) => r.agreeP2F1)) },
    // run1 与草案同源，自一致恒为 1.0；跨运行稳定性应只看 run2/3
    crossRunP1F1: { mean: mean(runs.slice(1).map((r) => r.agreeP1F1)), sd: sd(runs.slice(1).map((r) => r.agreeP1F1)) },
    crossRunP2F1: { mean: mean(runs.slice(1).map((r) => r.agreeP2F1)), sd: sd(runs.slice(1).map((r) => r.agreeP2F1)) },
    scenesPerChapter: Number((mean(runs.map((r) => r.scenes / r.chapters)) ?? 0).toFixed(2)),
  };

  report.samples.push({ sampleId, runs, agg });
}

db.close();
fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT_DIR, `baseline-${stamp}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');

// ── Markdown ──
const lines = [];
lines.push(`# 基线（${stamp}）· 默认 truncate · 每样本 3 次`);
lines.push('');
lines.push('> 口径说明：「自一致性」= 本次运行 vs run1 预标草案（同一模型），衡量**稳定性**，不是准确率。');
lines.push('> 人工抽检并 freeze 之后才有 accuracy；当前所有样本 `reviewed=false`。');
lines.push('');
lines.push('| 样本 | 场景数 (mean±σ) | 场景/章 | 角色数 (mean±σ) | 溯源 (mean±σ) | judge (mean±σ) | 跨运行 P1 F1 | 跨运行 P2 F1 |');
lines.push('|------|------------------|---------|------------------|----------------|-----------------|--------------|--------------|');
for (const s of report.samples) {
  const a = s.agg;
  lines.push(
    `| ${s.sampleId} | ${a.scenes.mean} ± ${a.scenes.sd} | ${a.scenesPerChapter} | ${a.characters.mean} ± ${a.characters.sd} | ` +
    `${(a.traceability.mean * 100).toFixed(1)}% ± ${(a.traceability.sd * 100).toFixed(1)}% | ${a.judge.mean} ± ${a.judge.sd} | ` +
    `${a.crossRunP1F1.mean} ± ${a.crossRunP1F1.sd} | ${a.crossRunP2F1.mean} ± ${a.crossRunP2F1.sd} |`,
  );
}
lines.push('');
lines.push('> 「跨运行」= 只统计 run2/run3 对 run1 草案的一致性（run1 与草案同源，恒为 1.0，已剔除）。');
lines.push('');
lines.push('## 逐次运行');
lines.push('');
for (const s of report.samples) {
  lines.push(`### ${s.sampleId}`);
  lines.push('');
  lines.push('| run | jobId | 场景 | 角色 | 场景内角色 | 溯源 | judge | P1 F1 | P2 F1 |');
  lines.push('|-----|-------|------|------|-----------|------|-------|-------|-------|');
  for (const r of s.runs) {
    lines.push(
      `| ${r.run} | \`${r.jobId}\` | ${r.scenes} | ${r.characters} | ${r.charactersInScenes} | ${(r.traceability * 100).toFixed(1)}% | ` +
      `${r.judge ?? '—'} | ${r.agreeP1F1} | ${r.agreeP2F1} |`,
    );
  }
  lines.push('');
}
fs.writeFileSync(path.join(OUT_DIR, `baseline-${stamp}.md`), lines.join('\n') + '\n', 'utf8');

console.log(lines.join('\n'));
console.log(`\n已写入 ${OUT_DIR}/baseline-${stamp}.{md,json}`);
