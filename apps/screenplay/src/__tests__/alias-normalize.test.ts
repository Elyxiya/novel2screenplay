import { describe, it, expect } from 'vitest';
import type { RawCharacter, SceneBoundary } from '@novel/contracts/pipeline';
import { normalizeSceneAliases, resolveAliasCandidate } from '@/lib/pipeline/alias-normalize';

function character(name: string, aliases: string[] = []): RawCharacter {
  return { name, aliases, personalityTags: [], description: '', isMajor: false, sourceChapterIndex: 0 };
}
function scene(names: string[]): SceneBoundary {
  return {
    sceneIndex: 0,
    chapterIndex: 0,
    startParagraph: 0,
    endParagraph: 1,
    originalStartOffset: 0,
    originalEndOffset: 0,
    draftSlugline: '',
    keyCharacterNames: names,
    summary: '',
  };
}

describe('resolveAliasCandidate —— 只在唯一时合并', () => {
  const card = [character('摩根·狄福尔特'), character('萧薰儿'), character('二长老'), character('三长老')];

  it('简称 → 全称（前缀）', () => {
    expect(resolveAliasCandidate('摩根', card)).toBe('摩根·狄福尔特');
  });

  it('异体字（同长、首字同、仅一字之差）', () => {
    expect(resolveAliasCandidate('萧熏儿', card)).toBe('萧薰儿');
  });

  it('候选不唯一 → 放弃（二长老/三长老 都与「长老」相关但首字不同，不会误并）', () => {
    expect(resolveAliasCandidate('长老', card)).toBeNull();
  });

  it('无匹配 → null', () => {
    expect(resolveAliasCandidate('裂须海盗头子', card)).toBeNull();
  });

  it('已登记的名字不参与（返回 null 交给上层跳过）', () => {
    expect(resolveAliasCandidate('萧薰儿', card)).toBeNull();
  });
});

describe('normalizeSceneAliases', () => {
  const card = [character('摩根·狄福尔特'), character('萧薰儿', ['薰儿'])];

  it('改写未登记标签并去重', () => {
    const result = normalizeSceneAliases([scene(['摩根', '摩根·狄福尔特'])], card);
    expect(result.scenes[0].keyCharacterNames).toEqual(['摩根·狄福尔特']);
    expect(result.merged).toEqual([{ from: '摩根', to: '摩根·狄福尔特', count: 1 }]);
    expect(result.changed).toBe(1);
  });

  it('无候选时不动', () => {
    const result = normalizeSceneAliases([scene(['裂须海盗头子'])], card);
    expect(result.scenes[0].keyCharacterNames).toEqual(['裂须海盗头子']);
    expect(result.changed).toBe(0);
  });

  it('幂等：二次应用不再变化', () => {
    const once = normalizeSceneAliases([scene(['摩根'])], card);
    const twice = normalizeSceneAliases(once.scenes, card);
    expect(twice.changed).toBe(0);
  });
});
