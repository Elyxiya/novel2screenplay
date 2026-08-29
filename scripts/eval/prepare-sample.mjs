#!/usr/bin/env node
/**
 * 样本标注预处理（T2-C2 / Task 2.2 基础设施）
 *
 * 把一份原始小说 txt → 产出人工标注骨架，供 eval 的 `identity` 真实样本集消费。
 *
 * 用法：
 *   node scripts/eval/prepare-sample.mjs \
 *     --input "E:\\...\\小说.txt" \
 *     --id <sampleId> \
 *     [--type short|medium|long] [--title X] [--author Y]
 *
 * 产出（写到 scripts/eval/samples/<sampleId>/）：
 *   - annotation.json ：标注骨架。人工只填 settlement 字段（死亡/揭示章），其余是
 *       识别元信息 + 初筛候选（candidates，仅供人确认，不属于 eval 输入）。
 *   - chapters.txt    ：GBK→UTF-8 章节化阅读底稿（人工核对章号用）。
 *
 * 编码：UTF-8 严格解码失败 → 回退 GBK（网文常见）。
 * 章节：内联精简正则（"第N章"/序章/第N节），与 apps/src/lib/novel/parser.ts 同原则。
 * 初筛：只做零成本的关键句定位（死亡/揭示），不猜全量姓名，避免 5MB 级 n-gram 卡死。
 *
 * 入 eval 的字段（annotation.schema="identity-annotation/v1"）：
 *   deadCharacters: [{name, deathChapter}]   ← 人工
 *   reveals:        [{secretName, revealChapter}]  ← 人工
 *   aliasIndex:     {别名: 规范名}            ← 可选（Phase1 角色表或人工）
 *   charIdToName:   {char_N: 名}             ← 剧本产物注入（非手写）
 *   scenesRef:      剧本产物 ScreenplayScene[] 的文件名（由转换阶段导出，非人工）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(SCRIPT_DIR, 'samples');

// ── CLI ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    }
  }
  return args;
}

// ── 编解码 ─────────────────────────────────────────────────────────────

function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf); // 网文常见 GBK
  }
}

// ── 章节切分（精简正则，与 novel/parser.ts 同原则） ────────────────

const CHAPTER_PATTERNS = [
  /^\s*序[章：: ]\s*(.*)$/gm,
  /^\s*第[〇零一二三四五六七八九十百千0-9]+章[：: ]?\s*(.*)$/gm,
  /^\s*第[〇零一二三四五六七八九十百千0-9]+节\s*(.*)$/gm,
  /^\s*(?:Chapter|CHAPTER|Ch)\.?\s*[0-9]+[：:.]?\s*(.*)$/gm,
];

function splitChapters(text) {
  const marks = [];
  for (const re of CHAPTER_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      marks.push({ idx: m.index, title: (m[1] ?? '').trim() || '第?章', at: m.index });
    }
  }
  marks.sort((a, b) => a.idx - b.idx);
  // 去重叠（10 字符内取先出现者）
  const b = [];
  for (const mk of marks) {
    if (b.length === 0 || mk.idx - b[b.length - 1].idx >= 10) b.push(mk);
  }
  const chapters = b.map((mk, i) => {
    const end = i + 1 < b.length ? b[i + 1].idx : text.length;
    return { chapterIndex: i, title: mk.title, text: text.slice(mk.idx, end) };
  });
  return chapters;
}

// ── 初筛（零成本关键句定位） ────────────────────────────────────────

// 死亡动词（聚焦"角色死亡事件"，排除明显非死亡语义的"死"组合）
const DEATH_KW = /(身亡|去世|身死|陨落|牺牲|毙命|丧命|死了|死去)/;
// 命中"死"但语境明显非角色死亡 → 跳过（降低"昏死/拼死/生死"等噪音）
const DEATH_SKIP = /昏死|战死|病死|拼死|打死|杀死|去死|生死|死伤|死亡之|干死|搞死|弄死|处死|凌迟|等死|该死|必死/;
const REVEAL_KW = /(真实身份|真实名字|身份是|身世是|原来是|竟然是|竟是她|竟是他|真名|化名|本名|隐藏身份|前朝|真身|其实是)/;

function scanText(chapters) {
  const deaths = [];
  const reveals = [];

  chapters.forEach((ch) => {
    const chId = ch.chapterIndex;
    for (const line of ch.text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (DEATH_KW.test(t) && !DEATH_SKIP.test(t)) {
        deaths.push({ chapterIndex: chId, chapterTitle: ch.title, line: t.slice(0, 120) });
      } else if (REVEAL_KW.test(t)) {
        reveals.push({ chapterIndex: chId, chapterTitle: ch.title, line: t.slice(0, 120) });
      }
    }
  });

  return { deaths, reveals };
}

// ── 主流程 ─────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input;
  const sampleId = args.id;
  if (!input || !sampleId) {
    console.error('用法: --input <txt> --id <sampleId> [--type short|medium|long] [--title X] [--author Y]');
    process.exit(2);
  }
  if (!existsSync(input)) {
    console.error(`输入文件不存在: ${input}`);
    process.exit(2);
  }
  const type = args.type ?? 'long';
  if (!['short', 'medium', 'long'].includes(type)) {
    console.error(`--type 必须是 short|medium|long，得到 ${type}`);
    process.exit(2);
  }

  const raw = readFileSync(input);
  const text = decodeText(raw);
  const chapters = splitChapters(text);
  const { deaths, reveals } = scanText(chapters);

  const outDir = join(SAMPLES_DIR, sampleId);
  mkdirSync(outDir, { recursive: true });

  const annotation = {
    schema: 'identity-annotation/v1',
    sampleId,
    title: args.title ?? null,
    author: args.author ?? null,
    type,
    sourceFile: input,
    chapterCount: chapters.length,
    inputTokensHint: Math.ceil(text.length / 4),
    // ── 人工标注字段（eval 消费的正式输入）──
    deadCharacters: [], // [{name, deathChapter}]
    reveals: [], // [{secretName, revealChapter}]
    aliasIndex: {}, // {别名: 规范名}（Phase1 角色表或人工）
    charIdToName: {}, // 剧本产物注入，非手写
    scenesRef: null, // 剧本产物 ScreenplayScene[] 文件名（转换阶段导出）
    // ── 初筛候选（仅供人确认，不进 eval）──
    candidates: {
      // 死亡命中（排除式过滤后），截 200、按章序（早期死亡更有"之后不再开口"断言语义）
      deathHits: deaths.slice(0, 200),
      // 揭示命中全量保留（隐藏身份通常后期揭示，截前段会漏后期章）
      revealHits: reveals,
    },
  };

  writeFileSync(join(outDir, 'annotation.json'), `${JSON.stringify(annotation, null, 2)}\n`);
  const chapterDigest = chapters
    .map((c) => `#${c.chapterIndex + 1} ${c.title}\n${c.text}\n`)
    .join('\n');
  writeFileSync(join(outDir, 'chapters.txt'), chapterDigest);

  console.log(`[prepare-sample] sampleId=${sampleId} type=${type}`);
  console.log(`  解码字符数=${text.length} 章节数=${chapters.length}（输入 token 约 ${annotation.inputTokensHint}）`);
  console.log(`  初筛死亡关键句=${deaths.length} 揭示关键句=${reveals.length}`);
  console.log(`  页面骨架: ${outDir}/annotation.json`);
  console.log(`  章节底稿: ${outDir}/chapters.txt`);
  console.log('  人工标注：在 annotation.json 填入 deadCharacters / reveals（章号从此书章节序数，从 1 起）。');
}

main();