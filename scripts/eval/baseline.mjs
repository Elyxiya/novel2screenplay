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
  const dir = path.join('scripts', 'eval', 'samples', sampleId);
  const goldPath = path.join(dir, 'gold.json');
  const draftPath = path.join(dir, 'annotation.draft.json');
  const goldFile = fs.existsSync(goldPath) ? goldPath : draftPath;
  const draft = JSON.parse(fs.readFileSync(goldFile, 'utf8'));
  const goldJobId = draft.meta?.provenance?.jobId ?? null;
  const runs = jobIds.map((jobId, i) => {
    const { chapters, st } = load(jobId);
    const pred = extractPrediction(st);
    const p1 = scorePhase1(draft.characters, pred.characters);
    const p2 = scorePhase2(draft.scenes, pred.scenes);
    const tr = scoreTraceability(pred.phase3Scenes, chapters);
    return {
      run: i + 1,
      jobId,
      // 金标注若由该次运行自标，分数天然偏高（自我一致），聚合时剔除
      selfAnnotated: goldJobId === jobId,
      scenes: st.phase4Output.scenes.length,
      chapters: chapters.length,
      characters: st.phase1Output.characters.length,
      charactersInScenes: new Set(st.phase2Output.scenes.flatMap((s) => s.keyCharacterNames || [])).size,
      traceability: tr.hitRate,
      judge: st.qualityAssessment?.score ?? null,
      agreeP1F1: p1.f1,
      agreeP2F1: p2.f1,
    };
  });

  // 只有「非自证」且样本已抽检时，精度指标才进 official
  const reviewed = Boolean(draft.meta?.reviewed);
  const scored = runs.filter((r) => !r.selfAnnotated);
  const accuracyBase = reviewed ? scored : [];

  const agg = {
    goldFile: path.basename(goldFile),
    reviewed,
    scenes: { mean: mean(runs.map((r) => r.scenes)), sd: sd(runs.map((r) => r.scenes)) },
    characters: { mean: mean(runs.map((r) => r.characters)), sd: sd(runs.map((r) => r.characters)) },
    traceability: { mean: mean(runs.map((r) => r.traceability)), sd: sd(runs.map((r) => r.traceability)) },
    judge: { mean: mean(runs.map((r) => r.judge)), sd: sd(runs.map((r) => r.judge)) },
    // 「跨运行」= 不含自证运行（run1 与草案同源时恒为 1.0）
    crossRunP1F1: { mean: mean(scored.map((r) => r.agreeP1F1)), sd: sd(scored.map((r) => r.agreeP1F1)) },
    crossRunP2F1: { mean: mean(scored.map((r) => r.agreeP2F1)), sd: sd(scored.map((r) => r.agreeP2F1)) },
    // 「准确率」= 对人工抽检后的金标注；未抽检时为空
    accuracyP1F1: { mean: accuracyBase.length ? mean(accuracyBase.map((r) => r.agreeP1F1)) : null, sd: accuracyBase.length ? sd(accuracyBase.map((r) => r.agreeP1F1)) : null },
    accuracyP2F1: { mean: accuracyBase.length ? mean(accuracyBase.map((r) => r.agreeP2F1)) : null, sd: accuracyBase.length ? sd(accuracyBase.map((r) => r.agreeP2F1)) : null },
    scoredRuns: scored.length,
    scenesPerChapter: Number((mean(runs.map((r) => r.scenes / r.chapters)) ?? 0).toFixed(2)),
  };

  report.samples.push({ sampleId, runs, agg });
}

db.close();
fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT_DIR, `baseline-${stamp}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');

// ── Markdown ──
const fmt = (m) => (m === null || m === undefined ? '—' : m);
const lines = [];
lines.push(`# 基线（${stamp}）· 默认 truncate · 每样本 3 次`);
lines.push('');
lines.push('> 「跨运行」= 剔除自证运行后，其余运行与金标注的一致性（衡量稳定性）。');
lines.push('> 「准确率」= 对**人工抽检后**的金标注（仅 reviewed=true 且非自证的运行计入）。');
lines.push('');
lines.push('| 样本 | 金标注 | 场景数 | 场景/章 | 角色数 | 溯源 | judge | 跨运行 P1 F1 | 跨运行 P2 F1 | 准确率 P1 F1 | 准确率 P2 F1 |');
lines.push('|------|--------|--------|---------|--------|------|-------|--------------|--------------|--------------|--------------|');
for (const s of report.samples) {
  const a = s.agg;
  lines.push(
    `| ${s.sampleId} | ${a.goldFile}${a.reviewed ? ' ✓' : ''} | ${a.scenes.mean} ± ${a.scenes.sd} | ${a.scenesPerChapter} | ` +
    `${a.characters.mean} ± ${a.characters.sd} | ${(a.traceability.mean * 100).toFixed(1)}% ± ${(a.traceability.sd * 100).toFixed(1)}% | ` +
    `${a.judge.mean} ± ${a.judge.sd} | ${a.crossRunP1F1.mean} ± ${a.crossRunP1F1.sd} | ${a.crossRunP2F1.mean} ± ${a.crossRunP2F1.sd} | ` +
    `${fmt(a.accuracyP1F1.mean)} | ${fmt(a.accuracyP2F1.mean)} |`,
  );
}
lines.push('');
lines.push('> 「跨运行」与「准确率」的差别：前者回答「重跑会不会变」，后者回答「变得对不对」。');
lines.push('');
lines.push('## 逐次运行');
lines.push('');
for (const s of report.samples) {
  lines.push(`### ${s.sampleId}`);
  lines.push('');
  lines.push('| run | jobId | 场景 | 角色 | 场景内角色 | 溯源 | judge | P1 F1 | P2 F1 | 自证 |');
  lines.push('|-----|-------|------|------|-----------|------|-------|-------|-------|------|');
  for (const r of s.runs) {
    lines.push(
      `| ${r.run} | \`${r.jobId}\` | ${r.scenes} | ${r.characters} | ${r.charactersInScenes} | ${(r.traceability * 100).toFixed(1)}% | ` +
      `${r.judge ?? '—'} | ${r.agreeP1F1} | ${r.agreeP2F1} | ${r.selfAnnotated ? '是（剔除）' : ''} |`,
    );
  }
  lines.push('');
}
fs.writeFileSync(path.join(OUT_DIR, `baseline-${stamp}.md`), lines.join('\n') + '\n', 'utf8');

console.log(lines.join('\n'));
console.log(`\n已写入 ${OUT_DIR}/baseline-${stamp}.{md,json}`);
