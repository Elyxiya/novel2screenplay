#!/usr/bin/env node
/**
 * LLM 预标注（P2）
 *
 *   node scripts/eval/annotate.mjs --sample xiuzhen-short --job job_xxx
 *        [--db-dir apps/screenplay/data-test] [--db-file 1b-data.db]
 *        [--model deepseek-chat] [--prompt-hash <hash>]
 *
 * 输入：一次真实转换任务（pipeline_state 里的 Phase1/Phase2 产物）
 * 输出：samples/<id>/annotation.draft.json（reviewed=false，带 provenance）
 *
 * 为什么用真实运行产物而不是另写一个标注 prompt：
 * 标注口径必须与「被评系统」的口径一致（同样的章节切分、同样的段落坐标系），
 * 否则 Phase 2 的边界比对没有意义。代价是自标偏差——由人工抽检与
 * checkIndependence 的独立性告警来兜底，而不是假装不存在。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDraftAnnotation, DRAFT_SCHEMA } from './annotation.mjs';
import { readPipelineState, splitChapters } from './convert-driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES_DIR = path.join(ROOT, 'scripts', 'eval', 'samples');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const sampleId = args.sample;
const jobId = args.job;
if (!sampleId || !jobId) {
  console.error('用法: node scripts/eval/annotate.mjs --sample <id> --job <jobId> [--db-dir <dir>] [--db-file <file>]');
  process.exit(1);
}

const dbDir = path.resolve(ROOT, args['db-dir'] ?? 'apps/screenplay/data-test');
const dbFile = args['db-file'] ?? '1b-data.db';
const chapterFile = path.join(SAMPLES_DIR, sampleId, 'chapters.txt');

const chapters = splitChapters(readFileSync(chapterFile, 'utf8'));
if (chapters.length === 0) {
  console.error(`样本 ${sampleId} 的 chapters.txt 没有识别到章节（需 "# N 标题" 分章）`);
  process.exit(1);
}

let state;
try {
  state = readPipelineState(jobId, dbDir, dbFile);
} catch (err) {
  console.error(`读取 pipeline_state 失败：${err.message}`);
  console.error(`请确认 --db-dir/--db-file 指向任务实际落库的库（当前: ${path.join(dbDir, dbFile)}）`);
  process.exit(1);
}
if (!state) {
  console.error(`任务 ${jobId} 没有 pipeline_state（任务未跑或 jobId 不存在）`);
  process.exit(1);
}
if (!state.phase1Output || !state.phase2Output) {
  console.error('任务缺少 Phase1/Phase2 产物，无法用于标注');
  process.exit(1);
}

const draft = buildDraftAnnotation({
  sampleId,
  title: chapters[0]?.title ?? sampleId,
  chapterCount: chapters.length,
  pipelineState: state,
  modelId: args.model ?? null,
  promptHash: args['prompt-hash'] ?? null,
  jobId,
});

const outPath = path.join(SAMPLES_DIR, sampleId, 'annotation.draft.json');
writeFileSync(outPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');

const scenesByChapter = new Map();
for (const s of draft.scenes) scenesByChapter.set(s.chapterIndex, (scenesByChapter.get(s.chapterIndex) ?? 0) + 1);
const missingChapters = chapters
  .map((_, i) => i)
  .filter((i) => !scenesByChapter.has(i));

console.log(`[annotate] ${sampleId}`);
console.log(`  章节数      ${chapters.length}`);
console.log(`  角色        ${draft.characters.length}（含别名 ${draft.characters.reduce((n, c) => n + c.aliases.length, 0)}）`);
console.log(`  场景        ${draft.scenes.length}`);
console.log(`  未切出场景  ${missingChapters.length} 章${missingChapters.length ? `（#${missingChapters.map((i) => i + 1).join(', #')}）` : ''}`);
console.log(`  schema      ${DRAFT_SCHEMA}`);
console.log(`  已写入      ${path.relative(ROOT, outPath)}`);
console.log('\n下一步：node scripts/eval/review-sheet.mjs --sample ' + sampleId);
