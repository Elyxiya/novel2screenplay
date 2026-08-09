import { describe, it, expect } from 'vitest';
import { evaluateFlow } from '@/lib/debug/flow-evaluator';
import type { StoredJob } from '@/lib/store/job-store';

// ── Fixtures ──────────────────────────────────────────────────────────────

function baseJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 'job_test',
    type: 'conversion',
    status: 'completed',
    progress: 100,
    retryCount: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    scenesStatus: [],
    logs: [],
    novelText: '',
    chapterTexts: ['第一章内容', '第二章内容', '第三章内容'],
    config: { modelId: 'deepseek-chat', selectedChapters: [0, 1, 2], temperature: 0.7 },
    pipelineState: {},
    ...overrides,
  };
}

function completeJob(): StoredJob {
  return baseJob({
    pipelineState: {
      phase1Output: {
        characters: Array.from({ length: 6 }, (_, i) => ({
          name: `角色${i}`,
          aliases: [],
          personalityTags: [],
          description: '',
          isMajor: true,
          sourceChapterIndex: i % 3,
        })),
        locations: Array.from({ length: 4 }, (_, i) => ({
          name: `地点${i}`,
          description: '',
          type: 'interior' as const,
          sourceChapterIndex: i % 3,
        })),
        timelineHints: [{ chapterIndex: 0, timeCue: '傍晚', type: 'time-of-day' as const }],
        rawResponse: '{}',
      },
      phase2Output: {
        scenes: [
          { sceneIndex: 0, chapterIndex: 0, startParagraph: 0, endParagraph: 5, originalStartOffset: 0, originalEndOffset: 100, draftSlugline: 'S1', keyCharacterNames: ['角色1'], summary: 'x' },
          { sceneIndex: 1, chapterIndex: 1, startParagraph: 6, endParagraph: 10, originalStartOffset: 101, originalEndOffset: 200, draftSlugline: 'S2', keyCharacterNames: ['角色2'], summary: 'y' },
          { sceneIndex: 2, chapterIndex: 2, startParagraph: 11, endParagraph: 15, originalStartOffset: 201, originalEndOffset: 300, draftSlugline: 'S3', keyCharacterNames: ['角色1'], summary: 'z' },
        ],
        rawResponses: [],
      },
      phase3Output: [
        { sceneNumber: 1, slugline: 'S1', timeOfDay: 'night', locationId: 'loc_1', characterIds: ['char_1'], content: [{ type: 'action', description: 'a', sourceRefs: [] }], summary: 'x', confidence: 0.9 },
        { sceneNumber: 2, slugline: 'S2', timeOfDay: 'morning', locationId: 'loc_2', characterIds: ['char_2'], content: [{ type: 'action', description: 'b', sourceRefs: [] }], summary: 'y', confidence: 0.85 },
        { sceneNumber: 3, slugline: 'S3', timeOfDay: 'night', locationId: 'loc_1', characterIds: ['char_1'], content: [{ type: 'action', description: 'c', sourceRefs: [] }], summary: 'z', confidence: 0.8 },
      ],
      phase4Output: {
        formatVersion: 'novel2screenplay-v1',
        metadata: {
          title: '测试', author: '', sourceNovel: '测试', version: '1.0.0',
          createdAt: new Date().toISOString(),
          totalScenes: 3, totalCharacters: 6, totalLocations: 4,
        },
        characters: [
          { characterId: 'char_1', name: '角色1', aliases: [], personalityTags: [], description: '', isMajor: true },
          { characterId: 'char_2', name: '角色2', aliases: [], personalityTags: [], description: '', isMajor: true },
        ],
        locations: [
          { locationId: 'loc_1', name: '地点1', type: 'interior', description: '' },
          { locationId: 'loc_2', name: '地点2', type: 'exterior', description: '' },
        ],
        scenes: [
          { sceneNumber: 1, slugline: 'S1', timeOfDay: 'night', locationId: 'loc_1', characterIds: ['char_1'], content: [{ type: 'action', description: 'a', sourceRefs: [] }], summary: 'x', confidence: 0.9 },
          { sceneNumber: 2, slugline: 'S2', timeOfDay: 'morning', locationId: 'loc_2', characterIds: ['char_2'], content: [{ type: 'action', description: 'b', sourceRefs: [] }], summary: 'y', confidence: 0.85 },
          { sceneNumber: 3, slugline: 'S3', timeOfDay: 'night', locationId: 'loc_1', characterIds: ['char_1'], content: [{ type: 'action', description: 'c', sourceRefs: [] }], summary: 'z', confidence: 0.8 },
        ],
        analytics: {
          totalWords: 100, dialoguePercentage: 40, actionPercentage: 60,
          avgSceneLength: 33, longestScene: 50, shortestScene: 20,
        },
      },
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('evaluateFlow', () => {
  it('完整且高质量的任务 → 总分高、grade excellent', () => {
    const result = evaluateFlow(completeJob());
    expect(result.overall.score).toBeGreaterThanOrEqual(85);
    expect(result.overall.grade).toBe('excellent');
    expect(result.phases.analyze.status).toBe('ok');
    expect(result.phases.segment.status).toBe('ok');
    expect(result.phases.convert.status).toBe('ok');
    expect(result.phases.merge.status).toBe('ok');
    expect(result.issues).toHaveLength(0);
  });

  it('空 pipelineState → 总分低、grade poor、含 error issue', () => {
    const result = evaluateFlow(baseJob());
    expect(result.overall.score).toBeLessThan(55);
    expect(result.overall.grade).toBe('poor');
    expect(result.phases.analyze.status).toBe('empty');
    expect(result.phases.segment.status).toBe('empty');
    expect(result.phases.convert.status).toBe('empty');
    expect(result.phases.merge.status).toBe('empty');
    expect(result.issues.some((i) => i.level === 'error' && i.phase === 'overall')).toBe(true);
  });

  it('场景引用悬空角色 ID → consistency 减分 + error issue', () => {
    const job = completeJob();
    const p4 = job.pipelineState.phase4Output!;
    job.pipelineState = {
      ...job.pipelineState,
      phase4Output: {
        ...p4,
        scenes: p4.scenes.map((s, i) =>
          i === 0 ? { ...s, characterIds: ['char_1', 'char_999'] } : s,
        ),
      },
    };
    const result = evaluateFlow(job);
    expect(result.overall.dimensions.consistency).toBeLessThan(100);
    expect(result.issues.some((i) => i.message.includes('char_999'))).toBe(true);
  });

  it('对白占比极端（95%）→ drama 减分', () => {
    const job = completeJob();
    const p4 = job.pipelineState.phase4Output!;
    job.pipelineState = {
      ...job.pipelineState,
      phase4Output: {
        ...p4,
        analytics: { ...p4.analytics!, dialoguePercentage: 95, actionPercentage: 5 },
      },
    };
    const result = evaluateFlow(job);
    expect(result.overall.dimensions.drama).toBe(40);
    expect(result.stats.dialoguePercentage).toBe(95);
  });

  it('场景编号断号 → coherence 减分', () => {
    const job = completeJob();
    const p4 = job.pipelineState.phase4Output!;
    job.pipelineState = {
      ...job.pipelineState,
      phase4Output: {
        ...p4,
        scenes: p4.scenes.map((s, i) => ({ ...s, sceneNumber: i === 2 ? 5 : s.sceneNumber })),
      },
    };
    const result = evaluateFlow(job);
    expect(result.overall.dimensions.coherence).toBeLessThan(100);
    expect(result.issues.some((i) => i.message.includes('编号不连续'))).toBe(true);
  });

  it('phaseTimings 缺失不崩溃，显示为空对象', () => {
    const result = evaluateFlow(completeJob());
    expect(result.stats.phaseTimings).toEqual({});
  });

  it('phaseTimings 存在时正确解析', () => {
    const job = completeJob();
    job.metadata = {
      phaseTimings: { analyze: { durationMs: 1200 }, segment: { durationMs: 300 } },
    };
    const result = evaluateFlow(job);
    expect(result.stats.phaseTimings.analyze.durationMs).toBe(1200);
    expect(result.stats.phaseTimings.segment.durationMs).toBe(300);
  });

  it('角色数为 0 → analyze 减分 + error issue', () => {
    const job = completeJob();
    job.pipelineState = {
      ...job.pipelineState,
      phase1Output: {
        characters: [],
        locations: [{ name: '地点1', description: '', type: 'interior' as const, sourceChapterIndex: 0 }],
        timelineHints: [],
        rawResponse: '{}',
      },
    };
    const result = evaluateFlow(job);
    expect(result.phases.analyze.score).toBeLessThan(60);
    expect(result.phases.analyze.status).toBe('error');
    expect(result.issues.some((i) => i.message.includes('未提取到任何角色'))).toBe(true);
  });

  it('角色数过多（>40）→ analyze 警告', () => {
    const job = completeJob();
    job.pipelineState = {
      ...job.pipelineState,
      phase1Output: {
        characters: Array.from({ length: 45 }, (_, i) => ({
          name: `角色${i}`, aliases: [], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: i % 3,
        })),
        locations: [{ name: '地点1', description: '', type: 'interior' as const, sourceChapterIndex: 0 }],
        timelineHints: [],
        rawResponse: '{}',
      },
    };
    const result = evaluateFlow(job);
    expect(result.issues.some((i) => i.message.includes('过度提取'))).toBe(true);
  });

  it('低置信度场景占比高 → convert 警告', () => {
    const job = completeJob();
    job.pipelineState = {
      ...job.pipelineState,
      phase3Output: [
        { sceneNumber: 1, slugline: 'S1', timeOfDay: 'night', locationId: 'loc_1', characterIds: ['char_1'], content: [{ type: 'action', description: 'a', sourceRefs: [] }], summary: 'x', confidence: 0.3 },
        { sceneNumber: 2, slugline: 'S2', timeOfDay: 'morning', locationId: 'loc_2', characterIds: ['char_2'], content: [{ type: 'action', description: 'b', sourceRefs: [] }], summary: 'y', confidence: 0.2 },
      ],
    };
    const result = evaluateFlow(job);
    expect(result.issues.some((i) => i.phase === 'convert' && i.message.includes('低置信度'))).toBe(true);
  });

  it('场景密度过低 → segment 警告', () => {
    const job = completeJob();
    job.pipelineState = {
      ...job.pipelineState,
      phase2Output: {
        scenes: [{ sceneIndex: 0, chapterIndex: 0, startParagraph: 0, endParagraph: 5, originalStartOffset: 0, originalEndOffset: 100, draftSlugline: 'S1', keyCharacterNames: [], summary: 'x' }],
        rawResponses: [],
      },
    };
    const result = evaluateFlow(job);
    expect(result.issues.some((i) => i.phase === 'segment' && i.message.includes('密度过低'))).toBe(true);
  });

  it('无 usage 数据 → efficiency 中性分、stats.usage 为 null', () => {
    const result = evaluateFlow(completeJob());
    expect(result.stats.usage).toBeNull();
    expect(result.overall.dimensions.efficiency).toBe(60);
    expect(result.phases.efficiency.status).toBe('empty');
  });

  it('usage 高效（每字 ≤1.5 token）→ efficiency 满分', () => {
    const job = completeJob();
    job.metadata = { usage: { promptTokens: 1000, completionTokens: 200, inputChars: 1200, calls: 3 } };
    const result = evaluateFlow(job);
    expect(result.stats.usage).not.toBeNull();
    expect(result.stats.usage!.tokensPerChar).toBe(1);
    expect(result.overall.dimensions.efficiency).toBe(100);
    expect(result.phases.efficiency.status).toBe('ok');
  });

  it('usage 低效（每字 >5 token）→ efficiency 减分 + issue', () => {
    const job = completeJob();
    job.metadata = { usage: { promptTokens: 60000, completionTokens: 4000, inputChars: 10000, calls: 10 } };
    const result = evaluateFlow(job);
    expect(result.stats.usage!.tokensPerChar).toBe(6.4);
    expect(result.overall.dimensions.efficiency).toBe(30);
    expect(result.phases.efficiency.status).toBe('error');
    expect(result.issues.some((i) => i.message.includes('token 效率低'))).toBe(true);
  });
});
