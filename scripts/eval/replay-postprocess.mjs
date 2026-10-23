/**
 * Phase2 后处理离线重放（P2/A2）
 *
 * 为什么零成本：`phase2Output.rawResponses` 存了逐章 LLM 原始输出，后处理
 * （mergeAdjacentScenes / resolveOverlappingPerChapter）是纯函数，可对历史 job 重放。
 *
 * 用法：
 *   node scripts/eval/replay-postprocess.mjs                  # baseline 10 次运行
 *   node scripts/eval/replay-postprocess.mjs --jobs <id,id>   # 指定 job
 *
 * 步骤：
 *   1. 用「当前」后处理重放，必须与落库 scenes 完全一致（差异 0 才算脚本正确）；
 *   2. 候选规则 A（重叠截断）/ B（短场合并）/ A+B 重放，逐 job 比较单段落数与 P2 F1。
 *
 * 只读库、不调 LLM、不改产品代码。
 * 预注册门槛（见报告，事后不改）：
 *   ① 单段落场景数必须下降；
 *   ② 三样本 P2 均值不得下降超过 0.01；
 *   ③ 任一 job 的 P2 下降 > 0.03 必须单独说明。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { scorePhase2, chapterLabel } from './annotation.mjs';

const require = createRequire(path.resolve('package.json'));
const Database = require('better-sqlite3');

const DB = 'apps/screenplay/data-test/1b-data.db';

/** 与 baseline.mjs 同步的 10 次运行（保持只读副本，避免脚本互相 import 耦合）。 */
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

const MIN_MERGE_CHARS = 800;
const SHORT_SCENE_CHARS = 200;

function parseArgs(argv) {
  const out = { jobs: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--jobs') {
      const value = argv[++i];
      if (!value) throw new Error('--jobs 缺少取值（逗号分隔的 jobId）');
      out.jobs = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      throw new Error(`未知参数: ${flag}（支持 --jobs <id,id>）`);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const db = new Database(DB, { readonly: true });

/** 非空行 = 一段，返回每段结束位置的字符偏移（与 Phase2Segmenter 同一口径）。 */
function calculateCharOffsets(text) {
  const offsets = [0];
  const lineRe = /[^\n]+/g;
  let m;
  while ((m = lineRe.exec(text)) !== null) {
    if (!m[0].trim()) continue;
    offsets.push(m.index + m[0].length);
  }
  return offsets;
}

function paragraphIndexAt(offsets, offset) {
  // 找到包含该字符偏移的段落下标（offsets[p] <= offset < offsets[p+1]）
  for (let p = 0; p < offsets.length - 1; p += 1) {
    if (offset >= offsets[p] && offset < offsets[p + 1]) return p;
  }
  return Math.max(0, offsets.length - 2);
}

/**
 * 复刻产品里的 safeJsonParse（截断/带围栏的响应在原流程里会被解析成空场景，
 * 重放必须保持同一行为，否则「差异 0」不成立）。
 */
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    /* fall through */
  }
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end !== -1) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  const cleaned = stripped
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
    .replace(/:\s*'([^']*)'/g, ': "$1"')
    .replace(/[\x00-\x1F]/g, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return { _parseError: true };
  }
}

/**
 * 从 rawResponses 重建「过滤前」的 allScenes（复刻 segment() 的映射与 ±1/+2 扩展）。
 */
