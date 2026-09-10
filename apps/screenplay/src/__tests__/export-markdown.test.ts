import { describe, it, expect } from 'vitest';
import { serializeToMarkdown, type ScreenplayLike } from '@novel/contracts/serializers';

function fixture(over: Partial<ScreenplayLike> = {}): ScreenplayLike {
  return {
    formatVersion: 'novel2screenplay-v1',
    metadata: {
      title: '快照测试剧本',
      author: '作者',
      sourceNovel: '快照测试小说',
      version: '1.0.0',
      createdAt: '2026-08-03T09:00:00.000Z',
      totalScenes: 1,
      totalCharacters: 1,
      totalLocations: 1,
      formatVersion: 'novel2screenplay-v1',
    },
    characters: [
      { characterId: 'char_1', name: '林晓', aliases: ['小林'], personalityTags: [], description: '主角', isMajor: true, sourceRef: { chapterIndex: 0, paragraphIndex: 0, excerpt: '' } },
    ],
    locations: [{ locationId: 'loc_1', name: '客厅', type: 'interior', description: '', sourceRef: { chapterIndex: 0, paragraphIndex: 0, excerpt: '' } }],
    scenes: [
      {
        sceneNumber: 1,
        slugline: '内景. 客厅 - 夜',
        timeOfDay: 'night',
        locationId: 'loc_1',
        characterIds: ['char_1'],
        content: [
          { type: 'action', description: '林晓推门而入。', sourceRefs: [{ chapterIndex: 0, paragraphIndex: 3, excerpt: '他推门进来，屋里空无一人' }] },
          { type: 'dialogue', characterId: 'char_1', line: '你好。', direction: '轻声', sourceRefs: [] },
        ],
        summary: '开场',
        sourceChapterRange: [0, 0],
      },
    ],
    ...over,
  } as ScreenplayLike;
}

describe('Markdown 导出（FIX-15）', () => {
  it('头部/角色表/场景/对白行齐备', () => {
    const md = serializeToMarkdown(fixture());
    expect(md).toContain('# 《快照测试剧本》剧本（Markdown 导出）');
    expect(md).toContain('作者：作者');
    expect(md).toContain('版本：novel2screenplay-v1');
    expect(md).toContain('## 角色表');
    expect(md).toContain('| 林晓 | 小林 | 主要 |');
    expect(md).toContain('### 场 1 · 内景. 客厅 - 夜（night）');
    expect(md).toContain('- 在场：林晓');
    expect(md).toContain('- 〔动作〕林晓推门而入。');
    expect(md).toContain('- 【林晓】（轻声）你好。');
  });

  it('分集表（传入 episodes 时渲染，时长格式化）', () => {
    const md = serializeToMarkdown(fixture(), {
      episodes: [{ episodeNumber: 1, sceneNumbers: [1], durationSec: 90, hookAtEnd: true }],
    });
    expect(md).toContain('## 分集');
    expect(md).toContain('| 1 | #1 | 1分30秒 | ✅ |');
  });

  it('原文溯源行（includeSourceRefs）；独白松散类型可渲染', () => {
    const f = fixture();
    f.scenes[0].content.push({ type: 'monologue', line: '他再没有回头。', sourceRefs: [] } as never);
    const md = serializeToMarkdown(f, { includeSourceRefs: true });
    expect(md).toContain('↳ 原文：第 1 章 · 他推门进来');
    expect(md).toContain('- 【NV·旁白】他再没有回头。');
  });

  it('空数据不抛错（缺 metadata/characters 的预览输入可渲染）', () => {
    const md = serializeToMarkdown({ scenes: [] } as ScreenplayLike);
    expect(md).toContain('《未命名》');
    expect(md).toContain('| （无角色数据） |');
  });
});
