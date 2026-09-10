/**
 * 同名/近名冲突预警（FIX-14 / D-11）——归并决策**前**的确定性候选列表，供人工复核。
 *
 * 纪律：**只预警、不裁决**。同名跨章通常是同一人（正常归并），本模块输出的只是
 * "值得人工看一眼"的信号；不做自动合并/拆分，避免把模型的不确定性换成规则的武断。
 *
 * 三类信号（全部确定性）：
 * 1. alias-collision   同一别名指向多个候选实体，或别名撞上他人主名；
 * 2. circular-alias    循环别名（A 的别名是 B，B 的别名是 A）；
 * 3. far-apart-same-name 同名候选跨章 ≥ 阈值，且各自标签非空但**无交集**（语境反差大）。
 */

export type NameConflictKind = 'alias-collision' | 'circular-alias' | 'far-apart-same-name';

export interface NameConflictCandidate {
  kind: NameConflictKind;
  names: string[];
  chapters: number[];
  message: string;
}

/** 归并输入的最小形状（与 phase1-reduce 的 FlatCharacter 结构兼容） */
export interface ConflictCharLike {
  name: string;
  aliases: string[];
  personalityTags: string[];
  description: string;
  isMajor: boolean;
  sourceChapterIndex: number;
}

interface EntityAgg {
  names: Set<string>;
  aliases: Set<string>;
  chapters: Set<number>;
  entries: ConflictCharLike[];
}

export function detectNameConflicts(
  chars: ConflictCharLike[],
  opts: { farApartThreshold?: number } = {},
): NameConflictCandidate[] {
  const threshold = opts.farApartThreshold ?? 30;
  const conflicts: NameConflictCandidate[] = [];

  // 按主名聚合实体
  const entities = new Map<string, EntityAgg>();
  for (const c of chars) {
    const agg = entities.get(c.name) ?? { names: new Set([c.name]), aliases: new Set<string>(), chapters: new Set<number>(), entries: [] };
    for (const a of c.aliases ?? []) agg.aliases.add(a);
    agg.chapters.add(c.sourceChapterIndex);
    agg.entries.push(c);
    entities.set(c.name, agg);
  }

  const chaptersOf = (...names: string[]): number[] => {
    const set = new Set<number>();
    for (const n of names) for (const ch of entities.get(n)?.chapters ?? []) set.add(ch);
    return [...set].sort((a, b) => a - b);
  };

  // ① alias-collision：token（别名或主名）被多个实体占用
  const tokenOwner = new Map<string, Set<string>>();
  for (const [entName, agg] of entities) {
    for (const a of agg.aliases) {
      const owners = tokenOwner.get(a) ?? new Set<string>();
      owners.add(entName);
      tokenOwner.set(a, owners);
    }
  }
  for (const [token, owners] of tokenOwner) {
    const involved = new Set(owners);
    if (entities.has(token)) involved.add(token); // 别名撞他人主名
    if (involved.size > 1) {
      conflicts.push({
        kind: 'alias-collision',
        names: [...involved],
        chapters: chaptersOf(...involved),
        message: `别名「${token}」被多个候选共用或与他者主名冲突（${[...involved].join(' × ')}）——需人工确认是否同一人`,
      });
    }
  }

  // ② circular-alias
  for (const [entName, agg] of entities) {
    for (const a of agg.aliases) {
      const other = entities.get(a);
      if (other && other.aliases.has(entName) && a !== entName && entName < a) {
        conflicts.push({
          kind: 'circular-alias',
          names: [entName, a],
          chapters: chaptersOf(entName, a),
          message: `循环别名：「${entName}」的别名是「${a}」，而「${a}」的别名又是「${entName}」`,
        });
      }
    }
  }

  // ③ far-apart-same-name：同名跨章 ≥ 阈值 且 标签均非空且无交集
  for (const [name, agg] of entities) {
    if (agg.entries.length < 2) continue;
    const chs = [...agg.chapters].sort((a, b) => a - b);
    const gap = chs[chs.length - 1] - chs[0];
    if (gap < threshold) continue;
    const tagSets = agg.entries.map((e) => new Set(e.personalityTags ?? []));
    if (!tagSets.every((s) => s.size > 0)) continue;
    const inter = [...tagSets[0]].filter((t) => tagSets.slice(1).every((s) => s.has(t)));
    if (inter.length > 0) continue;
    conflicts.push({
      kind: 'far-apart-same-name',
      names: [name],
      chapters: chs,
      message: `同名「${name}」候选跨越 ${gap} 章（第 ${chs[0]}–${chs[chs.length - 1]} 章）且标签无交集（${tagSets.map((s) => [...s].join('/')).join(' vs ')}）——需人工确认是否同名不同人`,
    });
  }

  return conflicts;
}
