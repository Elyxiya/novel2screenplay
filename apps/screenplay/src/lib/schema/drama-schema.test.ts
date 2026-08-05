import { describe, it, expect } from 'vitest';
import { DramaSchema, type Drama } from './drama.schema';
import { serializeDramaToYaml, parseDramaFromYaml, safeParseDramaFromYaml } from './drama-serializer';

function makeDrama(): Drama {
  return {
    formatVersion: 'novel2drama-v1',
    metadata: {
      title: '测试短剧',
      sourceScreenplayId: 'job_123',
      sourceNovelId: 'novel_1',
      sourceNovelTitle: '测试小说',
      version: '1.0.0',
      createdAt: '2026-08-03T10:00:00.000Z',
      totalShots: 2,
      totalScenes: 1,
    },
    shots: [
      {
        shotId: 'shot_1',
        shotNumber: 1,
        sceneNumber: 1,
        slugline: '内景. 客厅 - 夜',
        shotType: 'close-up',
        cameraMove: 'static',
        durationSec: 4,
        dialogue: '你来了。',
        speaker: '林晓',
        visual: '林晓 开口说话',
        action: '',
      },
      {
        shotId: 'shot_2',
        shotNumber: 2,
        sceneNumber: 1,
        slugline: '内景. 客厅 - 夜',
        shotType: 'full',
        cameraMove: 'track',
        durationSec: 6,
        dialogue: '',
        visual: '林晓转身走向门口，脚步声在空荡的客厅里回响。',
        action: '林晓转身走向门口，脚步声在空荡的客厅里回响。',
      },
    ],
  };
}

describe('drama.schema 契约校验', () => {
  it('合法 Drama 通过校验', () => {
    const result = DramaSchema.safeParse(makeDrama());
    expect(result.success).toBe(true);
  });

  it('shotId 必须是 shot_N 格式', () => {
    const drama = makeDrama();
    drama.shots[0].shotId = 'abc';
    const result = DramaSchema.safeParse(drama);
    expect(result.success).toBe(false);
  });

  it('formatVersion 必须是 novel2drama-v1', () => {
    const drama = makeDrama();
    (drama as { formatVersion: string }).formatVersion = 'other-v1';
    const result = DramaSchema.safeParse(drama);
    expect(result.success).toBe(false);
  });

  it('durationSec 必须为正整数', () => {
    const drama = makeDrama();
    (drama.shots[0] as { durationSec: number }).durationSec = 0;
    const result = DramaSchema.safeParse(drama);
    expect(result.success).toBe(false);
  });

  it('shots 不能为空数组', () => {
    const drama = makeDrama();
    drama.shots = [];
    const result = DramaSchema.safeParse(drama);
    expect(result.success).toBe(false);
  });

  it('shotType 枚举约束', () => {
    const drama = makeDrama();
    (drama.shots[0] as { shotType: string }).shotType = 'macro';
    const result = DramaSchema.safeParse(drama);
    expect(result.success).toBe(false);
  });
});

describe('drama-serializer YAML 序列化', () => {
  it('serialize → parse round-trip 保持一致', () => {
    const drama = makeDrama();
    const yaml = serializeDramaToYaml(drama);
    const parsed = parseDramaFromYaml(yaml);
    expect(parsed).toEqual(drama);
    expect(yaml).toContain('formatVersion: novel2drama-v1');
    expect(yaml).toContain('sourceScreenplayId');
  });

  it('safeParse 对非法 YAML 返回错误信息', () => {
    const result = safeParseDramaFromYaml('shots: [bad');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('YAML parse error');
    }
  });

  it('safeParse 对结构非法 YAML 返回 zod 错误', () => {
    const result = safeParseDramaFromYaml('formatVersion: novel2drama-v1\nshots: []');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});
