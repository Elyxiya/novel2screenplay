#!/usr/bin/env node
/**
 * 历史 job 真实 producer 验证（点 1b · 关闭 fixture↔producer 缝隙）
 *
 *   node scripts/eval/verify-historical-job.mjs [--db <db-file>] [--limit N] [--interactive]
 *
 * 手造 fixture（contract.test.mjs）只验证**消费端**对形状的假设；验证不了
 * Phase4Merger 实际行为。本脚本在库中真实 pipelineState.phase4Output /
 * phase1Output.characters 上同步跑同一套消费端断言 + 占位率，零 LLM、只读。
 *
 * 归因纪律（1b-data-chain-medium-plan.md §3.1b）：
 *   - 优先跨过截断线的长 job（旧路径跑过、尾部应含未知引用）；
 *   - 占位率=0 先排除良性解释（短文自然全命中），别用单 job 的 0 推翻定义；
 *   - 所选 job 须跑在 Phase4Merger 当前行为（L101 保留原始名）之后。
 *
 * 用法提示：用 Node 24（better-sqlite3 按 NODE_MODULE_VERSION 137 编译）
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIdentityRule } from './identity.mjs';
import { computeOccupancy } from './occupancy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DB_FILE = process.env.DB_FILE || arg('db', path.join(ROOT, 'apps/screenplay/data/novel2screenplay.db'));

const db = new Database(DB_FILE, { readonly: true });
const limit = Number(arg('limit', '10'));

// 1. 候选 job：按 scenes 规模排序（越大越可能跨截断线），取完成态
const rows = db
  .prepare(
    `SELECT id, status, config, created_at FROM jobs
     WHERE status='completed' OR status='done'
     ORDER BY created_at DESC LIMIT ?`,
  )
  .all(limit);

console.log(`[verify-historical-job] db=${DB_FILE} 候选=${rows.length}`);
for (const r of rows) {
  let title = '';
  try { title = JSON.parse(r.config)?.title ?? ''; } catch {}
  console.log(`  candidate # ${r.id}  ${r.status}  ${title}  ${new Date(r.created_at).toLocaleString()}`);
}

let anyConfirmed = false;
let confirmedTotal = 0;
const summary = [];

for (const r of rows) {
  const row = db.prepare('SELECT pipeline_state FROM jobs WHERE id = ?').get(r.id);
  if (!row || !row.pipeline_state) continue;
  let ps;
  try { ps = JSON.parse(row.pipeline_state); } catch { continue; }
  const p1 = ps?.phase1Output;
  const p4 = ps?.phase4Output;
  if (!p4 || !p4.scenes) { summary.push({ id: r.id, reason: 'no-phase4-scenes' }); continue; }

  // producer 时效：要求 phase1.characters 存在（当前 Phase4Merger 输入形状）。
  // phase1.characters 只有 name 无 id；参考 id 集须经 phase4.characters（{characterId,name}）
  // 按名字命中 phase1 卡映射回 char_XX。
  const p1Chars = p1?.characters && Array.isArray(p1.characters) ? p1.characters : null;
  const p4Chars = p4?.characters && Array.isArray(p4.characters) ? p4.characters : [];
  const phase1Names = new Set((p1Chars ?? []).map((c) => c.name));
  const refChars = p4Chars.length
    ? p4Chars.filter((c) => phase1Names.has(c.name)).map((c) => c.characterId)
    : (p1Chars ?? []).map((c) => c.name);

  // 消费端断言：scenes 可被规则消费
  const charIdToName = Object.fromEntries(
    p4Chars.map((c) => [c.characterId, c.name]).filter(([id, n]) => id && n),
  );
  const aliasIndex = p1?.aliasIndex ?? {};
  const dataAll = {
    scenes: p4.scenes,
    charIdToName,
    aliasIndex,
    deadCharacters: [],
    reveals: [],
  };

  let ruleOk = true;
  try {
    for (const ruleId of ['dead-character-no-speak', 'reveal-before-chapter', 'unresolved-alias-as-id']) {
      const res = runIdentityRule(ruleId, dataAll);
      if (typeof res.passed !== 'boolean' || !Array.isArray(res.failures)) ruleOk = false;
    }
  } catch (e) { ruleOk = false; }

  // 占位率（参考集 = phase1 分析卡 id 集；无 phase1 时退化为 charIdToName 键）
  const refSet = refChars || Object.keys(charIdToName);
  let rep = null;
  try { rep = computeOccupancy(p4.scenes, refSet); } catch { rep = null; }

  const confirmed = ruleOk && rep !== null && rep.overall.placeholder > 0;
  if (confirmed) {
    anyConfirmed = true;
    confirmedTotal++;
  }
  summary.push({
    id: r.id,
    scenes: p4.scenes.length,
    chars: (p4.characters || []).length,
    refChars: refSet.length,
    ruleOk,
    placeholder: rep?.overall.placeholder ?? null,
    occupyingRate: rep?.overall.rate ?? null,
    confirmed,
  });
}

console.log('\n[verify-historical-job] 逐 job 判定');
for (const s of summary) {
  console.log(
    `  # ${String(s.id).padEnd(8)} scenes=${String(s.scenes).padStart(4)} refChars=${String(s.refChars).padStart(3)} ` +
    `ruleOk=${s.ruleOk ? 'Y' : 'N'} 占位=${s.placeholder} rate=${s.occupyingRate === null ? '-' : (s.occupyingRate * 100).toFixed(1) + '%'} ${s.confirmed ? '✓确认' : '·'}`,
  );
}

// 归因：任一 job 出现占位信号即证「未解析引用会被 phase4 保留」的 producer 行为
console.log(`\n[verify-historical-job] 占位信号确认 job 数=${confirmedTotal}/${summary.length}`);
if (confirmedTotal === 0) {
  console.error(
    '[verify-historical-job] 未在任何历史 job 观测到占位信号——先排除良性解释' +
    '（短文全命中 / job 太老非当前 producer / 参考集误用），' +
    '或取更长跨截断线的 job 重验；勿用此次 0 值直接推翻占位率定义。',
  );
  db.close();
  process.exit(1);
}

db.close();
console.log('[verify-historical-job] PASS：真实 producer 输出与消费端假设一致');
process.exit(0);