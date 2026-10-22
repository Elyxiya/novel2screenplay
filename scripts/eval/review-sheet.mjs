#!/usr/bin/env node
/**
 * 抽检审阅单（P2）
 *
 *   node scripts/eval/review-sheet.mjs --sample xiuzhen-short [--draft <file>] [--stdout]
 *
 * --stdout：只把内容写到标准输出、不落盘。snapshot.mjs 走这条路径——
 * 否则「生成快照」会顺手改写被跟踪的 samples/<id>/review.md，工作区无故变脏。
 *
 * 输入：annotation.draft.json（LLM 预标）
 * 输出：samples/<id>/review.md —— 人类只需按清单快速核对，不必通读整篇
 *
 * 抽检的目标不是「重标一遍」，而是用最小成本发现系统性错误：
 * 漏章、过切、漏人、别名没合并、角色卡与场景矛盾。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aliasSetOf, chapterLabel, normalizeName } from './annotation.mjs';
import { splitChapters } from './convert-driver.mjs';

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
  console.error('用法: node scripts/eval/review-sheet.mjs --sample <id> [--draft <file>] [--stdout]');
  process.exit(1);
}

const draftPath = path.resolve(ROOT, args.draft ?? path.join(SAMPLES_DIR, sampleId, 'annotation.draft.json'));
// gold.json 存在却仍默认读草案：会让「审查结果」与「冻结金标注」脱节，必须提示。
if (!args.draft && existsSync(path.join(SAMPLES_DIR, sampleId, 'gold.json'))) {
  console.warn(`[review-sheet] ${sampleId}: 已有 gold.json，但默认仍读草案；审查金标注请传 --draft scripts/eval/samples/${sampleId}/gold.json`);
}
const draft = JSON.parse(readFileSync(draftPath, 'utf8'));
const chapters = splitChapters(readFileSync(path.join(SAMPLES_DIR, sampleId, 'chapters.txt'), 'utf8'));

const scenesByChapter = new Map();
for (const s of draft.scenes ?? []) {
  const list = scenesByChapter.get(s.chapterIndex) ?? [];
  list.push(s);
  scenesByChapter.set(s.chapterIndex, list);
}

const missingChapters = chapters.map((_, i) => i).filter((i) => !scenesByChapter.has(i));
const tinyScenes = (draft.scenes ?? []).filter((s) => s.endParagraph - s.startParagraph <= 0);
/**
 * 场景涉及的角色 = 实际在场（keyCharacterNames）+ 对话/背景提及（mentionedCharacterNames）
 * + 场景级指代（characterRefs 的 name）。
 */
const namesOfScene = (s) => [
  ...(s.keyCharacterNames ?? []),
  ...(s.mentionedCharacterNames ?? []),
  ...(s.characterRefs ?? []).map((r) => r?.name).filter(Boolean),
];
const orphanCharacters = (draft.characters ?? []).filter((c) => {
  const names = aliasSetOf(c);
  return !(draft.scenes ?? []).some((s) => namesOfScene(s).some((n) => names.has(normalizeName(n))));
});
const noAlias = (draft.characters ?? []).filter((c) => (c.aliases ?? []).length === 0);

// 反向体检：场景里出现、但角色卡未登记的名字（潜在漏抽）
// 为什么必须有：正向只查「角色卡里的人是否出现在场景」，抓不到模型在场景里临时造的名字。
const registered = new Set();
for (const c of draft.characters ?? []) for (const a of aliasSetOf(c)) registered.add(a);
const unknownNames = new Map(); // 原始名 -> Set<chapterIndex(0-based)>，打印时统一走 chapterLabel
for (const s of draft.scenes ?? []) {
  for (const raw of namesOfScene(s)) {
    const norm = normalizeName(raw);
    if (!norm || registered.has(norm)) continue;
    const set = unknownNames.get(raw) ?? new Set();
    set.add(s.chapterIndex);
    unknownNames.set(raw, set);
  }
}