function rebuildScenes(chapters, rawResponses) {
  const allScenes = [];
  const offsetsByChapter = new Map();
  let responseCursor = 0;

  for (const chapter of chapters) {
    const offsets = calculateCharOffsets(chapter.text);
    offsetsByChapter.set(offsetsByChapter.size, offsets);
    const raw = rawResponses[responseCursor];
    responseCursor += 1;
    if (raw === undefined) throw new Error(`rawResponses 缺少章节 ${chapter.index ?? offsetsByChapter.size - 1} 的输出`);
    if (raw.startsWith('Fallback:')) {
      throw new Error(`章节含 fallback 输出，无法离线重放（${raw}）`);
    }
    const parsed = safeJsonParse(raw);
    const scenes = Array.isArray(parsed) ? parsed : parsed.scenes || [];
    const lineCount = Math.max(offsets.length - 1, 1);
    const maxEnd = scenes.reduce((m, s) => Math.max(m, Number(s.endParagraph) || 0), 0);
    const scale = maxEnd > lineCount ? lineCount / (maxEnd + 1) : 1;
    const mapIdx = (n) => Math.min(Math.max(Math.round(n * scale), 0), lineCount);

    for (let i = 0; i < scenes.length; i += 1) {
      const s = scenes[i];
      const rawStart = mapIdx(s.startParagraph ?? 0);
      const rawEnd = mapIdx(s.endParagraph ?? 0);
      const lastIdx = offsets.length - 1;
      const startIdx2 = Math.min(Math.max(0, rawStart - 1), lastIdx);
      const endIdx2 = Math.min(Math.max(rawEnd + 2, startIdx2), lastIdx);
      const originalStartOffset = offsets[startIdx2] ?? 0;
      const originalEndOffset = offsets[endIdx2] ?? chapter.text.length;
      if (originalEndOffset <= originalStartOffset) continue;
      allScenes.push({
        sceneIndex: allScenes.length + 1,
        chapterIndex: chapter.index ?? offsetsByChapter.size - 1,
        startParagraph: rawStart,
        endParagraph: rawEnd,
        originalStartOffset,
        originalEndOffset,
        draftSlugline: s.draftSlugline || `${chapter.title ?? ''} - 场景 ${i + 1}`,
        keyCharacterNames: s.keyCharacterNames || [],
        summary: s.summary || '',
      });
    }
  }
  return { allScenes, offsetsByChapter };
}

/** 复刻 mergeAdjacentScenes（同地点 + 同时间 + 双短 <800 字）。 */
function mergeAdjacentScenes(scenes) {
  if (scenes.length <= 1) return { scenes, mergedPairs: 0 };
  const merged = [scenes[0]];
  let mergedPairs = 0;
  for (let i = 1; i < scenes.length; i += 1) {
    const last = merged[merged.length - 1];
    const current = scenes[i];
    const lastLen = last.originalEndOffset - last.originalStartOffset;
    const currentLen = current.originalEndOffset - current.originalStartOffset;
    const lastLocation = last.draftSlugline.split(' - ')[0] || '';
    const currentLocation = current.draftSlugline.split(' - ')[0] || '';
    const lastTime = last.draftSlugline.split(' - ')[1] || '';
    const currentTime = current.draftSlugline.split(' - ')[1] || '';
    const shouldMerge =
      lastLen < MIN_MERGE_CHARS &&
      currentLen < MIN_MERGE_CHARS &&
      lastLocation === currentLocation &&
      lastTime === currentTime &&
      lastLocation !== '' &&
      currentLocation !== '';
    if (shouldMerge) {
      last.endParagraph = current.endParagraph;
      last.originalEndOffset = current.originalEndOffset;
      last.summary += ' | ' + current.summary;
      last.keyCharacterNames = [...new Set([...last.keyCharacterNames, ...current.keyCharacterNames])];
      mergedPairs += 1;
    } else {
      merged.push(current);
    }
  }
  return { scenes: merged.map((s, i) => ({ ...s, sceneIndex: i + 1 })), mergedPairs };
}

/**
 * 复刻 resolveOverlappingPerChapter。
 * truncate=true 为候选规则 A：重叠时把 start 推到前一场终点，并重算 startParagraph；空跨度丢弃。
 */
