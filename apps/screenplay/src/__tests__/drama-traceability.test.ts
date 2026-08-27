import { describe, it, expect } from 'vitest';
import type { Screenplay } from '@novel/contracts/screenplay';
import { serializeDramaToYaml, safeParseDramaFromYaml } from '@novel/contracts/serializers';
import { dramatize } from '@/lib/drama/dramatize';

/** 构造最小完整剧本：2 个场景，各 1 对白，用于验证分镜逐级溯源 */
function makeScreenplay(): Screenplay {
  return {
    formatVersion: 'novel2screenplay-v1',
    metadata: {
      title: '溯源测试小说改编',
      author: '作者A',
      sourceNovel: '溯源测试小说',
      version: '1.0.0',
      createdAt: '2026-08-03T09:00:00.000Z',
      totalScenes: 2,
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
        content: [{ type: 'dialogue', characterId: 'char_1', line: '你终于来了。', sourceRefs: [] }],
        summary: '林晓在客厅等待来人',
        sourceChapterRange: [0, 0],
      },
      {
        sceneNumber: 2,
        slugline: '外景. 街道 - 日',
        timeOfDay: 'morning',
        locationId: 'loc_1',
        characterIds: ['char_1'],
        content: [{ type: 'dialogue', characterId: 'char_1', line: '我们走吧。', sourceRefs: [] }],
        summary: '',
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

describe('drama 溯源（分镜 → 剧本场景 → 小说）', () => {
  it('每个镜头都携带 sceneNumber，且与来源剧本场景对应', () => {
    const drama = dramatize(makeScreenplay(), {
      sourceScreenplayId: 'job_123',
      sourceNovelId: 'novel_1',
      sourceNovelTitle: '溯源测试小说',
    });

    expect(drama.shots.length).toBeGreaterThan(0);
    for (const shot of drama.shots) {
      expect(typeof shot.sceneNumber).toBe('number');
      expect(shot.sceneNumber).toBeGreaterThan(0);
    }
    // 镜头按场景归属：每场景先出定场镜头，再出对白镜
    expect(drama.shots[0].sceneNumber).toBe(1); // 场景1 定场
    expect(drama.shots[1].sceneNumber).toBe(1); // 场景1 对白
    expect(drama.shots[2].sceneNumber).toBe(2); // 场景2 定场
    expect(drama.shots[3].sceneNumber).toBe(2); // 场景2 对白
  });

  it('metadata 携带完整 source 溯源字段', () => {
    const drama = dramatize(makeScreenplay(), {
      title: '短剧标题',
      sourceScreenplayId: 'job_123',
      sourceNovelId: 'novel_1',
      sourceNovelTitle: '溯源测试小说',
    });

    expect(drama.metadata.sourceScreenplayId).toBe('job_123');
    expect(drama.metadata.sourceNovelId).toBe('novel_1');
    expect(drama.metadata.sourceNovelTitle).toBe('溯源测试小说');
  });

  it('序列化/反序列化后镜头 sceneNumber 与 source 溯源字段保持', () => {
    const drama = dramatize(makeScreenplay(), {
      sourceScreenplayId: 'job_123',
      sourceNovelId: 'novel_1',
      sourceNovelTitle: '溯源测试小说',
    });

    const yaml = serializeDramaToYaml(drama);
    const parsed = safeParseDramaFromYaml(yaml);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.metadata.sourceScreenplayId).toBe('job_123');
    expect(parsed.data.metadata.sourceNovelId).toBe('novel_1');
    expect(parsed.data.metadata.sourceNovelTitle).toBe('溯源测试小说');
    expect(parsed.data.shots.map(s => s.sceneNumber)).toEqual(
      drama.shots.map(s => s.sceneNumber),
    );
  });

  it('每个镜头可推导出「分镜 → 剧本场景」溯源跳转 URL', () => {
    const drama = dramatize(makeScreenplay(), {
      sourceScreenplayId: 'job_123',
      sourceNovelId: 'novel_1',
    });

    for (const shot of drama.shots) {
      const url = `/result/${drama.metadata.sourceScreenplayId}?scene=${shot.sceneNumber}`;
      expect(url).toBe(`/result/job_123?scene=${shot.sceneNumber}`);
    }
  });

  it('sourceNovelId 缺省为 null，sourceNovelTitle 缺省为空串（契约容错）', () => {
    const drama = dramatize(makeScreenplay(), { sourceScreenplayId: 'job_123' });
    expect(drama.metadata.sourceNovelId).toBeNull();
    expect(drama.metadata.sourceNovelTitle).toBe('');
  });
});