import { describe, it, expect } from 'vitest';
import { normalizePipelineState, pipelineStateJson } from '../job.js';
import type { Phase1Output, Phase2Output, Phase3Output } from '@novel/contracts/pipeline';

describe('normalizePipelineState', () => {
  it('正常相位输出原样保留且通过校验', () => {
    const phase1: Phase1Output = {
      characters: [],
      locations: [],
      timelineHints: [{ chapterIndex: 0, timeCue: '夜', type: 'time-of-day' }],
      rawResponse: '{}',
    };
    const out = normalizePipelineState({ phase1Output: phase1 });
    expect(out.phase1Output?.characters).toEqual([]);
    expect(out.phase1Output?.rawResponse).toBe('{}');
  });

  it('缺省字段结构不完整时抛错（脏数据保护）', () => {
    expect(() =>
      normalizePipelineState({
        phase1Output: { characters: [], locations: [] } as unknown as Phase1Output,
      }),
    ).toThrow();
  });

  it('透传附加业务字段（qualityAssessment 等）', () => {
    const out = normalizePipelineState({
      phase4Output: { formatVersion: 'novel2screenplay-v1' } as never,
    });
    expect(out.phase4Output).toBeDefined();
  });

  it('phase4Output 可用自定义 schema 强校验（脏数据抛错）', () => {
    const throwingSchema = { parse: () => { throw new Error('invalid screenplay'); } } as never;
    expect(() =>
      normalizePipelineState({ phase4Output: {} as never }, { phase4Schema: throwingSchema }),
    ).toThrow('invalid screenplay');
  });
});

describe('pipelineStateJson', () => {
  it('JSON 往返保持结构一致', () => {
    const phase2: Phase2Output = { scenes: [], rawResponses: ['x'] };
    const state = pipelineStateJson.fromSqlite(pipelineStateJson.toSqlite({ phase2Output: phase2 }));
    expect(state?.phase2Output?.rawResponses).toEqual(['x']);
  });

  it('空值/非法 JSON 返回 undefined', () => {
    expect(pipelineStateJson.fromSqlite(null)).toBeUndefined();
    expect(pipelineStateJson.fromSqlite('not-json')).toBeUndefined();
  });

  it('phase3Output 逐条校验通过', () => {
    const p3: Phase3Output = {
      sceneNumber: 1,
      slugline: '内 - 客厅 - 夜',
      timeOfDay: 'night',
      locationId: 'loc_1',
      characterIds: [],
      content: [{ type: 'action', description: '描述', sourceRefs: [] }],
      summary: '',
      confidence: 0.9,
    };
    const out = normalizePipelineState({ phase3Output: [p3] });
    expect(out.phase3Output?.[0]?.sceneNumber).toBe(1);
  });
});