function resolveOverlappingPerChapter(scenes, offsetsByChapter, truncate) {
  const byChapter = new Map();
  for (const scene of scenes) {
    const list = byChapter.get(scene.chapterIndex) ?? [];
    list.push(scene);
    byChapter.set(scene.chapterIndex, list);
  }
  const resolved = [];
  let globalIndex = 0;
  let overlapFixes = 0;

  for (const [, chapterScenes] of [...byChapter.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = [...chapterScenes].sort((a, b) => a.originalStartOffset - b.originalStartOffset);
    let currentEnd = 0;
    for (const scene of sorted) {
      let start = scene.originalStartOffset;
      const end = scene.originalEndOffset;
      if (start < currentEnd) {
        overlapFixes += 1;
        if (truncate) {
          start = currentEnd;
          if (end > start) {
            const offsets = offsetsByChapter.get(scene.chapterIndex) ?? [0];
            resolved.push({
              ...scene,
              sceneIndex: ++globalIndex,
              originalStartOffset: start,
              startParagraph: paragraphIndexAt(offsets, start),
            });
            currentEnd = end;
          }
        } else if (end > currentEnd) {
          resolved.push({ ...scene, sceneIndex: ++globalIndex });
          currentEnd = end;
        }
      } else {
        resolved.push({ ...scene, sceneIndex: ++globalIndex });
        currentEnd = end;
      }
    }
  }
  return { scenes: resolved, overlapFixes };
}

/**
 * 候选规则 B：单段落且 <200 字的场景并入相邻场。
 * 优先并后场（后场起点 ≤ 本场终点 +1 段）；否则并前场（本场起点 ≤ 前场终点 +1 段）。
 */
function mergeShortScenes(scenes) {
  const out = [];
  let mergedCount = 0;
  const chapterGroups = new Map();
  for (const scene of scenes) {
    const list = chapterGroups.get(scene.chapterIndex) ?? [];
    list.push(scene);
    chapterGroups.set(scene.chapterIndex, list);
  }

  for (const [, group] of [...chapterGroups.entries()].sort((a, b) => a[0] - b[0])) {
    const list = [...group];
    let i = 0;
    while (i < list.length) {
      const scene = list[i];
      const isShort =
        scene.startParagraph === scene.endParagraph &&
        scene.originalEndOffset - scene.originalStartOffset < SHORT_SCENE_CHARS;
      if (!isShort) {
        out.push(scene);
        i += 1;
        continue;
      }
      const next = list[i + 1];
      if (next && next.startParagraph <= scene.endParagraph + 1) {
        next.startParagraph = scene.startParagraph;
        next.originalStartOffset = scene.originalStartOffset;
        next.summary = scene.summary ? `${scene.summary} | ${next.summary}` : next.summary;
        next.keyCharacterNames = [...new Set([...scene.keyCharacterNames, ...next.keyCharacterNames])];
        mergedCount += 1;
        i += 1;
        continue;
      }
      const prev = out[out.length - 1];
      if (prev && prev.chapterIndex === scene.chapterIndex && scene.startParagraph <= prev.endParagraph + 1) {
        prev.endParagraph = scene.endParagraph;
        prev.originalEndOffset = scene.originalEndOffset;
        prev.summary = scene.summary ? `${prev.summary} | ${scene.summary}` : prev.summary;
        prev.keyCharacterNames = [...new Set([...prev.keyCharacterNames, ...scene.keyCharacterNames])];
        mergedCount += 1;
        i += 1;
        continue;
      }
      out.push(scene);
      i += 1;
    }
  }
  return { scenes: out.map((s, i) => ({ ...s, sceneIndex: i + 1 })), mergedCount };
}

/** 完整后处理链；返回 scenes 与统计。 */
function postprocess(allScenes, offsetsByChapter, opts = {}) {
  const { truncate = false, shortMerge = false } = opts;
  const filtered = allScenes.filter((s) => s.originalEndOffset > s.originalStartOffset);
  const merged = mergeAdjacentScenes(filtered);
  const resolved = resolveOverlappingPerChapter(merged.scenes, offsetsByChapter, truncate);
  let scenes = resolved.scenes;
  let shortMerged = 0;
  if (shortMerge) {
    const shortResult = mergeShortScenes(scenes);
    scenes = shortResult.scenes;
    shortMerged = shortResult.mergedCount;
  }
  return {
    scenes,
    stats: { mergedPairs: merged.mergedPairs, overlapFixes: resolved.overlapFixes, shortMerged },
  };
}

function loadJob(jobId) {
  const row = db
    .prepare('SELECT id, chapter_texts, pipeline_state FROM jobs WHERE id=?')
    .get(jobId);
  if (!row) throw new Error(`job 不存在: ${jobId}`);
  return {
    jobId,
    chapters: JSON.parse(row.chapter_texts).map((text, index) => ({ index, title: '', text })),
    state: JSON.parse(row.pipeline_state),
  };
}

function sceneDiff(a, b) {
  const diffs = [];
  const keys = [
    'chapterIndex',
    'startParagraph',
    'endParagraph',
    'originalStartOffset',
    'originalEndOffset',
    'draftSlugline',
    'summary',
  ];
  if (a.length !== b.length) diffs.push(`场景数 ${a.length} vs ${b.length}`);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    for (const key of keys) {
      if (a[i][key] !== b[i][key]) {
        diffs.push(`#${i + 1}.${key}: ${JSON.stringify(a[i][key])} vs ${JSON.stringify(b[i][key])}`);
      }
    }
  }
  return diffs;
}

