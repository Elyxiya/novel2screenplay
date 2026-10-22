/**
 * Phase2 逐章角色上下文：只把「本章原文真的出现」的角色送进提示词。
 *
 * 为什么不再用 `sourceChapterIndex`：
 *   - truncate 路径存的是**原书章号**（如 65），而 Phase2 比较的是切片序号（0–12），
 *     于是过滤永远不命中、每章都回落到全量；
 *   - mapreduce 路径存的是切片序号，但语义是「该角色**首次出现**在本章」，
 *     只看这个会把主角从后续章节的上下文里剔掉（第 5 章可能只剩 1 个路人）。
 *
 * 两种语义都不可靠，所以改成按原文出现判断（与 prompt v2「候选池 = 本章原文」一致）。
 * 一个都没命中时回落到全量：宁可多给，也不要让模型在无角色上下文下盲切。
 */

export interface ChapterCharacterLike {
  name: string;
  aliases?: string[];
}

export interface ChapterCharacterSelection<T> {
  selected: T[];
  /** 是否发生了裁剪（false 表示回落全量或全量本就命中） */
  cropped: boolean;
  /** 本章命中数（0 表示回落到全量） */
  hits: number;
}

export function selectChapterCharacters<T extends ChapterCharacterLike>(
  characters: T[],
  chapterText: string,
): ChapterCharacterSelection<T> {
  const hits = characters.filter((c) => {
    if (c.name && chapterText.includes(c.name)) return true;
    return (c.aliases ?? []).some((a) => a && chapterText.includes(a));
  });

  if (hits.length === 0 || hits.length === characters.length) {
    return { selected: characters, cropped: false, hits: hits.length };
  }
  return { selected: hits, cropped: true, hits: hits.length };
}
