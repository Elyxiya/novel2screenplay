import { describe, it, expect } from 'vitest';
import type { Screenplay } from '@novel/contracts/screenplay';
import { dramatize } from './dramatize';

/** 构造最小完整剧本：1 个场景，1 角色、1 地点、1 对白 + 1 动作块 */
function makeScreenplay(): Screenplay {
  return {
    formatVersion: 'novel2screenplay-v1',
    metadata: {
      title: '测试小说改编',
      author: '作者A',
      sourceNovel: '测试小说',
      version: '1.0.0',
      createdAt: '2026-08-03T09:00:00.000Z',
      totalScenes: 1,
      totalCharacters: 1,
      totalLocations: 1,
    },
    characters: [
      {
        characterId: 'char_1',
        name: '林晓',
        aliases: [],
        personalityTags: [],
        description: '',
        isMajor: true,
        sourceRef: { chapterIndex: 0, paragraphIndex: 0, excerpt: '' },
      },
    ],
    locations: [
      {
        locationId: 'loc_1',
        name: '客厅',
        type: 'interior',
        description: '',
        sourceRef: { chapterIndex: 0, paragraphIndex: 0, excerpt: '' },
      },
    ],
    scenes: [
      {
        sceneNumber: 1,
        slugline: '内景. 客厅 - 夜',
        timeOfDay: 'night',
        locationId: 'loc_1',
        characterIds: ['char_1'],
        content: [
          {
            type: 'dialogue',
            characterId: 'char_1',
            line: '你终于来了，我等了你很久很久。',
            direction: '转身看向门口',
            sourceRefs: [],
          },
          {
            type: 'action',
            description: '林晓转身走向门口，脚步声在空荡的客厅里回响，她缓缓伸出手握住了门把手。',
            sourceRefs: [],
          },
        ],
        summary: '林晓在客厅等待来人',
        sourceChapterRange: [0, 0],
      },
    ],
    analytics: {
      totalWords: 80,
      dialoguePercentage: 60,
      actionPercentage: 40,
      avgSceneLength: 80,
      longestScene: 80,
      shortestScene: 80,
    },
  };
}

describe('dramatize 剧本 → 短剧分镜', () => {
  it('对白块 + 动作块各产出镜头，溯源字段正确', () => {
    const drama = dramatize(makeScreenplay(), {
      title: '测试短剧',
      sourceScreenplayId: 'job_123',
      sourceNovelId: 'novel_1',
      sourceNovelTitle: '测试小说',
      now: new Date('2026-08-03T10:00:00.000Z'),
    });

    // 1 对白 + 1 动作（动作 40 字 ≤ 100 字不拆分）→ 2 镜头
    expect(drama.shots).toHaveLength(2);
    expect(drama.shots[0].shotId).toBe('shot_1');
    expect(drama.shots[1].shotId).toBe('shot_2');
    expect(drama.shots[1].shotNumber).toBe(2);

    // 溯源链
    expect(drama.metadata.sourceScreenplayId).toBe('job_123');
    expect(drama.metadata.sourceNovelId).toBe('novel_1');
    expect(drama.metadata.sourceNovelTitle).toBe('测试小说');
    expect(drama.shots.every(s => s.sceneNumber === 1)).toBe(true);
  });

  it('对白镜头：景别按角色数推断（1 人 → 近景），说话人映射角色名', () => {
    const drama = dramatize(makeScreenplay(), { sourceScreenplayId: 'job_123' });
    const dialogueShot = drama.shots[0];
    expect(dialogueShot.shotType).toBe('close-up');
    expect(dialogueShot.speaker).toBe('林晓');
    expect(dialogueShot.dialogue).toContain('你终于来了');
  });

  it('对白时长按 4 字/秒估算，至少 3 秒', () => {
    const drama = dramatize(makeScreenplay(), { sourceScreenplayId: 'job_123' });
    const line = drama.shots[0].dialogue;
    const expected = Math.max(3, Math.ceil(line.length / 4));
    expect(drama.shots[0].durationSec).toBe(expected);
  });

  it('动作镜头：超长描述（>100 字）拆分为多镜', () => {
    const sp = makeScreenplay();
    // 动作描述 250 字 > 100 字/镜 → 拆 3 镜
    sp.scenes[0].content = [{ type: 'action', description: '林晓'.repeat(125), sourceRefs: [] }]; // 250 字
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    expect(drama.shots).toHaveLength(3);
  });

  it('动作镜头：描述含"走/追"等运动词时运镜为跟移', () => {
    const sp = makeScreenplay();
    sp.scenes[0].content = [{ type: 'action', description: '林晓转身快速跑向门口。', sourceRefs: [] }];
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    expect(drama.shots[0].cameraMove).toBe('track');
  });

  it('空场景兜底：至少产出 1 个 wide 镜头', () => {
    const sp = makeScreenplay();
    sp.scenes[0].content = [];
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    expect(drama.shots).toHaveLength(1);
    expect(drama.shots[0].shotType).toBe('wide');
    expect(drama.shots[0].notes).toBe('空场景兜底镜头');
  });

  it('metadata 统计正确：totalShots / totalScenes', () => {
    const drama = dramatize(makeScreenplay(), { sourceScreenplayId: 'job_123' });
    expect(drama.metadata.totalShots).toBe(2);
    expect(drama.metadata.totalScenes).toBe(1);
    expect(drama.formatVersion).toBe('novel2drama-v1');
  });

  it('两角色场景对白镜头 → two-shot，多角色 → medium', () => {
    const sp = makeScreenplay();
    sp.characters.push({
      characterId: 'char_2',
      name: '陈默',
      aliases: [],
      personalityTags: [],
      description: '',
      isMajor: true,
      sourceRef: { chapterIndex: 0, paragraphIndex: 0, excerpt: '' },
    });
    sp.scenes[0].characterIds = ['char_1', 'char_2'];
    const twoShot = dramatize(sp, { sourceScreenplayId: 'job_123' });
    expect(twoShot.shots[0].shotType).toBe('two-shot');

    sp.characters.push({
      characterId: 'char_3',
      name: '路人',
      aliases: [],
      personalityTags: [],
      description: '',
      isMajor: false,
      sourceRef: { chapterIndex: 0, paragraphIndex: 0, excerpt: '' },
    });
    sp.scenes[0].characterIds = ['char_1', 'char_2', 'char_3'];
    const medium = dramatize(sp, { sourceScreenplayId: 'job_123' });
    expect(medium.shots[0].shotType).toBe('medium');
  });

  it('跨场景镜号全局连续', () => {
    const sp = makeScreenplay();
    // 再追加一个场景（1 对白）
    sp.scenes.push({
      sceneNumber: 2,
      slugline: '外景. 街道 - 日',
      timeOfDay: 'morning',
      locationId: 'loc_1',
      characterIds: ['char_1'],
      content: [{ type: 'dialogue', characterId: 'char_1', line: '走吧。', sourceRefs: [] }],
      summary: '',
    });
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    expect(drama.shots).toHaveLength(3);
    expect(drama.shots.map(s => s.shotNumber)).toEqual([1, 2, 3]);
    expect(drama.shots[2].sceneNumber).toBe(2);
  });
});
