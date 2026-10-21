/**
 * Phase 2 角色接地校验：场景里标注的角色，必须在**本章原文**里出现过。
 *
 * 为什么需要：实测《最后一个修真者》第 10 章原文一次都没提「豆豆」，
 * 但 Phase 2 在该章三个场景里都标了他——角色卡里有人，模型就顺手带进去了。
 * 这类幻觉会一路传到 Phase 3（给不存在的角色写台词）和评分（precision 虚高）。
 *
 * 为什么按「章」而不是「场景段落」判：同章内先点名、后以「他/她」指代是常态，
 * 按场景段落判会误杀。按章判只挡「整章都没出现过这个人」的跨章串味，误杀面最小。
 *
 * 为什么不是纯字符串匹配：中文称谓有多种写法——
 *   - 别名：萧薰儿 / 熏儿；
 *   - 关系称谓：方晓语父亲 ↔ 原文「方晓语的父亲」。
 * 因此先精确匹配名字与别名，再退化为「去『的』后的组件同时出现」。
 */
import type { RawCharacter, SceneBoundary } from '@novel/contracts/pipeline';

/** 关系称谓后缀：用于把「方晓语父亲」拆成「方晓语 + 父亲」两段核对 */
const RELATION_SUFFIX = /(父亲|母亲|爸爸|妈妈|爷爷|奶奶|外公|外婆|儿子|女儿|哥哥|弟弟|姐姐|妹妹|师父|师傅|老师|妻子|丈夫|老婆|老公|舅舅|叔叔|阿姨)$/;

export interface GroundingDrop {
  sceneIndex: number;
  chapterIndex: number;
  name: string;
}

export type GroundingMode = 'off' | 'warn' | 'enforce';

export interface GroundingResult {
  scenes: SceneBoundary[];
  dropped: GroundingDrop[];
  disabled: boolean;
  /** warn 模式下命中的无据引用（未删除，只记录） */
  warned: GroundingDrop[];
  mode: GroundingMode;
}

/**
 * 默认 warn：只记录不删除。
 *
 * 为什么默认不删：实测误杀率不低——「二长老/三长老」所在章只写「长老」、
 * 「萧薰儿」所在章只写「少女」、「白爱玲」所在章写「母亲」，名字一字不差匹配不到，
 * 但人都确实在场。删除会把真实出场抹掉，而漏挡一个幻觉只是少一次纠正。
 * 需要强拦时设 `SCENE_CHARACTER_GROUNDING=enforce`，并接受上述误杀。
 */
function resolveMode(): GroundingMode {
  const raw = process.env.SCENE_CHARACTER_GROUNDING;
  if (raw === 'off') return 'off';
  if (raw === 'enforce') return 'enforce';
  return 'warn';
}

/** 名字是否在本章原文有据（精确 → 别名 → 关系称谓拆分） */
export function hasChapterEvidence(name: string, terms: string[], chapterText: string): boolean {
  if (!chapterText) return true; // 拿不到原文时放行，避免误删
  for (const term of terms) {
    if (term && chapterText.includes(term)) return true;
  }
  // 关系称谓：方晓语父亲 ↔ 「方晓语的父亲」
  const suffix = name.match(RELATION_SUFFIX)?.[1];
  if (suffix) {
    const head = name.slice(0, name.length - suffix.length);
    if (head && chapterText.includes(head) && chapterText.includes(suffix)) return true;
  }
  // 含「的」的复合名：方晓语的父亲
  if (name.includes('的')) {
    const parts = name.split('的').filter(Boolean);
    if (parts.length > 1 && parts.every((p) => chapterText.includes(p))) return true;
  }
  return false;
}

export function groundSceneCharacters(
  scenes: SceneBoundary[],
  characters: RawCharacter[],
  chapterTexts: string[],
): GroundingResult {
  const mode = resolveMode();
  if (mode === 'off') {
    return { scenes, dropped: [], disabled: true, warned: [], mode };
  }

  const termsByName = new Map<string, string[]>();
  for (const character of characters) {
    termsByName.set(character.name, [character.name, ...(character.aliases ?? [])].filter(Boolean));
  }

  const dropped: GroundingDrop[] = [];
  const warned: GroundingDrop[] = [];
  const next = scenes.map((scene) => {
    const chapterText = chapterTexts[scene.chapterIndex] ?? '';
    const kept: string[] = [];
    for (const name of scene.keyCharacterNames ?? []) {
      const terms = termsByName.get(name) ?? [name];
      if (hasChapterEvidence(name, terms, chapterText)) {
        kept.push(name);
      } else {
        (mode === 'enforce' ? dropped : warned).push({
          sceneIndex: scene.sceneIndex,
          chapterIndex: scene.chapterIndex,
          name,
        });
        // warn 模式保留原引用，只记录
        if (mode === 'warn') kept.push(name);
      }
    }
    if (kept.length === scene.keyCharacterNames?.length) return scene;
    return { ...scene, keyCharacterNames: kept };
  });

  return { scenes: next, dropped, disabled: false, warned, mode };
}
