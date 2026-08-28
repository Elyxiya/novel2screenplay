import type { RawCharacter, SceneBoundary, SettingCard } from '@novel/contracts/pipeline';

/**
 * Task 3 的 Phase3 上下文组装纯函数（独立可测）：
 * - 3.1 显式「在场角色名 → char_N」解析，未命中计入占位率；
 * - 3.2 主角卡常驻 + 配角按键、前 N 章滚动摘要、open threads 按章节区间注入。
 * 全部确定性，不依赖 LLM。
 */

export interface CharResolveResult {
  /** 解析成功的 (名字, charId) */
  resolved: Array<{ name: string; charId: string }>;
  /** 别名索引未命中的角色名（将产生占位 stub） */
  unresolved: string[];
  /** 占位率 0..1 = unresolved / total */
  placeholderRate: number;
}

/**
 * 3.1 用别名索引把「在场角色名」解析为 char_N。
 * 未命中名计入占位率（明确测点，供 Task 4 断言消费）。
 * 空输入返回占位率 0（无角色可占位）。
 */
export function resolveKeyCharacters(
  keyCharacterNames: string[],
  aliasIndex: Map<string, string>,
): CharResolveResult {
  const resolved: Array<{ name: string; charId: string }> = [];
  const unresolved: string[] = [];
  for (const name of keyCharacterNames ?? []) {
    const charId = aliasIndex.get(name);
    if (charId) resolved.push({ name, charId });
    else unresolved.push(name);
  }
  const total = (keyCharacterNames ?? []).length;
  return {
    resolved,
    unresolved,
    placeholderRate: total === 0 ? 0 : unresolved.length / total,
  };
}

export interface SceneCharSelection {
  /** 本场景实际注入的角色（增强模式；空则已回退全量） */
  kept: RawCharacter[];
  /** 常驻注入的主角数 */
  majorKept: number;
  /** 按键注入的配角数 */
  keyKept: number;
}

/**
 * 3.2 场景角色选择：
 * - 主角（isMajor=true，数量少）常驻注入所有场景；
 * - 场景 keyCharacterNames 命中的配角按键注入；
 * - 两者皆空时回退全量（兜底防空，保持既有行为语义）。
 */
export function selectSceneCharacters(
  scene: SceneBoundary,
  characters: RawCharacter[],
): SceneCharSelection {
  const byName = new Map<string, RawCharacter>();
  for (const c of characters) {
    byName.set(c.name, c);
    c.aliases.forEach((a) => byName.set(a, c));
  }

  const keptNames = new Set<string>();
  let majorKept = 0;
  for (const c of characters) {
    if (c.isMajor) {
      keptNames.add(c.name);
      majorKept++;
    }
  }

  let keyKept = 0;
  for (const n of scene.keyCharacterNames ?? []) {
    const c = byName.get(n);
    if (c && !c.isMajor && !keptNames.has(c.name)) {
      keptNames.add(c.name);
      keyKept++;
    }
  }

  const kept = characters.filter((c) => keptNames.has(c.name));
  return { kept: kept.length > 0 ? kept : characters, majorKept, keyKept };
}

/**
 * 3.2 前 N 章滚动摘要：取 chapterIndex 之前最多 maxChapters 章的摘要文本。
 * 设定卡缺失返回空串（调用方拼上下文时跳过该段）。
 */
export function buildRollingSummary(
  settingCard: SettingCard | undefined,
  chapterIndex: number,
  maxChapters = 5,
): string {
  if (!settingCard) return '';
  const prev = settingCard.chapterSummaries
    .filter((s) => s.chapterIndex < chapterIndex)
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .slice(-maxChapters);
  return prev.map((s) => `[第 ${s.chapterIndex + 1} 章] ${s.summary}`).join('\n');
}

/**
 * 3.2 open threads 按章节区间注入：start <= 本章 且（未闭合 或 本章 <= end）。
 */
export function buildOpenThreadContext(
  settingCard: SettingCard | undefined,
  chapterIndex: number,
): string {
  if (!settingCard) return '';
  const relevant = settingCard.openThreads.filter(
    (t) =>
      t.startChapterIndex <= chapterIndex &&
      (t.endChapterIndex === undefined || chapterIndex <= t.endChapterIndex),
  );
  return relevant
    .map(
      (t) =>
        `「${t.title}」${t.description}（起于第 ${t.startChapterIndex + 1} 章` +
        (t.endChapterIndex !== undefined
          ? `，止于第 ${t.endChapterIndex + 1} 章）`
          : '，尚未收束）'),
    )
    .join('\n');
}
