import { describe, it, expect, afterEach } from 'vitest';
import type { RawCharacter, SceneBoundary } from '@novel/contracts/pipeline';
import {
  groundSceneCharacters,
  hasChapterEvidence,
} from '@/lib/pipeline/scene-character-grounding';

function character(name: string, aliases: string[] = []): RawCharacter {
  return {
    name,
    aliases,
    personalityTags: [],
    description: '',
    isMajor: false,
    sourceChapterIndex: 0,
  };
}

function scene(sceneIndex: number, chapterIndex: number, names: string[]): SceneBoundary {
  return {
    sceneIndex,
    chapterIndex,
    startParagraph: 0,
    endParagraph: 1,
    originalStartOffset: 0,
    originalEndOffset: 0,
    draftSlugline: '',
    keyCharacterNames: names,
    summary: '',
  };
}

afterEach(() => {
  delete process.env.SCENE_CHARACTER_GROUNDING;
});

describe('hasChapterEvidence —— 原文有据的三种写法', () => {
  it('精确名字', () => {
    expect(hasChapterEvidence('豆豆', ['豆豆'], '豆豆笑了。')).toBe(true);
  });

  it('别名（萧薰儿 / 熏儿）', () => {
    expect(hasChapterEvidence('萧薰儿', ['萧薰儿', '熏儿'], '熏儿笑了。')).toBe(true);
  });

  it('关系称谓：方晓语父亲 ↔ 原文「方晓语的父亲」', () => {
    expect(hasChapterEvidence('方晓语父亲', ['方晓语父亲'], '哪怕是方晓语的父亲也是一样')).toBe(true);
  });

  it('整章都没有 → 无据', () => {
    expect(hasChapterEvidence('豆豆', ['豆豆'], '白冷叶走了。')).toBe(false);
  });

  it('拿不到原文时放行（避免误删）', () => {
    expect(hasChapterEvidence('豆豆', ['豆豆'], '')).toBe(true);
  });
});

describe('groundSceneCharacters —— 接地校验', () => {
  const characters = [character('白冷叶'), character('豆豆'), character('萧薰儿', ['熏儿'])];
  const chapterTexts = ['白冷叶与豆豆在房间里。', '白冷叶独自走在街上。'];

  it('默认 warn：记录疑似无据但保留引用（避免误杀在场未点名的角色）', () => {
    const result = groundSceneCharacters(
      [scene(0, 0, ['白冷叶', '豆豆']), scene(1, 1, ['白冷叶', '豆豆'])],
      characters,
      chapterTexts,
    );
    expect(result.mode).toBe('warn');
    expect(result.scenes[1].keyCharacterNames).toEqual(['白冷叶', '豆豆']);
    expect(result.warned).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('enforce：剔除跨章串味（豆豆出现在没提到他的第 2 章）', () => {
    process.env.SCENE_CHARACTER_GROUNDING = 'enforce';
    const result = groundSceneCharacters(
      [scene(0, 0, ['白冷叶', '豆豆']), scene(1, 1, ['白冷叶', '豆豆'])],
      characters,
      chapterTexts,
    );
    expect(result.scenes[0].keyCharacterNames).toEqual(['白冷叶', '豆豆']);
    expect(result.scenes[1].keyCharacterNames).toEqual(['白冷叶']);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].name).toBe('豆豆');
  });

  it('别名也算有据', () => {
    const result = groundSceneCharacters([scene(0, 0, ['萧薰儿'])], characters, ['熏儿笑了。']);
    expect(result.warned).toHaveLength(0);
  });

  it('开关关闭时原样返回', () => {
    process.env.SCENE_CHARACTER_GROUNDING = 'off';
    const input = [scene(0, 1, ['豆豆'])];
    const result = groundSceneCharacters(input, characters, chapterTexts);
    expect(result.disabled).toBe(true);
    expect(result.scenes).toBe(input);
  });

  it('幂等：连续两次结果一致', () => {
    process.env.SCENE_CHARACTER_GROUNDING = 'enforce';
    const once = groundSceneCharacters([scene(0, 1, ['白冷叶', '豆豆'])], characters, chapterTexts);
    const twice = groundSceneCharacters(once.scenes, characters, chapterTexts);
    expect(twice.scenes[0].keyCharacterNames).toEqual(once.scenes[0].keyCharacterNames);
    expect(twice.dropped).toHaveLength(0);
  });
});
