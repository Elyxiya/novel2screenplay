#!/usr/bin/env node
/**
 * 压缩策略最小可行档位 POC（FIX-19 / ADR-0003）——纯规则、零 LLM、零成本
 *
 * 用法：
 *   node scripts/eval/compress-preview.mjs --sample zhanlan-short --job <jobId> \
 *     --profile light|standard [--db-dir ...] [--db-file ...] [--out <dir>]
 *
 * 输入：隔离库中的 pipeline_state（phase1Output 卡 + phase4Output 产物）+ 样本 annotation；
 * 输出：①决策表 <out>/compress-preview-<sample>-<profile>.json
 *       ②人读压缩大纲 <out>/compress-preview-<sample>-<profile>.md（含被删清单与保护集命中报表）
 *
 * 判据（ADR-0003 第三节，全部确定性）：
 *   KEEP   默认；命中保护集必 KEEP（v1 无例外）
 *   MERGE  相邻场景同地点同时段且双双短（< mergeShortChars）
 *   DROP   仅 standard+：场景引用角色全部非主角 且 不命中保护集（空角色场景按保守 KEEP）
 *   CONDENSE v1 仅标记：动作块字数 > 600 且 动作/对白字数比 > 2.5
 * 保护集：死亡/揭示章（annotation）+ open threads 起止章（设定卡）+ 主角（isMajor）出场。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPipelineState } from './convert-driver.mjs';
import { sceneSourceChapter } from './identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES_DIR = path.join(ROOT, 'scripts', 'eval', 'samples');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export const PROFILES = {
  off: { level: 'off', allowDropMinor: false, mergeShortChars: 800, targetSceneRatio: 1 },
  light: { level: 'light', allowDropMinor: false, mergeShortChars: 900, targetSceneRatio: 0.7 },
  standard: { level: 'standard', allowDropMinor: true, mergeShortChars: 1200, targetSceneRatio: 0.5 },
  aggressive: { level: 'aggressive', allowDropMinor: true, mergeShortChars: 1600, targetSceneRatio: 0.3 },
};

const CONDENSE_ACTION_CHARS = 600;
const CONDENSE_ACTION_DIALOGUE_RATIO = 2.5;

// ── 纯函数（可测） ─────────────────────────────────────────────────────────

export function sceneTextStats(scene) {
  let actionChars = 0;
  let dialogueChars = 0;
  for (const b of scene.content ?? []) {
    const text = (b.description ?? '') + (b.line ?? '');
    if (b.type === 'dialogue') dialogueChars += text.length;
    else actionChars += text.length;
  }
  return { actionChars, dialogueChars, total: actionChars + dialogueChars };
}

/** 保护章集合：死亡章 ∪ 揭示章 ∪ open threads 起止章 */
export function protectedChapters(annotation, settingCard) {
  const set = new Set();
  for (const d of annotation?.deadCharacters ?? []) set.add(d.deathChapter);
  for (const r of annotation?.reveals ?? []) set.add(r.revealChapter);
  for (const t of settingCard?.openThreads ?? []) {
    set.add(t.startChapterIndex);
    if (typeof t.endChapterIndex === 'number') set.add(t.endChapterIndex);
  }
  return set;
}

/** 主角名集合（isMajor=true） */
export function majorCharacterNames(phase1) {
  return new Set((phase1?.characters ?? []).filter((c) => c.isMajor !== false).map((c) => c.name));
}

function sceneReferencedNames(scene, charIdToName) {
  const map = charIdToName ?? {};
  const names = new Set();
  for (const id of scene.characterIds ?? []) names.add(map[id] ?? id);
  for (const b of scene.content ?? []) {
    if (b.type === 'dialogue' && b.characterId) names.add(map[b.characterId] ?? b.characterId);
  }
  return names;
}

/**
 * 生成压缩决策表（纯函数）。
 * @returns {{decisions: Array, stats: object, protectedReport: object}}
 */
