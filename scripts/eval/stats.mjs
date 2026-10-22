/**
 * 统计量唯一出口：输入 jobId，输出 P2 的 mean±σ、Welch t/df/p、
 * 精确枚举 bootstrap 95% CI、P(Δ<x)。只读库，不花钱。
 *
 * 为什么需要：文档里的 t/df/p/CI 曾多次因手工回代或舍入出不一致；
 * 这里与 baseline.mjs 共用 annotation.mjs 的 scorePhase2，数字只允许从这里复制。
 *
 * 用法：
 *   node scripts/eval/stats.mjs --sample doupo-short \
 *     --old job_a,job_b,job_c --new job_d,job_e,job_f,job_g --delta -0.02
 *   可选：--db-dir apps/screenplay/data-test --db-file 1b-data.db --json
 *   自检：node scripts/eval/stats.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { extractPrediction, scorePhase2 } from './annotation.mjs';

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

const lgamma = (z) => {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
};

const tPdf = (x, nu) => {
  const lc = lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI);
  return Math.exp(lc - ((nu + 1) / 2) * Math.log(1 + x * x / nu));
};

function simpson(f, a, b, n) {
  if (n % 2) n++;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** 双侧 p；用数值积分而非不完整 Beta，避免实现误差。 */
const tTwoSidedP = (t, nu) => {
  const half = simpson((x) => tPdf(x, nu), 0, Math.abs(t), 200000);
  return 2 * (0.5 - half);
};

const args = parseArgs(process.argv.slice(2));
if (args['self-test']) {
  const checks = [[2, 10, 0.0734], [2.228, 10, 0.05], [1, 1, 0.5]];
  for (const [t, nu, expected] of checks) {
    const got = tTwoSidedP(t, nu);
    if (Math.abs(got - expected) > 1e-4) {
      console.error(`self-test FAIL: t=${t} df=${nu} got=${got} expected=${expected}`);
      process.exit(1);
    }
  }
  console.log('self-test PASS');
  process.exit(0);
}

if (!args.sample || !args.old || !args.new) {
  console.error('用法: node scripts/eval/stats.mjs --sample <id> --old job_a,job_b --new job_c,job_d [--delta -0.02] [--db-dir ...] [--db-file ...] [--json]');
  process.exit(1);
}

const goldPath = path.join(ROOT, 'scripts/eval/samples', args.sample, 'gold.json');
if (!fs.existsSync(goldPath)) {
  console.error(`[stats] 缺 ${args.sample} 的金标注（gold.json）`);
  process.exit(1);
}
const gold = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
const db = new Database(
  path.join(ROOT, args['db-dir'] ?? 'apps/screenplay/data-test', args['db-file'] ?? '1b-data.db'),
  { readonly: true },
);

function loadP2(jobIds) {
  return String(jobIds).split(',').map((s) => s.trim()).filter(Boolean).map((jobId) => {
    const row = db.prepare('SELECT pipeline_state FROM jobs WHERE id=?').get(jobId);
    if (!row) throw new Error(`job 不存在: ${jobId}`);
    const st = JSON.parse(row.pipeline_state);
    const pred = extractPrediction(st);
    return scorePhase2(gold.scenes, pred.scenes).f1;
  });
}

const mean = (xs) => xs.reduce((s, n) => s + n, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, n) => s + (n - m) ** 2, 0) / (xs.length - 1));
};

/** 全枚举有序重采样，无随机种子；n 大时总数会爆炸，这里限制在 200 万组。 */
function resampleMeans(xs) {
  const out = [];
  for (let k = 0; k < xs.length ** xs.length; k++) {
    let x = k;
    let sum = 0;
    for (let i = 0; i < xs.length; i++) {
      sum += xs[x % xs.length];
      x = Math.floor(x / xs.length);
    }
    out.push(sum / xs.length);
  }
  return out;
}

const oldVals = loadP2(args.old);
const newVals = loadP2(args.new);
db.close();
if (oldVals.length < 2 || newVals.length < 2) {
  console.error('[stats] 每组至少 2 个 job');
  process.exit(1);
}

const mOld = mean(oldVals);
const mNew = mean(newVals);
const sOld = sd(oldVals);
const sNew = sd(newVals);
const diff = mNew - mOld;
const se = Math.sqrt((sOld ** 2) / oldVals.length + (sNew ** 2) / newVals.length);
const df = se ** 4 / (
  (sOld ** 2 / oldVals.length) ** 2 / (oldVals.length - 1) +
  (sNew ** 2 / newVals.length) ** 2 / (newVals.length - 1)
);
const t = diff / se;
const p = tTwoSidedP(t, df);

const oldRes = resampleMeans(oldVals);
const newRes = resampleMeans(newVals);
const total = oldRes.length * newRes.length;
if (total > 2_000_000) {
  console.error(`[stats] 精确枚举 ${total} 组过大；请减少 job 数`);
  process.exit(1);
}
const diffs = [];
for (const o of oldRes) for (const n of newRes) diffs.push(n - o);
diffs.sort((a, b) => a - b);
const quantile = (q) => {
  const pos = (diffs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return diffs[lo] + (diffs[hi] - diffs[lo]) * (pos - lo);
};
const threshold = Number(args.delta ?? -0.02);
const f4 = (n) => n.toFixed(4);

const result = {
  sample: args.sample,
  old: { jobIds: String(args.old).split(','), n: oldVals.length, p2: oldVals, mean: mOld, sd: sOld },
  new: { jobIds: String(args.new).split(','), n: newVals.length, p2: newVals, mean: mNew, sd: sNew },
  diff,
  welch: { t, df, p },
  bootstrap: {
    method: 'exact-enumeration',
    combinations: total,
    ci95: [quantile(0.025), quantile(0.975)],
    pDeltaBelowZero: diffs.filter((d) => d < 0).length / total,
    threshold,
    pDeltaBelowThreshold: diffs.filter((d) => d < threshold).length / total,
  },
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`\n样本 ${args.sample}（金标注 ${gold.scenes.length} 场景）`);
  console.log(`旧组 n=${oldVals.length}: ${oldVals.map(f4).join(', ')} ｜ mean ${f4(mOld)} sd ${f4(sOld)}`);
  console.log(`新组 n=${newVals.length}: ${newVals.map(f4).join(', ')} ｜ mean ${f4(mNew)} sd ${f4(sNew)}`);
  console.log(`差值(new-old): ${f4(diff)}`);
  console.log(`Welch: t=${f4(t)} df=${f4(df)} 双侧 p=${f4(p)}`);
  console.log(`精确枚举 ${total} 组 bootstrap 95% CI [${f4(result.bootstrap.ci95[0])}, ${f4(result.bootstrap.ci95[1])}]`);
  console.log(`P(Δ<0)=${f4(result.bootstrap.pDeltaBelowZero)}  P(Δ<${threshold})=${f4(result.bootstrap.pDeltaBelowThreshold)}`);
}
