/**
 * Phase 1 角色卡净化：把「外观描述」从角色卡里区分出去。
 *
 * 背景：mapreduce 会把「月白衣袍老者」「瓜子脸女孩」这类描述性指代当成角色，
 * 角色卡从 10 个膨胀到 34 个、Phase1 precision 从 0.91 掉到 0.32。
 * 但简单按正则删又会误杀「大副」（职务称谓、全书无名、却横跨两章且有台词）。
 *
 * 三条口径（决策见 docs/conversion-quality/gold-annotation-workflow.md）：
 *  1. 证据只取自**章节原文**，不取自 Phase2/Phase3 输出——否则像大副那样被下游漏标的角色
 *     会被连带误杀（实测：场景标签里大副只有 1 章，原文其实有 2 章）。
 *  2. 描述**永不**自动并入具名角色；唯一例外是**同一段落**内与某个具名角色共现
 *     （「对着房外的一名青衫老者微笑道：走吧，墨管家」）——这时它只是该角色的场景内称呼。
 *  3. 删除必须级联：同时清掉场景 keyCharacterNames 里的同名引用，否则会反弹成「未登记出场名」。
 *
 * 只动角色卡与场景的角色引用，**不动原文、不动场景正文**。
 */
import type { RawCharacter, SceneBoundary } from '@novel/contracts/pipeline';

/** 外观/性别年龄描述：出现在名字末尾即视为「描述性指代」而非专名 */
export const DESCRIPTOR_NAME_RE = /(男子|女子|少女|少年|青年|老者|老人|老头|妇女|胖子|瘦子|大汉|女孩|男孩|妇人)$/;

export const DEFAULT_MIN_CHAPTERS = 2;
export const DEFAULT_MIN_MENTIONS = 3;
/** 同指判据：描述与名字之间最多隔这么多字符（「青衫老者微笑道：“走吧，墨管家」约 7 字） */
export const MAX_COREF_GAP = 12;
/** 间隔里出现这些字，说明两人是互动关系（对着/直指/被…），不是同一个人 */
const INTERACTION_CHARS = /[对向朝指看被给和与跟将把]/;

export interface CharacterEvidence {
  /** 出现该名字/别名的章节数 */
  chapters: number;
  /** 跨全书提及次数（名字 + 别名） */
  mentions: number;
  /** 次级信号：命中的行里含引号的行数（可能是在说话）。只报告，不参与判定。 */
  quotedLines: number;
}

export interface SanitizeOptions {
  minChapters?: number;
  minMentions?: number;
}

export interface DroppedCharacter {
  name: string;
  evidence: CharacterEvidence;
}

export interface SanitizePlan {
  kept: RawCharacter[];
  dropped: DroppedCharacter[];
  /** 描述 → 与之同段共现的具名角色。只记录「唯一候选」的确定情况。 */
  replaced: Record<string, string>;
  /** 开关关闭时为 true，调用方据此跳过场景改写 */
  disabled: boolean;
}

function termsOf(character: Pick<RawCharacter, 'name' | 'aliases'>): string[] {
  return [character.name, ...(character.aliases ?? [])].filter((t) => t && t.trim());
}

/** 按 Phase 2 的口径切行：一个非空行 = 一段 */
export function splitParagraphs(chapterText: string): string[] {
  return chapterText.split('\n').filter((line) => line.trim().length > 0);
}