export function planCompression({ scenesJson, phase1, annotation, profile }) {
  const prof = typeof profile === 'string' ? PROFILES[profile] : profile;
  if (!prof || prof.level === 'off') {
    const n = scenesJson.scenes?.length ?? 0;
    return {
      decisions: (scenesJson.scenes ?? []).map((s) => ({ sceneIndex: s.sceneNumber, action: 'KEEP', ruleId: 'R-OFF' })),
      stats: { total: n, kept: n, merged: 0, dropped: 0, condensed: 0, dropRatio: 0, outputScenes: n, targetRatio: 1, actualRatio: 1 },
      protectedReport: { protectedChapters: [], hits: [] },
    };
  }

  const protChapters = protectedChapters(annotation, phase1?.settingCard);
  const majors = majorCharacterNames(phase1);
  const scenes = scenesJson.scenes ?? [];
  const decisions = [];
  const protectedHits = [];

  for (const scene of scenes) {
    const ch = sceneSourceChapter(scene);
    const names = sceneReferencedNames(scene, scenesJson.charIdToName);
    const hasMajor = [...names].some((n) => majors.has(n));
    const inProtectedChapter = ch !== null && protChapters.has(ch);
    const protectedScene = hasMajor || inProtectedChapter;
    const minorOnly = names.size > 0 && [...names].every((n) => !majors.has(n));
    const hits = [
      ...(hasMajor ? [...names].filter((n) => majors.has(n)).map((n) => `major:${n}`) : []),
      ...(inProtectedChapter ? [`chapter:${ch}`] : []),
    ];

    if (protectedScene) {
      protectedHits.push({ sceneIndex: scene.sceneNumber, chapter: ch, reason: hasMajor ? 'major-present' : 'protected-chapter' });
    }

    // ① DROP 仅 standard+，且不触保护集
    if (prof.allowDropMinor && minorOnly && !protectedScene) {
      decisions.push({ sceneIndex: scene.sceneNumber, action: 'DROP', ruleId: 'R-DROP-MINOR', protectedHits: [], note: `角色均为次要: ${[...names].join('、')}` });
      continue;
    }

    // ② CONDENSE 为"标记"（场景保留），保护集不阻断标记，但记录命中以示透明
    const stats = sceneTextStats(scene);
    if (stats.actionChars > CONDENSE_ACTION_CHARS && stats.dialogueChars > 0 && stats.actionChars / stats.dialogueChars > CONDENSE_ACTION_DIALOGUE_RATIO) {
      decisions.push({ sceneIndex: scene.sceneNumber, action: 'CONDENSE', ruleId: 'R-CONDENSE-MARK', protectedHits: hits, note: `动作 ${stats.actionChars} 字 / 对白 ${stats.dialogueChars} 字` });
      continue;
    }

    // ③ 保护集 → KEEP（v1 无例外）
    if (protectedScene) {
      decisions.push({ sceneIndex: scene.sceneNumber, action: 'KEEP', ruleId: hasMajor ? 'R-PROTECT-MAJOR' : 'R-PROTECT-CHAPTER', protectedHits: hits });
      continue;
    }

    decisions.push({ sceneIndex: scene.sceneNumber, action: 'KEEP', ruleId: 'R-KEEP-DEFAULT', protectedHits: [] });
  }

  // MERGE：相邻两条保留类决策（KEEP/CONDENSE）且同地点同时段且双短 → 合并（前条吸收后条）
  // 注：保护场可参与 MERGE——合并保留内容、只折叠边界，不构成"删减"。
  const final = [];
  let mergeGroups = 0;
  for (const d of decisions) {
    const prev = final.at(-1);
    const canAbsorb = prev && (prev.action === 'KEEP' || prev.action === 'MERGE');
    const isCandidate = d.action === 'KEEP' || d.action === 'CONDENSE';
    if (canAbsorb && isCandidate) {
      const a = scenes.find((s) => s.sceneNumber === prev.sceneIndex);
      const b = scenes.find((s) => s.sceneNumber === d.sceneIndex);
      const shortA = a && sceneTextStats(a).total < prof.mergeShortChars;
      const shortB = b && sceneTextStats(b).total < prof.mergeShortChars;
      const sameLoc = a && b && a.slugline.split(' - ')[0] === b.slugline.split(' - ')[0];
      const sameTime = a && b && (a.slugline.split(' - ')[1] ?? '') === (b.slugline.split(' - ')[1] ?? '');
      if (shortA && shortB && sameLoc && sameTime) {
        prev.mergedWith = [...(prev.mergedWith ?? []), d.sceneIndex];
        prev.action = 'MERGE';
        mergeGroups += 1;
        continue;
      }
    }
    final.push(d);
  }

  const dropped = final.filter((d) => d.action === 'DROP').length;
  const condensed = final.filter((d) => d.action === 'CONDENSE').length;
  const total = scenes.length;
  const outputScenes = final.filter((d) => d.action !== 'DROP').length;

  return {
    decisions: final,
    stats: {
      total,
      kept: final.length,
      merged: mergeGroups,
      condensed,
      dropped,
      dropRatio: total > 0 ? Number((dropped / total).toFixed(4)) : 0,
      outputScenes,
      targetRatio: prof.targetSceneRatio,
      actualRatio: total > 0 ? Number((outputScenes / total).toFixed(4)) : 0,
    },
    protectedReport: { protectedChapters: [...protChapters].sort((a, b) => a - b), hits: protectedHits },
  };
}

