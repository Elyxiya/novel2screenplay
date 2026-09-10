#!/usr/bin/env node
/**
 * 风格五轴 / 分集预览（FIX-12 + B-13）——纯规则零 LLM
 *
 * 用 vite-node 运行（直接复用 app TS 实现，时长公式与线上同源，避免双份公式漂移）：
 *   npx vite-node scripts/eval/style-preview.ts -- --scenes <scenes.json> [--out-dir docs/conversion-quality]
 *
 * 产出（每 preset 一份，供人工审阅）：
 *   style-preview-<preset>.md —— 五轴摘要 + 分集表（集号/场景数/时长/集末钩子）
 *   （audio-drama 额外附完整配音脚本 dubbing-script 全文）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE_PRESETS } from '../../apps/screenplay/src/lib/pipeline/style-profile';
import { planEpisodes, serializeDubbingScript, estimateSceneDuration, detectSceneHook } from '../../apps/screenplay/src/lib/drama/episodes';
import type { Screenplay } from '@novel/contracts/screenplay';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const scenesFile = arg('scenes');
if (!scenesFile) {
  console.error('用法：npx vite-node scripts/eval/style-preview.ts -- --scenes <scenes.json> [--out-dir <dir>]');
  process.exit(2);
}
const outDir = arg('out-dir', path.join(ROOT, 'docs', 'conversion-quality'))!;
mkdirSync(outDir, { recursive: true });

const artifact = JSON.parse(readFileSync(scenesFile, 'utf8')) as {
  scenes: Screenplay['scenes'];
  charIdToName?: Record<string, string>;
  tag?: string;
};
const screenplay = {
  scenes: artifact.scenes,
  characters: Object.entries(artifact.charIdToName ?? {}).map(([characterId, name]) => ({ characterId, name })),
} as unknown as Pick<Screenplay, 'scenes' | 'characters'>;

console.log(`[style-preview] 输入=${scenesFile}（${artifact.tag ?? 'untagged'}，${artifact.scenes.length} 场景）`);

for (const presetName of ['short-drama', 'audio-drama']) {
  const preset = STYLE_PRESETS[presetName];
  const plan = planEpisodes({ scenes: screenplay.scenes }, preset.rhythmUnit);

  const lines: string[] = [];
  lines.push(`# 风格预览：${presetName}（FIX-12 / B-13）`);
  lines.push('');
  lines.push(`> 来源：\`${path.relative(ROOT, scenesFile).replace(/\\/g, '/')}\` ｜ 五轴：channel=${preset.channel} / dialogue=${preset.dialoguePolicy} / vo=${preset.voPolicy} / form=${preset.artifactForm}`);
  lines.push(`> 节奏单元：每集目标 ${preset.rhythmUnit.episodeTargetMinutes} 分钟、钩子策略 ${preset.rhythmUnit.hookPolicy}`);
  lines.push('');
  lines.push('## 分集总览');
  lines.push('');
  lines.push(`- 集数：**${plan.stats.episodeCount}** ｜ 总时长 ${plan.stats.totalDurationSec}s（≈${(plan.stats.totalDurationSec / 60).toFixed(1)}min）｜ 均集 ${plan.stats.avgEpisodeSec}s ｜ 目标 ${plan.stats.targetEpisodeSec}s ｜ 集末钩子 ${plan.stats.hookEndings}/${plan.stats.episodeCount}`);
  lines.push('');
  lines.push('| 集 | 场景数 | 时长(s) | 集末钩子 | 钩子依据 |');
  lines.push('|---|---|---|---|---|');
  for (const ep of plan.episodes) {
    lines.push(`| ${ep.episodeNumber} | ${ep.sceneNumbers.length} | ${ep.durationSec} | ${ep.hookAtEnd ? '✅' : '—'} | ${ep.hookReasons.join('、') || ''} |`);
  }
  lines.push('');
  lines.push('## 场景时长与钩子明细');
  lines.push('');
  lines.push('| 场 | 时长(s) | 集末钩子 |');
  lines.push('|---|---|---|');
  for (const info of plan.sceneInfos) {
    lines.push(`| #${info.sceneNumber} | ${info.durationSec} | ${info.hookAtEnd ? info.hookReasons.join('、') : '—'} |`);
  }
  lines.push('');
  if (preset.artifactForm === 'dubbing-script') {
    lines.push('## 配音脚本全文（dubbing-script）');
    lines.push('');
    lines.push('```text');
    lines.push(serializeDubbingScript(screenplay, plan.episodes));
    lines.push('```');
    lines.push('');
  }
  lines.push('## 人工审阅要点');
  lines.push('');
  lines.push('- 集长分布是否符合目标（允许 ±20% 微调带）？集末钩子是否落在真正的悬念点上？');
  lines.push('- 配音脚本可否直接朗读（【角色】/【NV·旁白】/（音效·环境）三类行格式）？');
  lines.push('- 场景时长估算是否符合你的直觉（对白 4 字/秒、动作 3s+25字/秒上限 15s）？');

  const outFile = path.join(outDir, `style-preview-${presetName}.md`);
  writeFileSync(outFile, lines.join('\n'));
  console.log(`[style-preview] ${presetName}: ${plan.stats.episodeCount} 集 / 总 ${plan.stats.totalDurationSec}s / 钩子 ${plan.stats.hookEndings} → ${outFile}`);
}