function countSingleParagraph(scenes) {
  return scenes.filter((s) => s.startParagraph === s.endParagraph).length;
}

function mean(xs) {
  if (!xs.length) return null;
  return Number((xs.reduce((sum, n) => sum + n, 0) / xs.length).toFixed(4));
}

const goldCache = new Map();
function loadGold(sampleId) {
  if (goldCache.has(sampleId)) return goldCache.get(sampleId);
  const goldPath = path.join('scripts', 'eval', 'samples', sampleId, 'gold.json');
  const draftPath = path.join('scripts', 'eval', 'samples', sampleId, 'annotation.draft.json');
  const used = fs.existsSync(goldPath) ? goldPath : draftPath;
  const doc = JSON.parse(fs.readFileSync(used, 'utf8'));
  goldCache.set(sampleId, { doc, reviewed: Boolean(doc.meta?.reviewed), file: used });
  return goldCache.get(sampleId);
}

const rows = [];
const failures = [];

const jobs = args.jobs
  ? args.jobs.map((jobId) => ({ jobId, sampleId: null }))
  : Object.entries(DEFAULT_RUNS).flatMap(([sampleId, ids]) => ids.map((jobId) => ({ jobId, sampleId })));

for (const { jobId, sampleId } of jobs) {
  const { chapters, state } = loadJob(jobId);
  const phase2 = state.phase2Output;
  if (!phase2?.scenes || !phase2?.rawResponses) {
    failures.push(`${jobId}: 缺少 phase2Output.scenes / rawResponses`);
    continue;
  }
  if (phase2.rawResponses.length !== chapters.length) {
    failures.push(`${jobId}: rawResponses ${phase2.rawResponses.length} 份 ≠ 章节 ${chapters.length}`);
    continue;
  }

  const { allScenes, offsetsByChapter } = rebuildScenes(chapters, phase2.rawResponses);
  const current = postprocess(allScenes, offsetsByChapter);
  const diff = sceneDiff(current.scenes, phase2.scenes);
  if (diff.length) {
    failures.push(`${jobId}: 重放与落库不一致（${diff.slice(0, 3).join('；')}）`);
    continue;
  }

  const candidateA = postprocess(allScenes, offsetsByChapter, { truncate: true });
  const candidateB = postprocess(allScenes, offsetsByChapter, { shortMerge: true });
  const candidateAB = postprocess(allScenes, offsetsByChapter, { truncate: true, shortMerge: true });

  let gold = null;
  if (sampleId) gold = loadGold(sampleId);
  const score = (scenes) =>
    gold ? scorePhase2(gold.doc.scenes, scenes, 0.5) : { f1: null, matched: null, predCount: scenes.length };

  rows.push({
    jobId,
    sampleId,
    reviewed: gold?.reviewed ?? null,
    scenes: phase2.scenes.length,
    single: countSingleParagraph(phase2.scenes),
    f1: score(phase2.scenes).f1,
    a: { scenes: candidateA.scenes.length, single: countSingleParagraph(candidateA.scenes), f1: score(candidateA.scenes).f1 },
    b: { scenes: candidateB.scenes.length, single: countSingleParagraph(candidateB.scenes), f1: score(candidateB.scenes).f1 },
    ab: { scenes: candidateAB.scenes.length, single: countSingleParagraph(candidateAB.scenes), f1: score(candidateAB.scenes).f1 },
    stats: { current: current.stats, a: candidateA.stats, b: candidateB.stats, ab: candidateAB.stats },
  });
}

db.close();

// ── 输出 ──
console.log(`数据库：${DB}（只读）。job 数：${rows.length}${failures.length ? `，失败 ${failures.length}` : ''}。`);
if (failures.length) {
  console.log('\n## 失败');
  for (const f of failures) console.log(`- ${f}`);
}
if (!rows.length) process.exit(1);

const fmt = (v) => (v === null || v === undefined ? '—' : v);
const delta = (a, b) => (a === null || b === null ? null : Number((b - a).toFixed(4)));