/** 人读大纲（Markdown）——纯函数 */
export function buildOutlineMarkdown({ sample, profile, scenesJson, plan, jobId }) {
  const scenes = scenesJson.scenes ?? [];
  const byIndex = new Map(scenes.map((s) => [s.sceneNumber, s]));
  const lines = [];
  lines.push(`# 压缩预览大纲：${sample} × profile=${profile}`);
  lines.push('');
  lines.push(`> job=${jobId} ｜ 场景总数 ${plan.stats.total} → 输出 ${plan.stats.outputScenes}（MERGE ${plan.stats.merged} / DROP ${plan.stats.dropped} / CONDENSE 标记 ${plan.stats.condensed}）`);
  lines.push(`> 目标比率 ${plan.stats.targetRatio} ｜ 实际比率 ${plan.stats.actualRatio}（POC 数据用于校准档位，见 ADR-0003 第四节）`);
  lines.push('');
  lines.push('## 保护集命中（永 DROP 例外，v1 无例外）');
  lines.push('');
  lines.push(`- 保护章（死亡/揭示/open threads 起止）：[${plan.protectedReport.protectedChapters.join(', ')}]`);
  lines.push(`- 命中场景 ${plan.protectedReport.hits.length} 个：${plan.protectedReport.hits.map((h) => `#${h.sceneIndex}(${h.reason})`).join('、') || '无'}`);
  lines.push('');
  lines.push('## 决策清单（按输出顺序）');
  lines.push('');
  lines.push('| 序号 | 动作 | 场景 | 章 | 规则 | 说明 |');
  lines.push('|---|---|---|---|---|---|');
  let n = 0;
  for (const d of plan.decisions) {
    const s = byIndex.get(d.sceneIndex);
    n += 1;
    lines.push(`| ${n} | ${d.action} | #${d.sceneIndex}${d.mergedWith ? `+${d.mergedWith.join('+')}` : ''} | ${sceneSourceChapter(s) ?? '—'} | ${d.ruleId} | ${d.note ?? (d.protectedHits?.length ? d.protectedHits.join(' / ') : '')} |`);
  }
  lines.push('');
  lines.push('## 被删清单（DROP，仅 standard+）');
  lines.push('');
  const drops = plan.decisions.filter((d) => d.action === 'DROP');
  if (drops.length === 0) lines.push('（无）');
  else for (const d of drops) {
    const s = byIndex.get(d.sceneIndex);
    lines.push(`- #${d.sceneIndex}（章 ${sceneSourceChapter(s) ?? '—'}）：${s?.summary || '(无摘要)'} —— ${d.note ?? ''}`);
  }
  lines.push('');
  lines.push('## 人工评审要点（ADR-0003 第八节）');
  lines.push('');
  lines.push('- 「该保的保了」：保护集命中报表是否覆盖你心中不可删的场次？');
  lines.push('- 「该删的删了」：DROP 清单是否误伤主线/反差点；有无明显的"水场"未被删？');
  lines.push('- 校准：目标比率 vs 实际比率 → 回写 ADR 档位建议值。');
  lines.push('');
  return lines.join('\n');
}

// ── 主流程 ────────────────────────────────────────────────────────────────

function main() {
  const sample = arg('sample', 'zhanlan-short');
  const jobId = arg('job');
  const profileName = arg('profile', 'light');
  const dbDir = arg('db-dir', process.env.DB_DIR || path.join(ROOT, 'apps', 'screenplay', 'data-test'));
  const dbFile = arg('db-file', process.env.DB_FILE || '1b-data.db');
  const outDir = arg('out', path.join(ROOT, 'docs', 'conversion-quality'));

  if (!jobId) {
    console.error('用法：node scripts/eval/compress-preview.mjs --sample <id> --job <jobId> --profile light|standard');
    process.exitCode = 2;
    return;
  }
  const prof = PROFILES[profileName];
  if (!prof) {
    console.error(`--profile 须为 ${Object.keys(PROFILES).join('|')}`);
    process.exitCode = 2;
    return;
  }

  const sampleDir = path.join(SAMPLES_DIR, sample);
  const state = readPipelineState(jobId, dbDir, dbFile);
  if (!state?.phase4Output?.scenes) throw new Error(`job ${jobId} 无 phase4Output.scenes`);

  const scenesJson = { scenes: state.phase4Output.scenes, charIdToName: Object.fromEntries((state.phase4Output.characters ?? []).map((c) => [c.characterId, c.name])) };
  const annotation = JSON.parse(readFileSync(path.join(sampleDir, 'annotation.json'), 'utf8'));

  const plan = planCompression({ scenesJson, phase1: state.phase1Output, annotation, profile: prof });
  mkdirSync(outDir, { recursive: true });
  const base = `compress-preview-${sample}-${profileName}`;
  writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify({ sample, profile: profileName, jobId, ...plan }, null, 2));
  writeFileSync(path.join(outDir, `${base}.md`), buildOutlineMarkdown({ sample, profile: profileName, scenesJson, plan, jobId }));
  console.log(`[compress-preview] ${sample} × ${profileName}: ${plan.stats.total} → ${plan.stats.outputScenes}（DROP ${plan.stats.dropped} / MERGE ${plan.stats.merged}）`);
  console.log(`[compress-preview] 决策表 → ${path.join(outDir, `${base}.json`)}`);
  console.log(`[compress-preview] 大纲 → ${path.join(outDir, `${base}.md`)}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); } catch (err) { console.error(`[compress-preview] 失败: ${err.message}`); process.exitCode = 1; }
}
