/**
 * ReviewGate identity 信号集成单测（Task 4.1）
 *
 * 验证：
 * - makeGateDecision 在注入 identity 信号且不通过时 → fail（带具体场景号）
 * - identity 通过 / 未注入 → 行为与改造前一致（默认关，主链零变化）
 * - evaluateIdentity 复用身份断言产出信号
 */

import { describe, it, expect } from 'vitest';
import type { Scene, ContentBlock } from '@novel/contracts/screenplay';
import type { GateConfig, GateContext } from '@/lib/multi-agent/review-gate';
import {
  makeGateDecision,
  evaluateIdentity,
  evaluateQuality,
} from '@/lib/multi-agent/review-gate';
import type { QualityAssessment } from '@/lib/multi-agent/handoff-protocol';

const gateConfig: GateConfig = {
  id: 'conversion_scene',
  name: '场景转换质量关卡',
  description: 'test',
  phase: 'conversion',
  criteria: { minScore: 70, requiredDimensions: ['format'], maxIssues: 2 },
  onFail: 'retry',
  maxRetries: 3,
  weights: { format: 0.35, consistency: 0.2, coherence: 0.25, drama: 0.2 },
};

const goodAssessment = (): QualityAssessment => ({
  score: 90,
  passed: true,
  dimensions: { format: 90, consistency: 90, coherence: 90, drama: 90 },
  issues: [],
  suggestions: [],
});

const dlg = (characterId: string, line: string, chapterIndex: number): ContentBlock => ({
  type: 'dialogue',
  characterId,
  line,
  sourceRefs: [{ chapterIndex, paragraphIndex: 0, excerpt: line }],
});

const mkScene = (sceneNumber: number, sourceChapter: number): Scene => ({
  sceneNumber,
  slugline: `SC ${sceneNumber}`,
  timeOfDay: 'night',
  locationId: 'loc_1',
  characterIds: ['char_1'],
  content: [dlg('char_1', '我还活着', sourceChapter)],
  sourceChapterRange: [sourceChapter, sourceChapter],
  summary: '',
});

describe('makeGateDecision · identity 信号', () => {
  it('identity 不通过 → 立即 fail，reason 列出具体场景号', () => {
    const assessment = goodAssessment();
    assessment.identity = {
      passed: false,
      score: 60,
      failures: [
        { ruleId: 'dead-character-no-speak', sceneNumber: 3, message: '已死角色...' },
        { ruleId: 'dead-character-no-speak', sceneNumber: 3, message: '重复...' },
        { ruleId: 'unresolved-alias-as-id', sceneNumber: 5, message: '别名...' },
      ],
    };
    const { decision, reason } = makeGateDecision(assessment, gateConfig);
    expect(decision).toBe('fail');
    expect(reason).toContain('场景 #3, 5');
    expect(reason).toContain('身份一致性不达标');
  });

  it('identity 通过 → 不影响原有正常判定（pass）', () => {
    const assessment = goodAssessment();
    assessment.identity = { passed: true, score: 100, failures: [] };
    expect(makeGateDecision(assessment, gateConfig).decision).toBe('pass');
  });

  it('未注入 identity → 行为与改造前一致（pass / fail 语义不变）', () => {
    expect(makeGateDecision(goodAssessment(), gateConfig).decision).toBe('pass');

    const low = goodAssessment();
    low.score = 60;
    low.dimensions.format = 60;
    expect(makeGateDecision(low, gateConfig).decision).toBe('fail');
  });

  it('identity 通过但分数在临界区 → 仍走 review（identity 不是免死金牌）', () => {
    const assessment = goodAssessment();
    assessment.identity = { passed: true, score: 100, failures: [] };
    assessment.score = 72; // minScore 70 + 10 = 80 临界区以下 → review
    expect(makeGateDecision(assessment, gateConfig).decision).toBe('review');
  });
});

describe('evaluateIdentity · 复用身份断言', () => {
  it('标注死亡 → 判定具体场景失败', () => {
    const signal = evaluateIdentity({
      scenes: [mkScene(3, 6)],
      charIdToName: { char_1: '老秦' },
      deadCharacters: [{ name: '老秦', deathChapter: 5 }],
      reveals: [],
      aliasIndex: {},
    });
    expect(signal.passed).toBe(false);
    expect(signal.failures).toHaveLength(1);
    expect(signal.failures[0].sceneNumber).toBe(3);
  });

  it('无标注 → 通过（零误报）', () => {
    const signal = evaluateIdentity({
      scenes: [mkScene(3, 6)],
      charIdToName: { char_1: '老秦' },
      deadCharacters: [],
      reveals: [],
      aliasIndex: {},
    });
    expect(signal.passed).toBe(true);
    expect(signal.score).toBe(100);
  });
});

describe('evaluateQuality · 降级路径不受 identity 影响', () => {
  it('无 validator 时启发式评估仍不携带 identity 字段', async () => {
    const ctx: GateContext = { taskId: 't', phase: 'conversion', content: '场景标题', metadata: {} };
    const assessment = await evaluateQuality(ctx.content, gateConfig);
    expect(assessment.identity).toBeUndefined();
  });
});
