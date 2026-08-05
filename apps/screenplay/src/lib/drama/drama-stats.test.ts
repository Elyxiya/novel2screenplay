import { describe, it, expect } from 'vitest';
import type { Drama } from '../schema/drama.schema';
import { computeDramaStats, formatDuration } from './drama-stats';

/** 构造最小完整分镜：2 个镜头（对白+动作混合 / 纯动作） */
function makeDrama(): Drama {
  return {
    formatVersion: 'novel2drama-v1',
    metadata: {
      title: '测试分镜',
      sourceScreenplayId: 'job_1',
      sourceNovelTitle: '',
      sourceNovelId: null,
      version: '1.0.0',
      createdAt: '2026-08-03T09:00:00.000Z',
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
        cameraMove: 'dolly-in',
        durationSec: 5,
        dialogue: '你终于来了。',
        speaker: '林晓',
        visual: '特写林晓面部',
        action: '林晓转身',
      },
      {
        shotId: 'shot_2',
        shotNumber: 2,
        sceneNumber: 1,
        slugline: '内景. 客厅 - 夜',
        shotType: 'wide',
        cameraMove: 'static',
        durationSec: 8,
        dialogue: '',
        visual: '全景客厅',
        action: '两人对峙，空气凝滞。',
      },
    ],
  };
}

describe('computeDramaStats', () => {
  const stats = computeDramaStats(makeDrama());

  it('累计总时长', () => {
    expect(stats.totalDurationSec).toBe(13);
  });

  it('镜头类型分类正确（1 混合 + 1 纯动作）', () => {
    expect(stats.dialogueShots).toBe(0);
    expect(stats.actionShots).toBe(1);
    expect(stats.mixedShots).toBe(1);
  });

  it('字数统计正确（含标点）', () => {
    // 台词「你终于来了。」= 6 字；动作「林晓转身」+「两人对峙，空气凝滞。」= 14 字
    expect(stats.dialogueChars).toBe(6);
    expect(stats.actionChars).toBe(14);
  });

  it('景别分布带中文标签（count 相同时顺序不敏感）', () => {
    expect(stats.shotTypeDist).toHaveLength(2);
    expect(stats.shotTypeDist).toEqual(expect.arrayContaining([
      { type: 'close-up', label: '近景', count: 1 },
      { type: 'wide', label: '远景', count: 1 },
    ]));
  });

  it('运镜分布带中文标签（count 相同时顺序不敏感）', () => {
    expect(stats.cameraDist).toHaveLength(2);
    expect(stats.cameraDist).toEqual(expect.arrayContaining([
      { move: 'dolly-in', label: '推', count: 1 },
      { move: 'static', label: '固定', count: 1 },
    ]));
  });
});

describe('formatDuration', () => {
  it('不足 1 分钟只显示秒', () => {
    expect(formatDuration(45)).toBe('45 秒');
  });

  it('超过 1 分钟显示分秒', () => {
    expect(formatDuration(125)).toBe('2 分 5 秒');
  });
});
