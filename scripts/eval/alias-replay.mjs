#!/usr/bin/env node
/**
 * 别名覆盖离线回放（P1/T2，只读、零 LLM 成本）
 *
 *   node scripts/eval/alias-replay.mjs [--all] [--extended] [--runs-file <runs.json>]
 *
 * 默认口径：baseline.mjs 的 10 次运行（doupo 4 / zhanlan 3 / xiuzhen 3）。
 * 对每个 job：已知名 = phase1Output.characters 的 name ∪ aliases；
 * 未登记出场名 = phase2Output.scenes[].keyCharacterNames 中不在已知名的标签。
 * 然后直接调用产品代码 alias-normalize.ts 的 resolveAliasCandidate（Node 类型剥离导入），
 * 保证回放规则与线上完全一致。
 *
 * 分类：
 *   - 可合并：resolveAliasCandidate 返回唯一候选
 *   - 无法匹配：返回 null（卡里没有这个角色 / 描述词 / 称号）
 *   - 误合并风险：可合并但标签是描述词（男子/妇女/父亲…），或候选是「别名重复登记」
 *
 * --all       扫描库内全部有 phase2 的 job（历史 truncate 期卡片更薄，用来观察规则覆盖率）
 * --extended  反事实估算：先剥掉「们/下属/头目/父亲/…”等后缀再走现有规则，
 *             回答「扩规则还能多合并多少」，并标出其中会变成误合并的条目。
 *             只做估算，不改 alias-normalize.ts。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const DB = 'apps/screenplay/data-test/1b-data.db';
const ALIAS_MODULE = 'apps/screenplay/src/lib/pipeline/alias-normalize.ts';

// 与 baseline.mjs 的 DEFAULT_RUNS 保持一致（改动时两处同步）。
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

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 23 || (major === 23 && minor < 6)) {
  console.error(`需要 Node >= 23.6（默认启用类型剥离）才能导入 ${ALIAS_MODULE}，当前 ${process.versions.node}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { all: false, extended: false, runsFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--all') out.all = true;
    else if (flag === '--extended') out.extended = true;
    else if (flag === '--runs-file') {
      out.runsFile = argv[++i];
      if (!out.runsFile) throw new Error('--runs-file 缺少取值');
    } else throw new Error(`未知参数: ${flag}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const { resolveAliasCandidate } = await import(pathToFileURL(path.resolve(ALIAS_MODULE)).href);
const db = new Database(DB, { readonly: true });

const ROWS = db
  .prepare('SELECT id, created_at, pipeline_state FROM jobs WHERE pipeline_state IS NOT NULL ORDER BY created_at')
  .all();

const sampleOf = new Map();
const runs = args.runsFile ? JSON.parse(fs.readFileSync(args.runsFile, 'utf8')) : DEFAULT_RUNS;
for (const [sampleId, ids] of Object.entries(runs)) for (const id of ids) sampleOf.set(id, sampleId);

const DESCRIPTOR_RE =
  /(男子|女子|少女|老者|夫人|父亲|母亲|妇女|经理|司机|服务员|保镖|下属|海盗|长老|舍友|胖子|瘦猴|病人|护士|男人|女人|老头|女孩|男孩|老板|老师|同学|医生|三位长老)/;
const SUFFIXES = ['的父亲', '的母亲', '父亲', '母亲', '头目', '头子', '下属', '们', '长老', '夫人'];

function knownNames(characters) {
  const known = new Set();
  for (const c of characters) {
    if (c.name) known.add(c.name);
    for (const a of c.aliases ?? []) known.add(a);
  }
  return known;
}

function matchReason(tag, characters, cand) {
  if (!cand) return null;
  const targets = [];
  for (const c of characters) {
    targets.push({ name: c.name, kind: 'name' });
    for (const a of c.aliases ?? []) targets.push({ name: a, kind: 'alias' });
  }
  const hit = targets.find((t) => t.name === cand && t.name.startsWith(tag) && t.name.length > tag.length);
  if (hit) return `简称→${hit.kind === 'name' ? '角色名' : '别名'}前缀`;
  return '同长同首字·一字差';
}

function aliasCollisions(characters) {
  const owners = new Map();
  for (const c of characters) {
    for (const a of c.aliases ?? []) {
      const list = owners.get(a) ?? [];
      if (!list.includes(c.name)) list.push(c.name);
      owners.set(a, list);
    }
  }
  return [...owners.entries()].filter(([, ownersOfAlias]) => ownersOfAlias.length > 1);
}

function analyzeJob(row) {
  let st;
  try {
    st = JSON.parse(row.pipeline_state);
  } catch {
    return null;
  }
  if (!st.phase2Output?.scenes || !st.phase1Output?.characters) return null;
  const characters = st.phase1Output.characters;
  const known = knownNames(characters);
  const canonical = new Set(characters.map((c) => c.name));

  const unknown = new Map();
  const aliasOnly = new Map();
  let tags = 0;
  for (const s of st.phase2Output.scenes) {
    for (const name of s.keyCharacterNames ?? []) {
      tags += 1;
      if (!known.has(name)) {
        const cur = unknown.get(name) ?? { count: 0, chapter: s.chapterIndex, slug: s.draftSlugline };
        cur.count += 1;
        unknown.set(name, cur);
      } else if (!canonical.has(name)) {
        aliasOnly.set(name, (aliasOnly.get(name) ?? 0) + 1);
      }
    }
  }
  const details = [...unknown.entries()].map(([tag, meta]) => {
    const cand = resolveAliasCandidate(tag, characters);
    const reason = matchReason(tag, characters, cand);
    const risk = cand ? (DESCRIPTOR_RE.test(tag) ? '描述词被并入具体角色' : null) : null;
    return { tag, ...meta, cand, reason, risk };
  });
  return {
    id: row.id,
    sample: sampleOf.get(row.id) ?? '（历史未登记）',
    created_at: row.created_at,
    scenes: st.phase2Output.scenes.length,
    tags,
    uniqueTags: new Set(st.phase2Output.scenes.flatMap((s) => s.keyCharacterNames ?? [])).size,
    unknown: details,
    aliasOnly: [...aliasOnly.entries()].map(([tag, count]) => ({ tag, count })),
    collisions: aliasCollisions(characters),
    characters,
  };
}

const jobs = (args.all ? ROWS : ROWS.filter((r) => sampleOf.has(r.id))).map(analyzeJob).filter(Boolean);

const buckets = { mergeable: [], unmatched: [], risk: [] };
for (const j of jobs) {
  for (const d of j.unknown) {
    const item = { job: j.id, sample: j.sample, ...d };
    if (d.risk) buckets.risk.push(item);
    else if (d.cand) buckets.mergeable.push(item);
    else buckets.unmatched.push(item);
  }
}

const sum = (xs) => xs.reduce((s, x) => s + x.count, 0);
const uniq = (xs) => new Set(xs.map((x) => x.tag)).size;
const lines = [];
lines.push(`# 别名覆盖离线回放${args.all ? '（全库）' : '（baseline 10 次运行）'}`);
lines.push('');
lines.push(
  `口径：已知名 = phase1 角色卡 name ∪ aliases；规则 = 产品代码 ${ALIAS_MODULE} 的 resolveAliasCandidate（原样导入，未复制）。`,
);
lines.push(`数据库：${DB}（只读）。job 数：${jobs.length}。`);
lines.push('');
lines.push('| job | 样本 | 场景 | 出场名次数 | 去重名 | 未登记(种) | 可合并(种/次) | 无法匹配(种/次) | 风险(种/次) |');
lines.push('|-----|------|------|-----------|--------|-----------|---------------|-----------------|------------|');
for (const j of jobs) {
  const m = j.unknown.filter((d) => d.cand && !d.risk);
  const u = j.unknown.filter((d) => !d.cand);
  const r = j.unknown.filter((d) => d.risk);
  lines.push(
    `| \`${j.id}\` | ${j.sample} | ${j.scenes} | ${j.tags} | ${j.uniqueTags} | ${j.unknown.length} | ` +
      `${uniq(m)}/${sum(m)} | ${uniq(u)}/${sum(u)} | ${uniq(r)}/${sum(r)} |`,
  );
}
lines.push('');
lines.push('## 合计');
lines.push('');
lines.push(
  `- 未登记标签去重 **${uniq([...buckets.mergeable, ...buckets.unmatched, ...buckets.risk])}** 种、出现 **${sum([
    ...buckets.mergeable,
    ...buckets.unmatched,
    ...buckets.risk,
  ])}** 次`,
);
lines.push(`- 可合并：**${uniq(buckets.mergeable)}** 种 / ${sum(buckets.mergeable)} 次`);
lines.push(`- 无法匹配：**${uniq(buckets.unmatched)}** 种 / ${sum(buckets.unmatched)} 次`);
lines.push(`- 误合并风险：**${uniq(buckets.risk)}** 种 / ${sum(buckets.risk)} 次`);
lines.push('');

const detail = (title, items) => {
  lines.push(`### ${title}`);
  lines.push('');
  if (!items.length) {
    lines.push('（无）');
    lines.push('');
    return;
  }
  lines.push('| 样本 | job | 章节 | 未登记名 | 次数 | 候选 | 命中原因 | 风险 |');
  lines.push('|------|-----|------|----------|------|------|----------|------|');
  for (const d of items.sort((a, b) => b.count - a.count)) {
    lines.push(
      `| ${d.sample} | \`${d.job.slice(-6)}\` | ch${d.chapter + 1}(idx${d.chapter}) | ${d.tag} | ${d.count} | ` +
        `${d.cand ?? '—'} | ${d.reason ?? '—'} | ${d.risk ?? '—'} |`,
    );
  }
  lines.push('');
};
const aggregateByTag = (title, items) => {
  lines.push(`### ${title}（按标签汇总）`);
  lines.push('');
  if (!items.length) {
    lines.push('（无）');
    lines.push('');
    return;
  }
  const agg = new Map();
  for (const d of items) {
    const cur = agg.get(d.tag) ?? { count: 0, jobs: new Set(), cand: d.cand, chapter: d.chapter };
    cur.count += d.count;
    cur.jobs.add(d.job);
    agg.set(d.tag, cur);
  }
  lines.push('| 未登记名 | 出现次数 | 覆盖 job 数 | 候选 | 示例章节 |');
  lines.push('|----------|----------|-------------|------|----------|');
  for (const [tag, v] of [...agg.entries()].sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`| ${tag} | ${v.count} | ${v.jobs.size} | ${v.cand ?? '—'} | ch${v.chapter + 1}(idx${v.chapter}) |`);
  }
  lines.push('');
};
detail('可合并', buckets.mergeable);
if (args.all) aggregateByTag('无法匹配', buckets.unmatched);
else detail('无法匹配', buckets.unmatched);
detail('误合并风险', buckets.risk);

const aliasOnlyRows = jobs.flatMap((j) => j.aliasOnly.map((a) => ({ sample: j.sample, job: j.id, ...a })));
lines.push('### 已登记别名但未归一（展示层一致性，不属于未登记）');
lines.push('');
if (!aliasOnlyRows.length) lines.push('（无）');
else {
  lines.push('| 样本 | job | 标签 | 次数 | 说明 |');
  lines.push('|------|-----|------|------|------|');
  for (const a of aliasOnlyRows.sort((x, y) => y.count - x.count)) {
    lines.push(`| ${a.sample} | \`${a.job.slice(-6)}\` | ${a.tag} | ${a.count} | 已在别名表，本次规则不触发 |`);
  }
}
lines.push('');

lines.push('### 别名重复登记（同一别名挂到多个角色，任何归一规则都必须避让）');
lines.push('');
const collisions = jobs.flatMap((j) => j.collisions.map(([alias, owners]) => ({ job: j.id, sample: j.sample, alias, owners })));
if (!collisions.length) lines.push('（无）');
else {
  lines.push('| 样本 | job | 别名 | 角色 |');
  lines.push('|------|-----|------|------|');
  for (const c of collisions) lines.push(`| ${c.sample} | \`${c.job.slice(-6)}\` | ${c.alias} | ${c.owners.join(' / ')} |`);
}
lines.push('');

if (args.extended) {
  lines.push('## 反事实：扩规则估算（剥后缀后重跑现有规则）');
  lines.push('');
  const gains = [];
  const newRisks = [];
  for (const d of buckets.unmatched) {
    const suffix = SUFFIXES.find((s) => d.tag.length > s.length && d.tag.endsWith(s));
    if (!suffix) continue;
    const base = d.tag.slice(0, -suffix.length);
    const job = jobs.find((j) => j.id === d.job);
    const cand = resolveAliasCandidate(base, job.characters);
    if (!cand) continue;
    const item = { ...d, base, cand, suffix, risk: DESCRIPTOR_RE.test(base) ? '剥后缀后变成描述词' : null };
    if (item.risk) newRisks.push(item);
    else gains.push(item);
  }
  lines.push(`- 可多合并：**${uniq(gains)}** 种 / ${sum(gains)} 次`);
  lines.push(`- 新增误合并风险：**${uniq(newRisks)}** 种 / ${sum(newRisks)} 次`);
  lines.push('');
  for (const g of gains) lines.push(`- ${g.sample} ch${g.chapter + 1}(idx${g.chapter}) ${g.tag} --剥「${g.suffix}」→ ${g.base} → ${g.cand}`);
  for (const r of newRisks) lines.push(`- ⚠️ ${r.sample} ${r.tag} --剥「${r.suffix}」→ ${r.base} → ${r.cand}（${r.risk}）`);
  lines.push('');
}

db.close();
console.log(lines.join('\n'));
