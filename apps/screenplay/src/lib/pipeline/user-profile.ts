/**
 * 用户自定义设定（FIX-13 / C5）：融合、冲突标记、注入格式化、指纹
 *
 * 纪律：
 * - 融合规则 = **用户设定 > 原文抽取**；任何被用户改写的字段差异都记 conflict（不静默覆盖）；
 * - 结构化约束映射到卡字段（revealAt）或注入文本；自由文本约束只做注入登记；
 * - profile 指纹（稳定序列化 sha256 前 16）随产物落库，并可供 eval manifest 纳入 params。
 */
import { createHash } from 'crypto';
import type { Phase1Output, RawCharacter, UserProfile } from '@novel/contracts/pipeline';

export interface ProfileMergeReport {
  applied: string[];
  /** 人读冲突记录：原文值 vs 用户值（用户生效） */
  conflicts: string[];
  profileHash: string | null;
}

/** 稳定序列化：对象键排序、数组保序（与 eval manifest.canonicalize 同语义） */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function hashUserProfile(profile?: UserProfile): string | null {
  if (!profile) return null;
  return createHash('sha256').update(stableStringify(profile)).digest('hex').slice(0, 16);
}

function shallowCloneCharacter(c: RawCharacter): RawCharacter {
  return {
    ...c,
    aliases: [...c.aliases],
    ...(c.cardSegments ? { cardSegments: c.cardSegments.map((s) => ({ ...s })) } : {}),
  };
}

/**
 * 融合用户设定到 Phase1 产物（纯函数，不改入参）。
 * 幂等：同一 profile 重复应用不产生新 conflict（值相等时不记）。
 */
export function applyUserProfile(
  phase1: Phase1Output,
  profile?: UserProfile,
): { phase1: Phase1Output; report: ProfileMergeReport } {
  if (!profile) {
    return { phase1, report: { applied: [], conflicts: [], profileHash: null } };
  }

  const applied: string[] = [];
  const conflicts: string[] = [];
  const characters = phase1.characters.map(shallowCloneCharacter);
  const byName = new Map<string, RawCharacter>();
  for (const c of characters) {
    byName.set(c.name, c);
    for (const a of c.aliases) byName.set(a, c);
  }

  for (const ov of profile.characters ?? []) {
    const target = byName.get(ov.name);
    if (!target) {
      const added: RawCharacter = {
        name: ov.name,
        aliases: ov.aliases ?? [],
        personalityTags: ov.personalityTags ?? [],
        description: ov.description ?? '',
        isMajor: ov.isMajor ?? true,
        sourceChapterIndex: 0,
      };
      characters.push(added);
      byName.set(added.name, added);
      applied.push(`新增角色: ${ov.name}`);
      continue;
    }
    if (ov.aliases?.length) {
      const missing = ov.aliases.filter((a) => !target.aliases.includes(a));
      if (missing.length > 0) {
        target.aliases.push(...missing);
        applied.push(`角色 ${target.name} 增补别名: ${missing.join('、')}`);
      }
    }
    if (ov.personalityTags) {
      if (JSON.stringify(target.personalityTags) !== JSON.stringify(ov.personalityTags)) {
        conflicts.push(`角色 ${target.name} personalityTags: 原文=[${target.personalityTags.join('/')}] → 用户=[${ov.personalityTags.join('/')}]（用户生效）`);
      }
      target.personalityTags = [...ov.personalityTags];
      applied.push(`角色 ${target.name} personalityTags 覆盖`);
    }
    if (ov.description !== undefined) {
      if (target.description !== ov.description) {
        conflicts.push(`角色 ${target.name} description: 原文「${target.description.slice(0, 20)}」→ 用户「${ov.description.slice(0, 20)}」（用户生效）`);
      }
      target.description = ov.description;
      applied.push(`角色 ${target.name} description 覆盖`);
    }
    if (ov.isMajor !== undefined) {
      if (target.isMajor !== ov.isMajor) {
        conflicts.push(`角色 ${target.name} isMajor: 原文=${target.isMajor} → 用户=${ov.isMajor}（用户生效）`);
      }
      target.isMajor = ov.isMajor;
      applied.push(`角色 ${target.name} isMajor 覆盖`);
    }
  }

  for (const lock of profile.appellations ?? []) {
    const target = byName.get(lock.character);
    if (!target) {
      conflicts.push(`称谓锁定目标未匹配: ${lock.character}`);
      continue;
    }
    const missing = lock.lockedNames.filter((n) => !target.aliases.includes(n) && n !== target.name);
    if (missing.length > 0) target.aliases.push(...missing);
    applied.push(`称谓锁定: ${target.name} 仅用 ${lock.lockedNames.join('/')}`);
  }

  for (const con of profile.constraints ?? []) {
    const label = con.id ? `${con.id}: ${con.rule}` : con.rule;
    if (con.kind === 'require-reveal-at' && con.character && typeof con.chapterIndex === 'number') {
      const target = byName.get(con.character);
      if (!target) {
        conflicts.push(`约束目标未匹配: ${con.character}（${label}）`);
      } else {
        if (target.revealAt !== undefined && target.revealAt !== con.chapterIndex) {
          conflicts.push(`角色 ${target.name} revealAt: 已有=${target.revealAt} → 用户=${con.chapterIndex}（用户生效）`);
        }
        target.revealAt = con.chapterIndex;
        applied.push(`约束映射: ${target.name} revealAt=${con.chapterIndex}`);
      }
      continue;
    }
    if (con.kind === 'forbid-reveal-before' && con.character && typeof con.chapterIndex === 'number') {
      const target = byName.get(con.character);
      if (!target) {
        conflicts.push(`约束目标未匹配: ${con.character}（${label}）`);
      } else {
        const next = Math.max(target.revealAt ?? 0, con.chapterIndex);
        if (target.revealAt !== next) {
          conflicts.push(`角色 ${target.name} revealAt: 已有=${target.revealAt ?? '未设'} → 用户要求不早于 ${con.chapterIndex}（取 ${next}）`);
        }
        target.revealAt = next;
        applied.push(`约束映射: ${target.name} revealAt≥${con.chapterIndex}`);
      }
      continue;
    }
    // forbid-death / lock-appellation / custom：无卡字段可映射 → 注入登记
    applied.push(`约束登记（注入生效）: ${label}`);
  }

  // 别名索引需覆盖新增别名/角色
  const aliasIndex: Record<string, string> = {};
  for (const c of characters) {
    for (const a of c.aliases) {
      if (!aliasIndex[a]) aliasIndex[a] = c.name;
    }
  }

  return {
    phase1: { ...phase1, characters, aliasIndex },
    report: { applied, conflicts, profileHash: hashUserProfile(profile) },
  };
}

