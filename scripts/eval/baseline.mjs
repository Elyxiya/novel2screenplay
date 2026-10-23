/**
 * 基线聚合：每个样本 3–4 次运行 → 均值 / 标准差 / 自一致性
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
  chapterLabel,
} from './annotation.mjs';

const DB = 'apps/screenplay/data-test/1b-data.db';
const OUT_DIR = 'pr-evidence/baseline';
const db = new Database(DB, { readonly: true });

/**
 * 三样本 × 3–4 次运行。**2026-10-22 换血**：Phase2 逐章角色上下文修复（2de0b8d）后，
 * doupo 4 次、zhanlan/xiuzhen 各 3 次；旧 3×3 是修复前基线，保留在 git 历史与账本中作对照。
 *
 * 外部运行集（不改默认）：
 *   node scripts/eval/baseline.mjs --runs-file runs.json
 *   node scripts/eval/baseline.mjs --runs '{"doupo-short":["job_...","job_..."]}'
 * 格式为 `{ 样本ID: [jobId, ...] }`，允许只给部分样本；输出落 `baseline-<date>-custom.*`，
 * 避免覆盖官方基线，并在表头标注「外部运行集」。
 */
const DEFAULT_RUNS = {
  'doupo-short': [
    'job_1792640675117_wpflqx',
    'job_1792640765755_4j11si',
    'job_1792640851305_milgkx',
    'job_1792642895616_gqzukg',
  ],
  'zhanlan-short': [
    'job_1792638287888_iratsw',
    'job_1792640141470_tuttso',
    'job_1792640239639_2b9x8i',
  ],
  'xiuzhen-short': [
    'job_1792640445832_681fmc',
    'job_1792640954103_o4rspd',
    'job_1792641155110_ylp2u7',
  ],
};

