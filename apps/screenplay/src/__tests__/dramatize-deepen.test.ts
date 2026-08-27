import { describe, it, expect } from 'vitest';
import type { Screenplay } from '@novel/contracts/screenplay';
import { dramatize } from '@/lib/drama/dramatize';
import { serializeDramaToYaml, parseDramaFromYaml } from '@novel/contracts/serializers';

function makeScreenplay(overrides: Partial<Screenplay['scenes'][number]> = {}): Screenplay {
  return {
    formatVersion: 'novel2screenplay-v1',
    metadata: {
      title: '深化测试',
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
        content: [],
        summary: '林晓在客厅等待来人',
        sourceChapterRange: [0, 0],
        ...overrides,
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

describe('dramatize 规则增强（深化）', () => {
  /** 非空场景（1 对白），保证定场镜头被产出 */
  const dialogueContent = [
    {
      type: 'dialogue' as const,
      characterId: 'char_1',
      line: '你终于来了。',
      direction: '',
      sourceRefs: [],
    },
  ];

  it('定场镜头：内景 → wide、静态、5s、notes=定场镜头', () => {
    const drama = dramatize(makeScreenplay({ content: dialogueContent }), { sourceScreenplayId: 'job_123' });
    const es = drama.shots[0];
    expect(es.shotType).toBe('wide');
    expect(es.cameraMove).toBe('static');
    expect(es.durationSec).toBe(5);
    expect(es.notes).toBe('定场镜头');
    expect(es.slugline).toContain('客厅');
  });

  it('定场镜头：外景 → extreme-wide（大远景）', () => {
    const sp = makeScreenplay({ content: dialogueContent });
    sp.locations[0] = { ...sp.locations[0], type: 'exterior' };
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    expect(drama.shots[0].shotType).toBe('extreme-wide');
  });

  it('动作块按语义断句合并到 ≤100 字/镜，不跨句硬切', () => {
    // 每句 23 字 × 10 = 230 字；贪心按整句合并，100/23≈4 句/块 → 3 组（4/4/2）
    const sentence = '林晓缓缓走向窗边，月色清冷，脚步沉稳而坚定。';
    const description = sentence.repeat(10);
    const sp = makeScreenplay({
      content: [
        { type: 'action', description, sourceRefs: [] },
      ],
    });
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    // 1 定场 + 3 动作组
    expect(drama.shots).toHaveLength(4);
    const actionParts = drama.shots.slice(1);
    for (const part of actionParts) {
      expect(part.action.length).toBeLessThanOrEqual(100);
      // 拼接后与原始描述一致（未丢字符、未跨句硬切）
      expect(part.action.split('').includes('。')).toBe(true);
    }
    // 每个动作块都是整句拼接（句末以 。结尾）
    expect(actionParts.every(p => p.action.endsWith('。'))).toBe(true);
    // 总字数守恒
    const joined = actionParts.map(p => p.action).join('');
    expect(joined).toBe(description);
  });

  it('对白情绪推导：direction 含「怒」→ 愤怒/压抑、运镜推近、特写', () => {
    const sp = makeScreenplay({
      content: [
        {
          type: 'dialogue',
          characterId: 'char_1',
          line: '你竟敢骗我！',
          direction: '拍案怒喝',
          sourceRefs: [],
        },
      ],
    });
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    const shot = drama.shots[1];
    expect(shot.characterEmotion).toBe('愤怒');
    expect(shot.mood).toBe('压抑');
    expect(shot.cameraMove).toBe('dolly-in');
    expect(shot.shotType).toBe('extreme-close-up');
    expect(shot.subtitle).toBe('你竟敢骗我！');
  });

  it('对白情绪兜底：平静对白 → characterEmotion=平静，mood 回落到场景氛围', () => {
    const sp = makeScreenplay({
      content: [
        {
          type: 'dialogue',
          characterId: 'char_1',
          line: '你终于来了。',
          direction: '',
          sourceRefs: [],
        },
      ],
    });
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    const shot = drama.shots[1];
    expect(shot.characterEmotion).toBe('平静');
    // 场景为夜 → 氛围「静谧」
    expect(shot.mood).toBe('静谧');
  });

  it('动作氛围/音效：打斗动作 → 紧张/刀剑碰撞', () => {
    const sp = makeScreenplay({
      content: [
        {
          type: 'action',
          description: '两人挥刀拼杀，刀剑碰撞，火星四溅。',
          sourceRefs: [],
        },
      ],
    });
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    const shot = drama.shots[1];
    expect(shot.mood).toBe('紧张');
    expect(shot.sound).toBe('刀剑碰撞/破风声');
    expect(shot.shotType).toBe('full');
  });

  it('场景环境音：夜 → 夜虫低鸣；含「雨」→ 雨声淅沥', () => {
    const night = dramatize(makeScreenplay({ content: dialogueContent }), { sourceScreenplayId: 'job_123' });
    expect(night.shots[0].sound).toBe('夜虫低鸣');

    const rainy = makeScreenplay({
      content: dialogueContent,
      slugline: '外景. 街道 - 雨',
      summary: '瓢泼大雨，林晓站在街角',
    });
    const rainyDrama = dramatize(rainy, { sourceScreenplayId: 'job_123' });
    expect(rainyDrama.shots[0].sound).toBe('雨声淅沥');
  });

  it('延续溯源：deep 镜头仍携带 sceneNumber 且可选字段不破坏契约', () => {
    const sp = makeScreenplay({
      content: [
        {
          type: 'dialogue',
          characterId: 'char_1',
          line: '走吧。',
          direction: '',
          sourceRefs: [],
        },
      ],
    });
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    expect(drama.shots.every(s => s.sceneNumber === 1)).toBe(true);
    expect(drama.shots.every(s => s.shotNumber > 0)).toBe(true);
  });
});

describe('dramatize-deepen 兼容性', () => {
  it('旧分镜 YAML（无新增可选字段）仍可正常解析', () => {
    const oldYaml = `formatVersion: novel2drama-v1
metadata:
  title: 旧分镜
  sourceScreenplayId: job_old
  version: 1.0.0
  createdAt: 2026-08-01T08:00:00.000Z
  totalShots: 1
  totalScenes: 1
shots:
  - shotId: shot_1
    shotNumber: 1
    sceneNumber: 1
    slugline: 内景. 客厅 - 夜
    shotType: close-up
    cameraMove: static
    durationSec: 4
    dialogue: 你来了。
    speaker: 林晓
    visual: 林晓 开口说话
    action: ''
`;
    const drama = parseDramaFromYaml(oldYaml);
    expect(drama.shots[0].shotId).toBe('shot_1');
    // 旧数据无这些字段 → 解析后为 undefined（可选字段向后兼容）
    expect(drama.shots[0].mood).toBeUndefined();
    expect(drama.shots[0].sound).toBeUndefined();
    expect(drama.shots[0].characterEmotion).toBeUndefined();
    expect(drama.shots[0].subtitle).toBeUndefined();
  });

  it('新分镜 serialize → parse 往返，新增字段不丢失', () => {
    const sp = makeScreenplay({
      content: [
        {
          type: 'dialogue',
          characterId: 'char_1',
          line: '你竟敢骗我！',
          direction: '拍案怒喝',
          sourceRefs: [],
        },
      ],
    });
    const drama = dramatize(sp, { sourceScreenplayId: 'job_123' });
    const yaml = serializeDramaToYaml(drama);
    const parsed = parseDramaFromYaml(yaml);
    expect(parsed).toEqual(drama);
    expect(yaml).toContain('mood');
    expect(yaml).toContain('subtitle');
  });
});