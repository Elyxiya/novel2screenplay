#!/usr/bin/env node
/**
 * 冻结金标注（P2）
 *
 *   node scripts/eval/freeze.mjs --sample xiuzhen-short [--allow-unreviewed] [--reviewed <file>]
 *
 * 输入：annotation.reviewed.json（人工抽检后的草案；默认要求 reviewed=true）
 * 输出：annotation.json（金标注，含 split）+ samples/manifest.json（语料清单）
 *
 * 「冻结」= 校验 + 定稿 + 确定性切分。之后评分只认 annotation.json，
 * 避免「边改标注边看分数」把评测变成调参。
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOLD_SCHEMA, splitFor, validateGold } from './annotation.mjs';

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
const sampleId = args.sample;
if (!sampleId) {
  console.error('用法: node scripts/eval/freeze.mjs --sample <id> [--allow-unreviewed] [--reviewed <file>]');
  process.exit(1);
}

const dir = path.join(SAMPLES_DIR, sampleId);
const candidates = [
  ...(args.reviewed ? [path.resolve(ROOT, args.reviewed)] : []),
  path.join(dir, 'annotation.reviewed.json'),
  path.join(dir, 'annotation.draft.json'),
].filter((p) => existsSync(p) && statSync(p).isFile());

if (candidates.length === 0) {
  console.error(`找不到标注文件：${path.relative(ROOT, dir)}/{annotation.reviewed.json|annotation.draft.json}`);
  process.exit(1);
}

const sourcePath = candidates[0];
const annotation = JSON.parse(readFileSync(sourcePath, 'utf8'));

if (!annotation.meta?.reviewed && !args['allow-unreviewed']) {
  console.error(`标注尚未抽检（${path.relative(ROOT, sourcePath)} 的 meta.reviewed=false）。`);
  console.error('请先完成抽检；确需先冻结可加 --allow-unreviewed（该样本不计入正式分数）。');
  process.exit(1);
}

const gold = {
  ...annotation,
  schema: GOLD_SCHEMA,
  meta: {
    ...annotation.meta,
    reviewed: Boolean(annotation.meta?.reviewed),
    split: splitFor(sampleId),
    frozenAt: new Date().toISOString(),
    frozenFrom: path.relative(ROOT, sourcePath),
  },
};

const { ok, errors, warnings } = validateGold(gold);
for (const w of warnings) console.warn(`  ! ${w}`);
if (!ok) {
  console.error('校验失败，未冻结：');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// 输出 gold.json：刻意不复用 annotation.json —— 历史样本已有同名的 identity-annotation/v1 文件，
// 同名会直接把旧标注覆盖掉（本轮实测踩过）。
const outPath = path.join(dir, 'gold.json');
writeFileSync(outPath, `${JSON.stringify(gold, null, 2)}\n`, 'utf8');

// 重建语料清单（只收 screenplay-gold/v1 的 gold.json；
// 历史 identity-annotation/v1 的同名 annotation.json 属于另一套口径，且文件名不能复用）
const entries = readdirSync(SAMPLES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    const p = path.join(SAMPLES_DIR, d.name, 'gold.json');
    if (!existsSync(p)) return null;
    const g = JSON.parse(readFileSync(p, 'utf8'));
    if (g.schema !== GOLD_SCHEMA) return null;
    return {
      sampleId: g.sampleId,
      title: g.title ?? g.sampleId,
      chapterCount: g.meta?.chapterCount ?? null,
      reviewed: Boolean(g.meta?.reviewed),
      split: g.meta?.split ?? splitFor(g.sampleId),
      characters: (g.characters ?? []).length,
      scenes: (g.scenes ?? []).length,
      provenance: g.meta?.provenance?.source ?? 'unknown',
    };
  })
  .filter(Boolean)
  .sort((a, b) => String(a.sampleId).localeCompare(String(b.sampleId)));

const manifest = {
  schema: 'eval-corpus/v1',
  generatedAt: new Date().toISOString(),
  total: entries.length,
  train: entries.filter((e) => e.split === 'train').length,
  holdout: entries.filter((e) => e.split === 'holdout').length,
  reviewed: entries.filter((e) => e.reviewed).length,
  samples: entries,
};
const manifestPath = path.join(SAMPLES_DIR, 'manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`[freeze] ${sampleId} → ${path.relative(ROOT, outPath)}`);
console.log(`  split=${gold.meta.split} ｜ reviewed=${gold.meta.reviewed} ｜ 角色 ${(gold.characters ?? []).length} ｜ 场景 ${(gold.scenes ?? []).length}`);
console.log(`[manifest] ${manifest.total} 个样本（train ${manifest.train} / holdout ${manifest.holdout}，已抽检 ${manifest.reviewed}）→ ${path.relative(ROOT, manifestPath)}`);
