/**
 * 风格五轴（FIX-12 / C6）：预设、解析与注入格式化。
 *
 * 五轴（contracts StyleProfileSchema）：channel / dialoguePolicy / rhythmUnit /
 * voPolicy / artifactForm。离散"预设"只是参数组合的快捷方式；任意组合直接传对象即可。
 */
import type { StyleProfile } from '@novel/contracts/pipeline';

/** 预设：short-drama = 现状默认（visual 直给、忌旁白、文学剧本） */
export const STYLE_PRESETS: Record<string, StyleProfile> = {
  'short-drama': {
    channel: 'visual',
    dialoguePolicy: 'direct',
    rhythmUnit: { episodeTargetMinutes: 2, hookPolicy: 'cliffhanger' },
    voPolicy: 'forbidden',
    artifactForm: 'screenplay',
  },
  'audio-drama': {
    channel: 'audio',
    dialoguePolicy: 'plain',
    rhythmUnit: { episodeTargetMinutes: 10, hookPolicy: 'cliffhanger' },
    voPolicy: 'primary',
    artifactForm: 'dubbing-script',
  },
};

/** 名称或对象 → 完整 profile（未知名抛错，杜绝静默回退——见 B-20 教训） */
export function resolveStyleProfile(input?: string | StyleProfile): StyleProfile | undefined {
  if (!input) return undefined;
  if (typeof input === 'string') {
    const preset = STYLE_PRESETS[input];
    if (!preset) throw new Error(`未知风格预设: ${input}（可用: ${Object.keys(STYLE_PRESETS).join(' / ')}）`);
    return { ...preset, rhythmUnit: { ...preset.rhythmUnit } };
  }
  return input;
}

/** 五轴 → 注入指令块（≤maxChars；纯视觉/禁旁白时给出保守提示，不改默认行为） */
export function formatStyleBlock(profile?: StyleProfile, maxChars = 400): string {
  if (!profile) return '';
  const lines = ['【风格参数（五轴）】'];
  lines.push(`- 信息通道: ${profile.channel === 'audio' ? '音频（一切必须可听：动作用音效/口吻提示承载）' : '视觉（动作与表情承担叙事，可拍可演）'}`);
  const dialogueHint = {
    direct: '对白直给、信息密度高',
    implicit: '对白含蓄、重潜台词，允许留白',
    plain: '叙述平实、对白完整可听',
  }[profile.dialoguePolicy];
  lines.push(`- 对白策略: ${dialogueHint}`);
  lines.push(
    `- 旁白地位: ${
      profile.voPolicy === 'primary'
        ? '旁白/独白为主叙事通道，允许 monologue 块（speaker 缺省=NV）'
        : profile.voPolicy === 'allowed'
          ? '旁白限量，仅用于不可见信息'
          : '不使用旁白/内心独白（心理一律动作外化）'
    }`,
  );
  if (profile.voPolicy === 'primary' && profile.channel === 'audio') {
    lines.push('- 产物形态: 配音脚本（对白/独白/音效行可朗读）');
  }
  let block = lines.join('\n');
  if (block.length > maxChars) block = `${block.slice(0, maxChars - 8)}…（截断）`;
  return block;
}