console.log('\n## 逐 job');
console.log('| 样本 | job | 场景 | 单段落 | P2 F1 | A 单段落 | A F1 | ΔA | B 单段落 | B F1 | ΔB | A+B 单段落 | A+B F1 | ΔA+B |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.sampleId ?? '—'} | \`${r.jobId.slice(-6)}\` | ${r.scenes} | ${r.single} | ${fmt(r.f1)} | ${r.a.single} | ${fmt(r.a.f1)} | ${fmt(delta(r.f1, r.a.f1))} | ${r.b.single} | ${fmt(r.b.f1)} | ${fmt(delta(r.f1, r.b.f1))} | ${r.ab.single} | ${fmt(r.ab.f1)} | ${fmt(delta(r.f1, r.ab.f1))} |`,
  );
}

console.log('\n## 汇总');
console.log(`- 单段落合计：现状 ${rows.reduce((s, r) => s + r.single, 0)} / A ${rows.reduce((s, r) => s + r.a.single, 0)} / B ${rows.reduce((s, r) => s + r.b.single, 0)} / A+B ${rows.reduce((s, r) => s + r.ab.single, 0)}`);
console.log(`- 场景合计：现状 ${rows.reduce((s, r) => s + r.scenes, 0)} / A ${rows.reduce((s, r) => s + r.a.scenes, 0)} / B ${rows.reduce((s, r) => s + r.b.scenes, 0)} / A+B ${rows.reduce((s, r) => s + r.ab.scenes, 0)}`);

const samples = [...new Set(rows.map((r) => r.sampleId).filter(Boolean))];
console.log('\n## 逐样本 P2 均值');
console.log('| 样本 | 现状 | A | ΔA | B | ΔB | A+B | ΔA+B |');
console.log('|---|---|---|---|---|---|---|---|');
for (const sampleId of samples) {
  const list = rows.filter((r) => r.sampleId === sampleId);
  const cur = mean(list.map((r) => r.f1));
  const a = mean(list.map((r) => r.a.f1));
  const b = mean(list.map((r) => r.b.f1));
  const ab = mean(list.map((r) => r.ab.f1));
  console.log(`| ${sampleId} | ${fmt(cur)} | ${fmt(a)} | ${fmt(delta(cur, a))} | ${fmt(b)} | ${fmt(delta(cur, b))} | ${fmt(ab)} | ${fmt(delta(cur, ab))} |`);
}

console.log('\n## 预注册门槛（逐候选规则）');
const candidates = [
  { id: 'A', name: '重叠截断', single: (r) => r.a.single, f1: (r) => r.a.f1 },
  { id: 'B', name: '短场合并', single: (r) => r.b.single, f1: (r) => r.b.f1 },
  { id: 'A+B', name: '两者叠加', single: (r) => r.ab.single, f1: (r) => r.ab.f1 },
];
for (const c of candidates) {
  const curSingle = rows.reduce((s, r) => s + r.single, 0);
  const candSingle = rows.reduce((s, r) => s + c.single(r), 0);
  const singleDown = candSingle < curSingle;
  const perSample = samples.map((sampleId) => {
    const list = rows.filter((r) => r.sampleId === sampleId);
    return { sampleId, cur: mean(list.map((r) => r.f1)), cand: mean(list.map((r) => c.f1(r))) };
  });
  const meanOk = perSample.every((m) => m.cur === null || m.cand === null || m.cand >= m.cur - 0.01);
  const bigDrops = rows.filter((r) => r.f1 !== null && c.f1(r) !== null && c.f1(r) < r.f1 - 0.03);
  console.log(`\n### ${c.id} ${c.name}`);
  console.log(`- ① 单段落数下降：${singleDown ? 'PASS' : 'FAIL'}（${curSingle} → ${candSingle}）`);
  console.log(`- ② 三样本 P2 均值不降超 0.01：${meanOk ? 'PASS' : 'FAIL'}（${perSample.map((m) => `${m.sampleId}: ${fmt(m.cur)}→${fmt(m.cand)}（Δ ${fmt(delta(m.cur, m.cand))}）`).join('；')}）`);
  console.log(`- ③ 单 job 降幅 >0.03：${bigDrops.length ? `有 ${bigDrops.length} 个，需逐条说明` : '无'}`);
  for (const r of bigDrops) {
    console.log(`  - \`${r.jobId}\` ${r.sampleId ?? ''}：${fmt(r.f1)} → ${fmt(c.f1(r))}（Δ ${fmt(delta(r.f1, c.f1(r)))}）`);
  }
  console.log(`- 判定：${singleDown && meanOk ? '通过，下一批可在预注册后改产品代码' : '未通过，本批只出报告，不改产品代码'}`);
}
