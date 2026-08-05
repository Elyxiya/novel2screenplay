import { describe, it, expect } from 'vitest';
import { ScreenplaySchema, type Screenplay } from '../../../src/lib/schema/screenplay.schema';

const minimalScreenplay: Screenplay = {
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '测试剧本',
    author: '作者',
    sourceNovel: '测试小说',
    version: '1.0.0',
    createdAt: '2026-06-05T10:00:00Z',
    totalScenes: 1,
    totalCharacters: 2,
    totalLocations: 1,
  },
  characters: [
    {
      characterId: 'char_01',
      name: '林墨',
      aliases: ['小林'],
      personalityTags: ['冷静'],
      description: '主角',
      isMajor: true,
    },
    {
      characterId: 'char_02',
      name: '苏晚',
      aliases: [],
      personalityTags: ['温柔'],
      description: '女主角',
      isMajor: true,
    },
  ],
  locations: [
    {
      locationId: 'loc_01',
      name: '青云山顶',
      type: 'exterior',
      description: '险峻山峰',
    },
  ],
  scenes: [
    {
      sceneNumber: 1,
      slugline: '外景. 青云山顶 - 日',
      timeOfDay: 'morning',
      locationId: 'loc_01',
      characterIds: ['char_01', 'char_02'],
      content: [
        {
          type: 'action',
          description: '云雾缭绕的山顶上，林墨负手而立。',
          sourceRefs: [],
        },
        {
          type: 'dialogue',
          characterId: 'char_02',
          line: '你来了。',
          direction: '轻声',
          sourceRefs: [],
        },
      ],
      summary: '林墨与苏晚在山顶相见',
      confidence: 0.95,
    },
  ],
};

describe('ScreenplaySchema', () => {
  it('should validate a minimal valid screenplay', () => {
    const result = ScreenplaySchema.safeParse(minimalScreenplay);
    expect(result.success).toBe(true);
  });

  it('should reject missing required fields', () => {
    const invalid = { ...minimalScreenplay, metadata: { ...minimalScreenplay.metadata, title: '' } };
    const result = ScreenplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid characterId format', () => {
    const invalid = {
      ...minimalScreenplay,
      characters: [{ ...minimalScreenplay.characters[0], characterId: 'invalid' }],
    };
    const result = ScreenplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid locationId format', () => {
    const invalid = {
      ...minimalScreenplay,
      locations: [{ ...minimalScreenplay.locations[0], locationId: 'bad' }],
    };
    const result = ScreenplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject invalid timeOfDay', () => {
    const invalid = {
      ...minimalScreenplay,
      scenes: [{ ...minimalScreenplay.scenes[0], timeOfDay: 'invalid' }],
    };
    const result = ScreenplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept discriminated union for content blocks', () => {
    const result = ScreenplaySchema.safeParse(minimalScreenplay);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scenes[0].content[0].type).toBe('action');
      expect(result.data.scenes[0].content[1].type).toBe('dialogue');
    }
  });

  it('should reject content block with invalid type', () => {
    const invalid = {
      ...minimalScreenplay,
      scenes: [
        {
          ...minimalScreenplay.scenes[0],
          content: [{ type: 'invalid', description: 'test' }],
        },
      ],
    };
    const result = ScreenplaySchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should apply default values', () => {
    const result = ScreenplaySchema.safeParse(minimalScreenplay);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.characters[0].aliases).toEqual(['小林']);
      expect(result.data.scenes[0].timeOfDay).toBe('morning');
    }
  });
});
