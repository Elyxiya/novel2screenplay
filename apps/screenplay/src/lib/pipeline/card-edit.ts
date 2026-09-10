/**
 * 设定卡编辑 → 失效集计算（B-03）
 *
 * 语义：用户在创作台编辑全局设定卡后，只对"受影响的场景"局部重转，而不是全量重跑。
 * 失效规则（确定性，保守取大——宁可多转一个场景，不可漏）：
 * - **主角（isMajor）相关变化 → 全部场景失效**（主角卡常驻注入每个场景）；
 * - 配角（次要）变化 → 仅 keyCharacterNames 命中该角色（含新旧别名）的场景失效；
 * - open threads 变化 → 覆盖其章节区间的场景失效；
 * - 滚动摘要变化 → 章节号 **大于** 该章的场景失效（摘要注入的是"前 N 章"）。
 * 纯函数、零 LLM，可直接单测。
 */
import type { RawCharacter, SceneBoundary, SettingCard } from '@novel/contracts/pipeline';

export interface CharacterDiff {
  changedMajors: string[];
  changedMinors: string[];
  addedMajors: string[];
  addedMinors: string[];
  removedMajors: string[];
  removedMinors: string[];
  /** 次要变化匹配用 token（新旧名 + 双方别名） */
  minorMatchTokens: string[];
  /** 是否存在主角维度变化（决定全量失效） */
  touchedMajor: boolean;
}

export interface SettingCardDiff {
  /** open threads 的 (start,end) 变化窗口（章节，end 缺省=至结尾） */
  threadWindows: Array<{ startChapterIndex: number; endChapterIndex?: number }>;
  /** 摘要文本变化的章节 */
  summariesChangedChapters: number[];
}

function signature(c: RawCharacter): string {
  return JSON.stringify({
    aliases: [...(c.aliases ?? [])].sort(),
    personalityTags: [...(c.personalityTags ?? [])].sort(),
    description: c.description ?? '',
    isMajor: c.isMajor,
  });
}

export function diffCharacters(oldChars: RawCharacter[], newChars: RawCharacter[]): CharacterDiff {
  const oldByName = new Map(oldChars.map((c) => [c.name, c]));
  const newByName = new Map(newChars.map((c) => [c.name, c]));

  const changedMajors: string[] = [];
  const changedMinors: string[] = [];
  const addedMajors: string[] = [];
  const addedMinors: string[] = [];
  const removedMajors: string[] = [];
  const removedMinors: string[] = [];
  const minorMatchTokens = new Set<string>();

  const addTokens = (c?: RawCharacter) => {
    if (!c) return;
    minorMatchTokens.add(c.name);
    for (const a of c.aliases ?? []) minorMatchTokens.add(a);
  };

  for (const [name, nw] of newByName) {
    const ow = oldByName.get(name);
    if (!ow) {
      (nw.isMajor ? addedMajors : addedMinors).push(name);
      if (!nw.isMajor) addTokens(nw);
      continue;
    }
    if (signature(ow) !== signature(nw)) {
      const majorSide = Boolean(ow.isMajor) || Boolean(nw.isMajor);
      (majorSide ? changedMajors : changedMinors).push(name);
      if (!majorSide) {
        addTokens(ow);
        addTokens(nw);
      }
    }
  }
  for (const [name, ow] of oldByName) {
    if (!newByName.has(name)) {
      (ow.isMajor ? removedMajors : removedMinors).push(name);
      if (!ow.isMajor) addTokens(ow);
    }
  }

  return {
    changedMajors, changedMinors, addedMajors, addedMinors, removedMajors, removedMinors,
    minorMatchTokens: [...minorMatchTokens],
    touchedMajor:
      changedMajors.length + addedMajors.length + removedMajors.length > 0,
  };
}

export function diffSettingCard(oldCard?: SettingCard, newCard?: SettingCard): SettingCardDiff {
  const threadKey = (t: SettingCard['openThreads'][number]) => `${t.title}|${t.startChapterIndex}|${t.endChapterIndex ?? '∞'}`;
  const oldThreads = new Set((oldCard?.openThreads ?? []).map(threadKey));
  const newThreads = new Set((newCard?.openThreads ?? []).map(threadKey));
  const threadWindows: SettingCardDiff['threadWindows'] = [];
  const pushWindow = (t: SettingCard['openThreads'][number]) => {
    // 变化窗口向外扩一章（保守：边界章可能引用该线索）
    threadWindows.push({
      startChapterIndex: Math.max(0, t.startChapterIndex - 1),
      endChapterIndex: t.endChapterIndex === undefined ? undefined : t.endChapterIndex + 1,
    });
  };
  for (const t of newCard?.openThreads ?? []) if (!oldThreads.has(threadKey(t))) pushWindow(t);
  for (const t of oldCard?.openThreads ?? []) if (!newThreads.has(threadKey(t))) pushWindow(t);

  const oldSummaries = new Map((oldCard?.chapterSummaries ?? []).map((s) => [s.chapterIndex, s.summary]));
  const summariesChangedChapters: number[] = [];
  for (const s of newCard?.chapterSummaries ?? []) {
    if (oldSummaries.get(s.chapterIndex) !== s.summary) summariesChangedChapters.push(s.chapterIndex);
  }
  for (const [ch] of oldSummaries) {
    if (!(newCard?.chapterSummaries ?? []).some((s) => s.chapterIndex === ch)) summariesChangedChapters.push(ch);
  }

  return { threadWindows, summariesChangedChapters };
}

/** 失效集：返回需重转的 sceneNumber 列表（升序去重） */
export function computeInvalidatedScenes(
  scenes: SceneBoundary[],
  charDiff: CharacterDiff,
  cardDiff: SettingCardDiff,
): number[] {
  const invalidated = new Set<number>();

  if (charDiff.touchedMajor) {
    for (const s of scenes) invalidated.add(s.sceneIndex);
    return [...invalidated].sort((a, b) => a - b);
  }

  const minorTokens = new Set(charDiff.minorMatchTokens);
  for (const s of scenes) {
    if ((s.keyCharacterNames ?? []).some((n) => minorTokens.has(n))) invalidated.add(s.sceneIndex);
    if (cardDiff.threadWindows.some((w) => s.chapterIndex >= w.startChapterIndex && (w.endChapterIndex === undefined || s.chapterIndex <= w.endChapterIndex))) {
      invalidated.add(s.sceneIndex);
    }
    if (cardDiff.summariesChangedChapters.some((ch) => s.chapterIndex > ch)) invalidated.add(s.sceneIndex);
  }
  return [...invalidated].sort((a, b) => a - b);
}
