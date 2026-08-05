import { describe, it, expect } from 'vitest';
import { Phase4Merger } from '../../../src/lib/pipeline/Phase4Merger';
import type { Phase1Output } from '../../../src/lib/pipeline/Phase1Analyzer';
import type { Phase2Output } from '../../../src/lib/pipeline/Phase2Segmenter';
import type { Phase3Output } from '../../../src/lib/pipeline/Phase3SceneConverter';

describe('Phase4Merger', () => {
  const merger = new Phase4Merger();

  // Mock phase outputs
  const mockPhase1Output: Phase1Output = {
    characters: [
      { name: '张三', aliases: ['小张'], personalityTags: ['勇敢'], description: '主角', isMajor: true, sourceChapterIndex: 0 },
      { name: '李四', aliases: [], personalityTags: ['聪明'], description: '配角', isMajor: false, sourceChapterIndex: 0 },
    ],
    locations: [
      { name: '北京', type: 'exterior', description: '首都', sourceChapterIndex: 0 },
      { name: '上海', type: 'exterior', description: '大城市', sourceChapterIndex: 1 },
    ],
    timelineHints: [],
    rawResponse: '{}',
  };

  const mockPhase2Output: Phase2Output = {
    scenes: [
      {
        sceneIndex: 0,
        chapterIndex: 0,
        startParagraph: 0,
        endParagraph: 5,
        originalStartOffset: 0,
        originalEndOffset: 100,
        draftSlugline: '北京 - 白天',
        keyCharacterNames: ['张三'],
        summary: '开场',
      },
    ],
    rawResponses: ['{}'],
  };

  const mockPhase3Outputs: Phase3Output[] = [
    {
      sceneNumber: 1,
      slugline: '北京 - 白天',
      timeOfDay: 'day',
      locationId: 'loc-1',
      characterIds: ['char-1'],
      content: [
        { type: 'action', description: '张三走进房间', sourceRefs: [] },
        { type: 'dialogue', characterId: 'char-1', line: '你好', sourceRefs: [] },
      ],
      summary: '开场场景',
      confidence: 0.9,
    },
  ];

  describe('merge', () => {
    it('should merge all phase outputs into screenplay', async () => {
      const result = await merger.merge(
        { title: '测试剧本', author: '测试', sourceNovel: '测试小说' },
        mockPhase1Output,
        mockPhase2Output,
        mockPhase3Outputs,
      );

      expect(result.screenplay).toBeDefined();
      expect(result.screenplay.metadata.title).toBe('测试剧本');
      expect(result.screenplay.scenes.length).toBeGreaterThan(0);
    });

    it('should include fixes array', async () => {
      const result = await merger.merge(
        { title: '测试', author: '', sourceNovel: '' },
        mockPhase1Output,
        mockPhase2Output,
        mockPhase3Outputs,
      );

      expect(Array.isArray(result.fixes)).toBe(true);
    });

    it('should handle empty characters', async () => {
      const result = await merger.merge(
        { title: '测试', author: '', sourceNovel: '' },
        { ...mockPhase1Output, characters: [] },
        { ...mockPhase2Output, scenes: [] },
        [],
      );

      expect(result.screenplay).toBeDefined();
    });
  });
});

describe('Phase4Merger - Levenshtein Distance', () => {
  // Test the dedup logic through the merge result
  const merger = new Phase4Merger();

  it('should deduplicate similar character names', async () => {
    const phase1WithSimilarNames: Phase1Output = {
      characters: [
        { name: '林黛玉', aliases: ['黛玉'], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 0 },
        { name: '林黛玉', aliases: [], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 1 },
      ],
      locations: [],
      timelineHints: [],
      rawResponse: '{}',
    };

    const result = await merger.merge(
      { title: '测试', author: '', sourceNovel: '' },
      phase1WithSimilarNames,
      { scenes: [], rawResponses: [] },
      [],
    );

    // Should have fewer characters due to dedup
    const charCount = result.screenplay.metadata.totalCharacters;
    expect(charCount).toBeLessThan(phase1WithSimilarNames.characters.length);
  });

  it('should handle Chinese character names', async () => {
    const phase1WithChinese: Phase1Output = {
      characters: [
        { name: '孙悟空', aliases: ['悟空', '猴哥'], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 0 },
        { name: '猪八戒', aliases: ['八戒'], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 0 },
      ],
      locations: [
        { name: '花果山', type: 'exterior', description: '', sourceChapterIndex: 0 },
        { name: '天宫', type: 'abstract', description: '', sourceChapterIndex: 1 },
      ],
      timelineHints: [],
      rawResponse: '{}',
    };

    const result = await merger.merge(
      { title: '西游记', author: '吴承恩', sourceNovel: '' },
      phase1WithChinese,
      { scenes: [], rawResponses: [] },
      [],
    );

    expect(result.screenplay.characters.length).toBeGreaterThan(0);
    expect(result.screenplay.locations.length).toBeGreaterThan(0);
  });
});
