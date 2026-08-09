/**
 * 质量基准集（P-评估）
 *
 * 内置已知质量档次的剧本样本（golden samples），用于：
 * - 验证 LLM 评估器区分度：高分样本应显著高于低分样本
 * - 回归：修改评估 Prompt/逻辑后确认评分档位不漂移
 * - 手动调参：调整评估器后一键重跑
 *
 * 样本均通过 ScreenplaySchema.parse 校验（保证结构合法）。
 * expectedGrade 与 flow-evaluator 的档位一致：≥85 excellent / ≥70 good / ≥55 fair / 否则 poor。
 */

import { ScreenplaySchema, type Screenplay } from '@novel/contracts/screenplay';

export type ExpectedGrade = 'excellent' | 'good' | 'fair' | 'poor';

export interface BenchmarkSample {
  id: string;
  name: string;
  description: string;
  /** 预期质量档位（用于校验评估器排序） */
  expectedGrade: ExpectedGrade;
  screenplay: Screenplay;
}

type ContentItem = Screenplay['scenes'][number]['content'][number];

const act = (description: string): ContentItem => ({ type: 'action', description, sourceRefs: [] });
const dlg = (characterId: string, line: string): ContentItem => ({
  type: 'dialogue',
  characterId,
  line,
  sourceRefs: [],
});

function scene(n: number, slugline: string, locationId: string, content: ContentItem[]) {
  return { sceneNumber: n, slugline, timeOfDay: 'night' as const, locationId, characterIds: [], content, summary: 'summary', confidence: 0.9 };
}

// ── 样本 1：优秀（完整结构 + 对白平衡 + 引用有效） ──────────────────────
const excellent = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-优秀样本',
    author: 'benchmark',
    sourceNovel: '基准-优秀样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 3,
    totalCharacters: 2,
    totalLocations: 2,
  },
  characters: [
    { characterId: 'char_1', name: '林远', isMajor: true, personalityTags: ['坚毅'], description: '少年剑客' },
    { characterId: 'char_2', name: '苏晚', isMajor: true, personalityTags: ['聪慧'], description: '医者' },
  ],
  locations: [
    { locationId: 'loc_1', name: '山门', type: 'exterior', description: '雾气缭绕的石阶' },
    { locationId: 'loc_2', name: '药庐', type: 'interior', description: '草药香气弥漫' },
  ],
  scenes: [
    scene(1, 'INT. 药庐 - NIGHT', 'loc_2', [
      act('苏晚拨亮油灯，整理案上的药材。'),
      dlg('char_2', '伤势不轻，你这剑法该练了。'),
      dlg('char_1', '练剑不如问你，这毒是谁下的？'),
    ]),
    scene(2, 'EXT. 山门 - NIGHT', 'loc_1', [
      act('林远握剑而立，山风卷起衣角。'),
      dlg('char_1', '苏晚，等我回来。'),
      act('远处火把亮起，脚步声渐近。'),
    ]),
    scene(3, 'INT. 药庐 - NIGHT', 'loc_2', [
      dlg('char_2', '记住，别死在外面。'),
      act('她转身，灯火映着微微发红的眼角。'),
    ]),
  ],
  analytics: {
    totalWords: 260,
    dialoguePercentage: 40,
    actionPercentage: 60,
    avgSceneLength: 86,
    longestScene: 100,
    shortestScene: 70,
  },
});

// ── 样本 2：一般（对白偏少 + 地点细节缺失 + 场景较空） ───────────────────
const fair = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-一般样本',
    author: 'benchmark',
    sourceNovel: '基准-一般样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 2,
    totalCharacters: 2,
    totalLocations: 1,
  },
  characters: [
    { characterId: 'char_1', name: '阿青', isMajor: true, personalityTags: [], description: '' },
    { characterId: 'char_2', name: '掌柜', isMajor: false, personalityTags: [], description: '' },
  ],
  locations: [{ locationId: 'loc_1', name: '客栈', type: 'interior', description: '' }],
  scenes: [
    scene(1, '客栈 - 夜', 'loc_1', [
      act('阿青走进客栈。'),
      dlg('char_1', '来一间房。'),
      act('掌柜递过钥匙。'),
    ]),
    scene(2, '客栈 - 夜', 'loc_1', [
      act('阿青坐在窗前，望着外面。'),
      act('他叹了口气。'),
    ]),
  ],
  analytics: {
    totalWords: 90,
    dialoguePercentage: 15,
    actionPercentage: 85,
    avgSceneLength: 45,
    longestScene: 50,
    shortestScene: 40,
  },
});

// ── 样本 3：差（场景断号 + 角色引用悬空 + 无对白 + 无摘要） ──────────────
const poor = ScreenplaySchema.parse({
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '基准-差样本',
    author: 'benchmark',
    sourceNovel: '基准-差样本',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 2,
    totalCharacters: 1,
    totalLocations: 1,
  },
  characters: [
    { characterId: 'char_1', name: '路人甲', isMajor: true, personalityTags: [], description: '' },
  ],
  locations: [{ locationId: 'loc_1', name: '某处', type: 'abstract', description: '' }],
  scenes: [
    { sceneNumber: 1, slugline: '某处', timeOfDay: 'unknown', locationId: 'loc_1', characterIds: ['char_99'], content: [act('有人走过。')], summary: '' },
    { sceneNumber: 3, slugline: '某处', timeOfDay: 'unknown', locationId: 'loc_1', characterIds: ['char_99'], content: [act('又有人走过。')], summary: '' },
  ],
  analytics: {
    totalWords: 20,
    dialoguePercentage: 0,
    actionPercentage: 100,
    avgSceneLength: 10,
    longestScene: 12,
    shortestScene: 8,
  },
});

export const BENCHMARK_SAMPLES: BenchmarkSample[] = [
  {
    id: 'excellent',
    name: '优秀样本（完整结构 + 对白平衡）',
    description: '3 场景、对白占比 40%、角色/地点引用有效、场景编号连续。预期 ≥85（excellent）。',
    expectedGrade: 'excellent',
    screenplay: excellent,
  },
  {
    id: 'fair',
    name: '一般样本（对白偏少 + 细节缺失）',
    description: '2 场景、对白占比 15%、地点无描述、场景内容单薄。预期 55-84（fair/good 区间）。',
    expectedGrade: 'fair',
    screenplay: fair,
  },
  {
    id: 'poor',
    name: '差样本（断号 + 悬空引用 + 无对白）',
    description: '场景编号断号、角色引用悬空、对白为 0、无摘要。预期 <55（poor）。',
    expectedGrade: 'poor',
    screenplay: poor,
  },
];