/** 证据只数原文，不碰任何下游产物 */
export function measureEvidence(
  name: string,
  aliases: string[],
  chapterTexts: string[],
): CharacterEvidence {
  const terms = [name, ...aliases].filter(Boolean);
  let chapters = 0;
  let mentions = 0;
  let quotedLines = 0;

  for (const text of chapterTexts) {
    let inChapter = 0;
    for (const paragraph of splitParagraphs(text)) {
      let hitHere = 0;
      for (const term of terms) hitHere += paragraph.split(term).length - 1;
      if (hitHere === 0) continue;
      inChapter += hitHere;
      if (/[「“"]/.test(paragraph)) quotedLines += 1;
    }
    if (inChapter > 0) chapters += 1;
    mentions += inChapter;
  }

  return { chapters, mentions, quotedLines };
}

/**
 * 同指判据：描述与具名角色在**同一段**且**紧邻**（间隔 ≤ MAX_COREF_GAP 字、其间无互动动词）。
 *
 * 为什么不是「同段共现」就够了：实测《斗破》第 7 章有一段
 * 「一旁的那位英俊青年，豁然的拔出长剑，目光阴冷的直指萧炎」——
 * 同段共现会把「英俊青年」并进萧炎，恰恰是把路人抬成主角。
 */
function sameParagraphCoref(paragraph: string, descriptor: string, terms: string[]): boolean {
  const positions: number[] = [];
  for (let i = paragraph.indexOf(descriptor); i !== -1; i = paragraph.indexOf(descriptor, i + 1)) {
    positions.push(i);
  }
  if (positions.length === 0) return false;

  for (const term of terms) {
    for (let j = paragraph.indexOf(term); j !== -1; j = paragraph.indexOf(term, j + 1)) {
      for (const start of positions) {
        const end = start + descriptor.length;
        const gap = j >= end ? paragraph.slice(end, j) : paragraph.slice(j + term.length, start);
        const distance = Math.abs(j - start) - Math.min(descriptor.length, term.length);
        if (distance > MAX_COREF_GAP) continue;
        if (INTERACTION_CHARS.test(gap)) continue;
        return true;
      }
    }
  }
  return false;
}

/**
 * 建立净化计划。
 *
 * 判定：非描述名 → 保留；描述名且（跨章 ≥ minChapters 或 提及 ≥ minMentions）→ 保留；
 * 其余 → 丢弃，并尝试建立「同段紧邻」的替换关系。
 */
export function buildSanitizePlan(
  characters: RawCharacter[],
  chapterTexts: string[],
  options: SanitizeOptions = {},
): SanitizePlan {
  if (process.env.CHARACTER_SANITIZE === 'off') {
    return { kept: characters, dropped: [], replaced: {}, disabled: true };
  }

  const minChapters = options.minChapters ?? DEFAULT_MIN_CHAPTERS;
  const minMentions = options.minMentions ?? DEFAULT_MIN_MENTIONS;

  const kept: RawCharacter[] = [];
  const dropped: DroppedCharacter[] = [];

  for (const character of characters) {
    if (!DESCRIPTOR_NAME_RE.test(character.name)) {
      kept.push(character);
      continue;
    }
    const evidence = measureEvidence(character.name, character.aliases ?? [], chapterTexts);
    if (evidence.chapters >= minChapters || evidence.mentions >= minMentions) {
      kept.push(character);
    } else {
      dropped.push({ name: character.name, evidence });
    }
  }

  // 同段紧邻：仅当该描述出现的所有段落都只与同一个具名角色紧邻时，才认定是该角色的称呼。
  const replaced: Record<string, string> = {};
  for (const { name } of dropped) {
    const candidates = new Set<string>();
    for (const text of chapterTexts) {
      for (const paragraph of splitParagraphs(text)) {
        if (!paragraph.includes(name)) continue;
        for (const character of kept) {
          if (sameParagraphCoref(paragraph, name, termsOf(character))) candidates.add(character.name);
        }
      }
    }
    if (candidates.size === 1) replaced[name] = [...candidates][0];
  }

  return { kept, dropped, replaced, disabled: false };
}

/**
 * 把计划应用到场景上：同段同指的描述替换为规范名，已丢弃的名字直接移除。
 * 只处理计划里点名的那些名字，不动其它未知名字（避免过度清洗掩盖 Phase2 的漏抽）。
 */
export function applySanitizePlanToScenes(
  scenes: SceneBoundary[],
  plan: SanitizePlan,
): { scenes: SceneBoundary[]; changed: number } {
  if (plan.disabled || (plan.dropped.length === 0 && Object.keys(plan.replaced).length === 0)) {
    return { scenes, changed: 0 };
  }

  const droppedNames = new Set(plan.dropped.map((d) => d.name));
  let changed = 0;

  const next = scenes.map((scene) => {
    const before = scene.keyCharacterNames ?? [];
    const mapped = before
      .map((name) => plan.replaced[name] ?? name)
      .filter((name) => !droppedNames.has(name));
    const deduped = [...new Set(mapped)];
    if (deduped.length === before.length && deduped.every((n, i) => n === before[i])) return scene;
    changed += 1;
    return { ...scene, keyCharacterNames: deduped };
  });

  return { scenes: next, changed };
}
