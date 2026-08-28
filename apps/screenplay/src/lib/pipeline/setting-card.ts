import type { RawCharacter } from '@novel/contracts/pipeline';

/** 参与别名索引的最小角色形状（name + aliases 足够） */
export type AliasIndexEntry = Pick<RawCharacter, 'name' | 'aliases'>;

/**
 * 从角色列表构建「名字/别名 → charId」索引。
 * 每个角色的 name 与其所有 alias 都映射到同一 charId（与 Phase3 buildCharIdMap 的
 * 编号格式保持一致：char_01, char_02, ...）。供 phase1-reduce 与 Task3 的
 * keyCharacterNames → char_N 解析复用。
 */
export function buildAliasIndex(characters: AliasIndexEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  characters.forEach((c, i) => {
    const id = `char_${String(i + 1).padStart(2, '0')}`;
    map.set(c.name, id);
    c.aliases.forEach((alias) => map.set(alias, id));
  });
  return map;
}

/**
 * 用别名索引解析「在场角色名」→ charId。
 * 未命中返回 undefined（调用方可计入占位率）。
 */
export function resolveNameToCharId(
  aliasIndex: Map<string, string>,
  name: string,
): string | undefined {
  return aliasIndex.get(name);
}