function parseArgs(argv) {
  const out = { runsFile: null, runsJson: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--runs-file') out.runsFile = argv[++i];
    else if (flag === '--runs') out.runsJson = argv[++i];
    else throw new Error(`未知参数: ${flag}（支持 --runs-file <file> | --runs '<json>'）`);
  }
  if (out.runsFile && out.runsJson) throw new Error('--runs 与 --runs-file 只能二选一');
  for (const v of [out.runsFile, out.runsJson]) {
    if (v === undefined) throw new Error('--runs / --runs-file 缺少取值');
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const customRuns = Boolean(args.runsFile || args.runsJson);
let RUNS = DEFAULT_RUNS;

if (customRuns) {
  let raw;
  try {
    raw = args.runsJson ?? fs.readFileSync(args.runsFile, 'utf8');
  } catch (err) {
    throw new Error(`读取运行集失败: ${args.runsFile}（${err.code ?? err.message}）`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`运行集不是合法 JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('运行集必须是 { 样本ID: [jobId, ...] } 对象');
  }
  for (const [sampleId, jobIds] of Object.entries(parsed)) {
    if (!Array.isArray(jobIds) || jobIds.length === 0 || jobIds.some((id) => typeof id !== 'string')) {
      throw new Error(`${sampleId}: jobId 列表必须是非空字符串数组`);
    }
    if (new Set(jobIds).size !== jobIds.length) throw new Error(`${sampleId}: jobId 重复`);
  }
  const missing = Object.keys(DEFAULT_RUNS).filter((id) => !(id in parsed));
  if (missing.length) console.warn(`[baseline] 外部运行集未包含样本: ${missing.join(', ')}（本次只统计给定样本）`);
  RUNS = parsed;
  for (const [sampleId, jobIds] of Object.entries(RUNS)) {
    if (!fs.existsSync(path.join('scripts', 'eval', 'samples', sampleId, 'gold.json'))) {
      throw new Error(`${sampleId}: 缺少 gold.json`);
    }
    for (const jobId of jobIds) {
      if (!db.prepare('SELECT 1 FROM jobs WHERE id=?').get(jobId)) throw new Error(`${sampleId}: job 不存在 ${jobId}`);
    }
  }
}

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
if (customRuns) report.runsSource = 'custom';

for (const [sampleId, jobIds] of Object.entries(RUNS)) {
  const dir = path.join('scripts', 'eval', 'samples', sampleId);
  const goldPath = path.join(dir, 'gold.json');
  const draftPath = path.join(dir, 'annotation.draft.json');
  const goldFile = fs.existsSync(goldPath) ? goldPath : draftPath;
  if (!fs.existsSync(goldPath)) {
    // 拿草案当参考等于「用未抽检的标注算准确率」，必须在输出里显式提示，
    // 否则同一张表会混着 reviewed 与 unreviewed 两种口径。
    console.warn(`[baseline] ${sampleId}: 缺少 gold.json，回退 annotation.draft.json（准确率仅供参考，非 official）`);
  }
  const draft = JSON.parse(fs.readFileSync(goldFile, 'utf8'));
  const goldJobId = draft.meta?.provenance?.jobId ?? null;
  // 覆盖门禁：金标注有场景的章，运行是否切出了场景。
  // 为什么单列：P2 F1 只按 pred 数量算分母，整章丢失会让 pred 变少、precision 反而升高，
  // 分数看不出「内容缺了一块」，必须把覆盖率与召回拆出来看。
  const goldChapters = [...new Set((draft.scenes ?? []).map((s) => s.chapterIndex))].sort((a, b) => a - b);
  const runs = jobIds.map((jobId, i) => {
    const { chapters, st } = load(jobId);
    const pred = extractPrediction(st);
    const p1 = scorePhase1(draft.characters, pred.characters);
    const p2 = scorePhase2(draft.scenes, pred.scenes);
    const tr = scoreTraceability(pred.phase3Scenes, chapters);
    const predChapters = new Set(pred.scenes.map((s) => s.chapterIndex));
    const emptyChapters = goldChapters.filter((ch) => !predChapters.has(ch));
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
      p2Recall: p2.recall,
      p2Matched: p2.matched,
      p2Pred: p2.predCount,
      coveredChapters: goldChapters.filter((ch) => predChapters.has(ch)).length,
      emptyChapters,
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
    p2Recall: { mean: mean(runs.map((r) => r.p2Recall)), sd: sd(runs.map((r) => r.p2Recall)) },
    coverage: { mean: mean(runs.map((r) => r.coveredChapters)), sd: sd(runs.map((r) => r.coveredChapters)) },
    goldChapterCount: goldChapters.length,
    runsWithEmptyChapters: runs.filter((r) => r.emptyChapters.length > 0).length,
    runCount: runs.length,
    scoredRuns: scored.length,
    scenesPerChapter: Number((mean(runs.map((r) => r.scenes / r.chapters)) ?? 0).toFixed(2)),
  };

  report.samples.push({ sampleId, runs, agg });
}

db.close();
fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const fileStamp = customRuns ? `${stamp}-custom` : stamp;
fs.writeFileSync(path.join(OUT_DIR, `baseline-${fileStamp}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');

// ── Markdown ──
const fmt = (m) => (m === null || m === undefined ? '—' : m);
const runCounts = Object.values(RUNS).map((ids) => ids.length);
const runSpan = `${Math.min(...runCounts)}–${Math.max(...runCounts)}`;
const runSummary = customRuns ? `外部运行集（每样本 ${runSpan} 次）` : `每样本 ${runSpan} 次`;
const lines = [];
lines.push(`# 基线（${stamp}）· 默认 auto（长文 mapreduce / 短文 truncate）· ${runSummary}`);
lines.push('');
lines.push('> 「跨运行」= 剔除自证运行后，其余运行与金标注的一致性（衡量稳定性）。');
lines.push('> 「准确率」= 对**人工抽检后**的金标注（仅 reviewed=true 且非自证的运行计入）。');
lines.push('');
lines.push('| 样本 | 金标注 | 场景数 | 场景/章 | 角色数 | 溯源 | judge | 跨运行 P1 F1 | 跨运行 P2 F1 | 准确率 P1 F1 | 准确率 P2 F1 | 覆盖章 | 空章运行 | P2 召回 |');
lines.push('|------|--------|--------|---------|--------|------|-------|--------------|--------------|--------------|--------------|--------|----------|---------|');
for (const s of report.samples) {
  const a = s.agg;
  lines.push(
    `| ${s.sampleId} | ${a.goldFile}${a.reviewed ? ' ✓' : ''} | ${a.scenes.mean} ± ${a.scenes.sd} | ${a.scenesPerChapter} | ` +
    `${a.characters.mean} ± ${a.characters.sd} | ${(a.traceability.mean * 100).toFixed(1)}% ± ${(a.traceability.sd * 100).toFixed(1)}% | ` +
    `${a.judge.mean} ± ${a.judge.sd} | ${a.crossRunP1F1.mean} ± ${a.crossRunP1F1.sd} | ${a.crossRunP2F1.mean} ± ${a.crossRunP2F1.sd} | ` +
    `${fmt(a.accuracyP1F1.mean)} | ${fmt(a.accuracyP2F1.mean)} | ${a.coverage.mean}/${a.goldChapterCount} | ` +
    `${a.runsWithEmptyChapters ? `⚠️ ${a.runsWithEmptyChapters}/${a.runCount}` : `0/${a.runCount}`} | ${a.p2Recall.mean} |`,
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
  lines.push('| run | jobId | 场景 | 角色 | 场景内角色 | 溯源 | judge | P1 F1 | P2 F1 | P2 召回 | 覆盖章 | 空章 | 自证 |');
  lines.push('|-----|-------|------|------|-----------|------|-------|-------|-------|---------|--------|------|------|');
  for (const r of s.runs) {
    lines.push(
      `| ${r.run} | \`${r.jobId}\` | ${r.scenes} | ${r.characters} | ${r.charactersInScenes} | ${(r.traceability * 100).toFixed(1)}% | ` +
      `${r.judge ?? '—'} | ${r.agreeP1F1} | ${r.agreeP2F1} | ${r.p2Recall} | ${r.coveredChapters}/${s.agg.goldChapterCount} | ` +
      `${r.emptyChapters.length ? `⚠️ ${r.emptyChapters.map(chapterLabel).join('/')}` : '—'} | ${r.selfAnnotated ? '是（剔除）' : ''} |`,
    );
  }
  lines.push('');
}
lines.push('## 运行覆盖门禁');
lines.push('');
lines.push('> 「空章」= 金标注该章有场景，运行在 Phase2 一个场景都没切出来（整章丢失）。');
lines.push('> P2 F1 的分母随 pred 数量变化，整章丢失会让 precision 升高，因此覆盖/召回必须单列。');
lines.push('> 「覆盖判定 PASS」只表示该章至少切出了场景，不代表边界/内容正确；章节标签 chN(idxM) = 正文第 N 章 / chapterIndex M。');
lines.push('');
lines.push('| 样本 | run | jobId | 覆盖章 | 空章 | 覆盖判定 |');
lines.push('|------|-----|-------|--------|------|----------|');
for (const s of report.samples) {
  for (const r of s.runs) {
    lines.push(
      `| ${s.sampleId} | ${r.run} | \`${r.jobId}\` | ${r.coveredChapters}/${s.agg.goldChapterCount} | ` +
      `${r.emptyChapters.length ? r.emptyChapters.map(chapterLabel).join('/') : '—'} | ${r.emptyChapters.length ? '⚠️ FAIL' : 'PASS'} |`,
    );
  }
}
lines.push('');
fs.writeFileSync(path.join(OUT_DIR, `baseline-${fileStamp}.md`), lines.join('\n') + '\n', 'utf8');

console.log(lines.join('\n'));
console.log(`\n已写入 ${OUT_DIR}/baseline-${fileStamp}.{md,json}`);