const lines = [];
lines.push(`# 抽检审阅单 · ${sampleId}`);
lines.push('');
lines.push(`> 草案：\`${path.relative(ROOT, draftPath)}\` ｜ 章节 ${chapters.length} ｜ 角色 ${(draft.characters ?? []).length} ｜ 场景 ${(draft.scenes ?? []).length}`);
lines.push(`> 预标来源：${draft.meta?.provenance?.modelId ?? '未知'}（job ${draft.meta?.provenance?.jobId ?? '—'}）`);
lines.push('');
lines.push('## 怎么用（约 5–10 分钟）');
lines.push('');
lines.push('1. 先看下面「自动体检」：红色项优先核对，通常能抓到多数系统性错误。');
lines.push('2. 再抽 2–3 章，对照原文看角色名单与场景边界是否合理。');
lines.push('3. 直接改草案 JSON，改完把 `meta.reviewed` 置为 `true`、填 `meta.reviewedBy`，另存为 `annotation.reviewed.json`。');
lines.push('4. 运行 `node scripts/eval/freeze.mjs --sample ' + sampleId + '` 冻结为金标注。');
lines.push('');
lines.push('## 自动体检');
lines.push('');
lines.push(`- [ ] **未切出场景的章节**：${missingChapters.length === 0 ? '无' : missingChapters.map((i) => `${chapterLabel(i)} ${chapters[i].title}`).join('、')}`);
lines.push(`- [ ] **疑似过切（单段落场景）**：${tinyScenes.length === 0 ? '无' : tinyScenes.map((s) => `${chapterLabel(s.chapterIndex)}:${s.startParagraph}-${s.endParagraph}`).join('、')}`);
lines.push(`- [ ] **未在任何场景出现的角色**：${orphanCharacters.length === 0 ? '无' : orphanCharacters.map((c) => c.name).join('、')}`);
lines.push(`- [ ] **没有别名的角色**（可能是漏合并）：${noAlias.length === 0 ? '无' : noAlias.map((c) => c.name).join('、')}`);
lines.push(
  `- [ ] **场景中出现但角色卡未登记**（漏抽嫌疑）：${
    unknownNames.size === 0
      ? '无'
      : [...unknownNames.entries()]
          .slice(0, 12)
          .map(([name, chapters]) => `${name}（${[...chapters].map(chapterLabel).join('/')}）`)
          .join('、') + (unknownNames.size > 12 ? ` 等 ${unknownNames.size} 个` : '')
  }`,
);
lines.push('');
lines.push('## 角色名单');
lines.push('');
lines.push('| 核对 | 角色 | 别名 | 主要 |');
lines.push('|------|------|------|------|');
for (const c of draft.characters ?? []) {
  lines.push(`| [ ] | ${c.name} | ${(c.aliases ?? []).join('、') || '—'} | ${c.isMajor ? '是' : '否'} |`);
}
lines.push('');
lines.push('## 场景边界（按章）');
lines.push('');
for (let i = 0; i < chapters.length; i++) {
  const list = scenesByChapter.get(i);
  lines.push(`### #${i + 1} ${chapters[i].title}  <sub>${chapters[i].text.length} 字</sub>`);
  if (!list || list.length === 0) {
    lines.push('');
    lines.push('> ⚠️ 本章没有切出任何场景，请确认是否合理。');
    lines.push('');
    continue;
  }
  lines.push('');
  lines.push('| 核对 | 段落区间 | 出场角色 | 摘要 |');
  lines.push('|------|----------|----------|------|');
  for (const s of list) {
    const names = (s.keyCharacterNames ?? []).join('、') || '—';
    // 场景级指代：展示「规范名（本场称呼）」，供人工核对是否同一人
    const refs = (s.characterRefs ?? [])
      .map((r) => (r?.referredAs?.length ? `${r.name}（${r.referredAs.join('/')}）` : r?.name))
      .filter(Boolean)
      .join('、');
    const shown = refs ? `${names} ｜ 指代: ${refs}` : names;
    lines.push(`| [ ] | ${s.startParagraph}–${s.endParagraph} | ${shown} | — |`);
  }
  lines.push('');
}

const outPath = path.join(SAMPLES_DIR, sampleId, 'review.md');
const content = `${lines.join('\n')}\n`;
if (!args.stdout) writeFileSync(outPath, content, 'utf8');

console.log(`[review-sheet] ${sampleId}`);
console.log(`  未切出场景章节 ${missingChapters.length} ｜ 单段落场景 ${tinyScenes.length} ｜ 孤儿角色 ${orphanCharacters.length} ｜ 无别名角色 ${noAlias.length} ｜ 未登记出场名 ${unknownNames.size}`);
if (args.stdout) process.stdout.write(content);
else console.log(`  已写入 ${path.relative(ROOT, outPath)}`);
