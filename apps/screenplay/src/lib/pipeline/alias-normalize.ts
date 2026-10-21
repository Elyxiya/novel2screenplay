/**
 * 别名覆盖：把场景标签里的「同一角色的另一种写法」并回角色卡。
 *
 * 背景（实测 10 次运行，23 种未登记标签）：真正需要归一的是
 *   摩根 / 摩根·狄福尔特（简称）、萧熏儿 / 萧薰儿（异体字）、裂须海盗头子 / 艾瑞克（称号）。
 * 前两类可以确定性地合并；第三类需要别名表，不做自动推断。
 *
 * 安全准则：**只在候选唯一时合并**，任何歧义一律放弃并留给接地校验告警。
 * 错合并（把两个人物并成一个）比漏合并更难发现，指标上也看不出来。
 */
import type { RawCharacter, SceneBoundary } from '@novel/contracts/pipeline';

/** 同长度、仅一处替换（异体字/同音误写） */
function oneCharSubstitution(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 3) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++diff > 1) return false;
  }
  return diff === 1 && a[0] === b[0];
}

/**
 * 为一个未登记的名字找唯一候选；找不到或候选不唯一都返回 null。
 * 只与**角色名**比对（别名已登记，走到这里的就不会是别名）。
 */
export function resolveAliasCandidate(tag: string, characters: RawCharacter[]): string | null {
  const t = tag.trim();
  if (!t) return null;
  const candidates = new Set<string>();

  for (const c of characters) {
    const n = c.name?.trim();
    if (!n || n === t) continue;
    // 规则 1：简称 / 全称（前缀包含，双方至少 2 字）
    const prefix = (n.length > t.length && n.startsWith(t) && t.length >= 2) ||
      (t.length > n.length && t.startsWith(n) && n.length >= 2);
    if (prefix) {
      candidates.add(n);
      continue;
    }
    // 规则 2：同长、首字同、仅一字之差
    if (oneCharSubstitution(n, t)) candidates.add(n);
  }

  return candidates.size === 1 ? [...candidates][0] : null;
}

export interface AliasMerge {
  from: string;
  to: string;
  count: number;
}

export interface AliasNormalizeResult {
  scenes: SceneBoundary[];
  merged: AliasMerge[];
  changed: number;
}

/** 把场景里未登记的标签按唯一候选改写成卡内规范名 */
export function normalizeSceneAliases(
  scenes: SceneBoundary[],
  characters: RawCharacter[],
): AliasNormalizeResult {
  const known = new Set<string>();
  for (const c of characters) {
    if (c.name) known.add(c.name);
    for (const a of c.aliases ?? []) known.add(a);
  }

  const mergeCount = new Map<string, AliasMerge>();
  let changed = 0;

  const next = scenes.map((scene) => {
    const before = scene.keyCharacterNames ?? [];
    const after = before.map((name) => {
      if (known.has(name)) return name;
      const resolved = resolveAliasCandidate(name, characters);
      if (!resolved) return name;
      const key = `${name}->${resolved}`;
      const cur = mergeCount.get(key) ?? { from: name, to: resolved, count: 0 };
      cur.count += 1;
      mergeCount.set(key, cur);
      return resolved;
    });
    const deduped = [...new Set(after)];
    if (deduped.length === before.length && deduped.every((n, i) => n === before[i])) return scene;
    changed += 1;
    return { ...scene, keyCharacterNames: deduped };
  });

  return { scenes: next, merged: [...mergeCount.values()], changed };
}