/**
 * 格式化注入块（常驻 Phase3，≤maxChars 字符）。
 * 空 profile（无任何内容）返回空串（调用方跳过拼接）。
 */
export function formatUserProfileBlock(profile?: UserProfile, maxChars = 500): string {
  if (!profile) return '';
  const hasContent =
    (profile.constraints?.length ?? 0) > 0 ||
    (profile.appellations?.length ?? 0) > 0 ||
    (profile.characters?.length ?? 0) > 0 ||
    !!profile.targetFormat;
  if (!hasContent) return '';

  const lines: string[] = ['【用户设定（必须遵守，优先级高于原文推断）】'];
  for (const con of profile.constraints ?? []) lines.push(`- 约束: ${con.rule}`);
  for (const lock of profile.appellations ?? []) lines.push(`- 称谓锁定: ${lock.character} 仅用 ${lock.lockedNames.join('/')}`);
  for (const ov of profile.characters ?? []) {
    const parts = [
      ov.description ? `描述:${ov.description.slice(0, 30)}` : '',
      ov.personalityTags?.length ? `标签:${ov.personalityTags.slice(0, 3).join('/')}` : '',
      ov.isMajor === undefined ? '' : `主要角色:${ov.isMajor}`,
    ].filter(Boolean);
    if (parts.length > 0) lines.push(`- 角色覆盖 ${ov.name}: ${parts.join(' ')}`);
  }
  if (profile.targetFormat) lines.push(`- 目标形态: ${profile.targetFormat}`);

  let block = lines.join('\n');
  if (block.length > maxChars) block = `${block.slice(0, maxChars - 8)}…（截断）`;
  return block;
}
