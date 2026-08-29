/**
 * 经典链重转桥接器（Task 4.3 执行层）单元测试
 *
 * 覆盖：
 * - reconvertClassicJobScenes：jobId 取 pipelineState → Phase3SceneConverter 重转指定场景
 *   → 按 sceneNumber 合并回 phase3Output → Phase4 重合并 → 写回 pipelineState → 重跑身份断言
 * - 重转前身份断言失败（前置条件）→ 重转后通过（外科介入有效）
 * - 重转后仍失败（未修复）→ identityAfter.passed=false
 * - 错误路径：jobId 不存在 / 场景号不存在 / pipelineState 不可重转
 * - 写回副作用：subProgress/scenesStatus 恢复，日志落库
 * - executeReconvertForTask：classic-job → 执行；agent-task/unavailable → needs-manual
 */

import { describe, it, expect } from 'vitest';
import type { LLMProvider, LLMMessage, LLMChatOptions, LLMChatResponse } from '@/lib/llm/types';
import type { ContextManager } from '@/lib/pipeline/ContextManager';
import { Phase4Merger } from '@/lib/pipeline/Phase4Merger';
import type { StoredJob } from '@/lib/store/job-store';
import type { OrchestratorTask } from '@/lib/multi-agent/orchestrator';
import { runIdentityAssessment } from '@/lib/eval/identity-rules';
import type { IdentityAnnotations, ReconvertJobStore } from '@/lib/multi-agent/reconvert-bridge';
import { reconvertClassicJobScenes, executeReconvertForTask } from '@/lib/multi-agent/reconvert-bridge';

// ── 快速 token 计数（避免测试加载 tiktoken）──────────────────────────────────────
const fastCtx = { countTokens: async (text: string) => text.length } as unknown as ContextManager;

// ── Fake JobStore（最小依赖，测试可注入）────────────────────────────────────────
class FakeJobStore implements ReconvertJobStore {
  private jobs = new Map<string, StoredJob>();
  set(job: StoredJob): void {
    this.jobs.set(job.id, job);
  }
  get(jobId: string): StoredJob | undefined {
    return this.jobs.get(jobId);
  }
  update(jobId: string, updater: (job: StoredJob) => StoredJob): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.jobs.set(jobId, updater(job));
  }
}

// ── Mock LLM Provider：重转场景时返回指定 scene JSON ─────────────────────────────
class MockReconvertProvider implements LLMProvider {
  name = 'mock-reconvert';
  modelId = 'mock-model';
  description = 'Mock provider for reconvert bridge tests';
  contextWindow = 64000;
  constructor(private sceneJson: string) {}
  async chat(_messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResponse> {
    if (options?.responseFormat === 'json_object') {
      return { content: this.sceneJson, model: this.modelId };
    }
    return { content: 'ok', model: this.modelId };
  }
  async *chatStream(): AsyncGenerator<{ type: 'done' }> {
    yield { type: 'done' };
  }
  supportsJSONMode(): boolean {
    return true;
  }
  async estimateTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAPTER_TEXTS = [
  '第一章 重逢\n老宅门口，阿福推门而入。\n秦爷在堂中抬头。',
  '第二章 死讯\n老秦倒在堂前。\n阿福悲愤交加。',
];

/** 场景 1（chapterIndex=1）含已死角色 老秦 的对白 → 身份断言失败（前置条件） */
const DEAD_CHAR_ANNOTATIONS: IdentityAnnotations = {
  deadCharacters: [{ name: '老秦', deathChapter: 0 }],
  reveals: [],
  aliasIndex: {},
};

function makeReconvertibleState(): StoredJob['pipelineState'] {
  return {
    phase1Output: {
      characters: [
        { name: '老秦', aliases: ['老秦'], personalityTags: [], description: '已死角色', isMajor: true, sourceChapterIndex: 0 },
        { name: '阿福', aliases: ['阿福'], personalityTags: [], description: '主角', isMajor: true, sourceChapterIndex: 0 },
      ],
      locations: [{ name: '老宅', type: 'interior', description: '', sourceChapterIndex: 0 }],
      timelineHints: [],
      rawResponse: '',
    },
    phase2Output: {
      scenes: [
        {
          sceneIndex: 0,
          chapterIndex: 0,
          startParagraph: 0,
          endParagraph: 10,
          originalStartOffset: 0,
          originalEndOffset: CHAPTER_TEXTS[0].length,
          draftSlugline: '老宅门口',
          keyCharacterNames: ['阿福'],
          summary: '阿福推门而入',
        },
        {
          sceneIndex: 1,
          chapterIndex: 1,
          startParagraph: 0,
          endParagraph: 10,
          originalStartOffset: 0,
          originalEndOffset: CHAPTER_TEXTS[1].length,
          draftSlugline: '堂前',
          keyCharacterNames: ['阿福', '老秦'],
          summary: '老秦倒下',
        },
      ],
      rawResponses: [],
    },
    phase3Output: [
      {
        sceneNumber: 0,
        slugline: '老宅门口',
        timeOfDay: 'night',
        locationId: 'loc_01',
        characterIds: ['char_01'],
        content: [
          { type: 'dialogue', characterId: 'char_01', line: '秦爷？', sourceRefs: [{ chapterIndex: 0, paragraphIndex: 0, excerpt: '阿福推门' }] },
        ],
        summary: '重逢',
        confidence: 0.8,
      },
      {
        sceneNumber: 1,
        slugline: '堂前',
        timeOfDay: 'night',
        locationId: 'loc_01',
        characterIds: ['char_01', 'char_02'],
        content: [
          { type: 'dialogue', characterId: 'char_01', line: '秦爷！你醒醒！', sourceRefs: [{ chapterIndex: 1, paragraphIndex: 0, excerpt: '老秦倒下' }] },
        ],
        summary: '死讯',
        confidence: 0.8,
      },
    ],
  };
}

function makeClassicJob(id = 'job-reconvert-1'): StoredJob {
  return {
    id,
    type: 'conversion',
    status: 'completed',
    currentPhase: 4,
    progress: 100,
    retryCount: 0,
    maxRetries: 3,
    createdAt: 1700000000000,
    scenesStatus: [
      { sceneIndex: 0, status: 'completed' },
      { sceneIndex: 1, status: 'completed' },
    ],
    logs: [],
    subProgress: { totalScenes: 2, completedScenes: 2 },
    novelText: CHAPTER_TEXTS.join('\n\n'),
    chapterTexts: CHAPTER_TEXTS,
    config: { modelId: 'mock-model', selectedChapters: [0, 1], temperature: 0.7, title: '测试剧本', author: '测试作者' },
    pipelineState: makeReconvertibleState(),
  };
}

function makeTask(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: 'task-reconvert-1',
    input: CHAPTER_TEXTS.join('\n\n'),
    phaseCount: 4,
    phases: [],
    ...overrides,
  };
}

/** 用 Phase4Merger 把某 pipelineState 合并成剧本并对给定标注跑身份断言（测试前置条件用） */
async function assessStateIdentity(
  state: StoredJob['pipelineState'],
  annotations: Partial<IdentityAnnotations>,
) {
  const phase4 = new Phase4Merger();
  const { screenplay } = await phase4.merge(
    { title: 't', author: '', sourceNovel: 't' },
    state.phase1Output!,
    state.phase2Output!,
    state.phase3Output ?? [],
  );
  const charIdToName: Record<string, string> = {};
  for (const c of screenplay.characters) charIdToName[c.characterId] = c.name;
  return runIdentityAssessment({
    scenes: screenplay.scenes,
    charIdToName,
    deadCharacters: annotations.deadCharacters ?? [],
    reveals: annotations.reveals ?? [],
    aliasIndex: annotations.aliasIndex ?? {},
  });
}

const FIXED_SCENE_JSON = JSON.stringify({
  content: [{ type: 'dialogue', characterId: '阿福', line: '大哥！你醒醒！', sourceRefs: [] }],
  summary: '阿福悲恸呼唤',
  confidence: 0.92,
  timeOfDay: 'night',
});

const UNFIXED_SCENE_JSON = JSON.stringify({
  content: [{ type: 'dialogue', characterId: '老秦', line: '秦爷！我还没死！', sourceRefs: [] }],
  summary: '老秦再开口',
  confidence: 0.9,
  timeOfDay: 'night',
});

// ── reconvertClassicJobScenes ─────────────────────────────────────────────────

describe('reconvertClassicJobScenes', () => {
  it('前置条件：原始 pipelineState 身份断言失败（已死角色仍开口）', async () => {
    const before = await assessStateIdentity(makeReconvertibleState(), DEAD_CHAR_ANNOTATIONS);
    expect(before.passed).toBe(false);
    expect(before.failures.some((f) => f.sceneNumber === 1)).toBe(true);
  });

  it('重转指定场景 → 合并写回 → 重跑断言通过', async () => {
    const store = new FakeJobStore();
    store.set(makeClassicJob());
    const provider = new MockReconvertProvider(FIXED_SCENE_JSON);

    const result = await reconvertClassicJobScenes('job-reconvert-1', [1], {
      provider,
      annotations: DEAD_CHAR_ANNOTATIONS,
      jobStore: store,
      ctxManager: fastCtx,
    });

    expect(result.success).toBe(true);
    expect(result.reconvertedSceneNumbers).toEqual([1]);
    expect(result.identityAfter.passed).toBe(true);
    expect(result.fixes.length).toBeGreaterThanOrEqual(0);

    // 未重转场景 0 原样保留
    expect(result.newPhase3[0].content[0].type).toBe('dialogue');
    expect(result.newPhase3[0].content[0].characterId).toBe('char_01');
    // 重转场景 1 内容替换为 阿福 对白
    expect(result.newPhase3[1].content[0].characterId).toBe('char_02');
    expect(result.newPhase3[1].content[0].line).toBe('大哥！你醒醒！');

    // 写回：phase3Output 按 sceneNumber 替换，phase4Output 重合并
    const updated = store.get('job-reconvert-1')!;
    expect(updated.pipelineState.phase3Output![1].content[0].characterId).toBe('char_02');
    expect(updated.pipelineState.phase4Output?.scenes.length).toBe(2);

    // 进度展示字段恢复（convertScenes 副作用被还原）
    expect(updated.subProgress).toEqual({ totalScenes: 2, completedScenes: 2 });
    expect(updated.scenesStatus).toHaveLength(2);

    // 日志落库
    expect(updated.logs.some((l) => l.message.includes('外科式重转完成'))).toBe(true);
  });

  it('重转后仍失败（未修复）→ identityAfter.passed=false 但执行成功', async () => {
    const store = new FakeJobStore();
    store.set(makeClassicJob());
    const provider = new MockReconvertProvider(UNFIXED_SCENE_JSON);

    const result = await reconvertClassicJobScenes('job-reconvert-1', [1], {
      provider,
      annotations: DEAD_CHAR_ANNOTATIONS,
      jobStore: store,
      ctxManager: fastCtx,
    });

    expect(result.success).toBe(true);
    expect(result.reconvertedSceneNumbers).toEqual([1]);
    expect(result.identityAfter.passed).toBe(false);
    expect(result.identityAfter.failures.some((f) => f.sceneNumber === 1)).toBe(true);
  });

  it('jobId 不存在 → 失败且带错误原因', async () => {
    const store = new FakeJobStore();
    const provider = new MockReconvertProvider(FIXED_SCENE_JSON);
    const result = await reconvertClassicJobScenes('job-ghost', [1], {
      provider,
      jobStore: store,
      ctxManager: fastCtx,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('不存在');
  });

  it('指定场景号不在 phase2 边界 → 失败', async () => {
    const store = new FakeJobStore();
    store.set(makeClassicJob());
    const provider = new MockReconvertProvider(FIXED_SCENE_JSON);
    const result = await reconvertClassicJobScenes('job-reconvert-1', [99], {
      provider,
      jobStore: store,
      ctxManager: fastCtx,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('不存在');
  });

  it('pipelineState 不可重转（无 phase2 场景）→ 失败', async () => {
    const store = new FakeJobStore();
    const job = makeClassicJob();
    job.pipelineState = {
      ...job.pipelineState,
      phase2Output: { scenes: [], rawResponses: [] },
    };
    store.set(job);
    const provider = new MockReconvertProvider(FIXED_SCENE_JSON);
    const result = await reconvertClassicJobScenes('job-reconvert-1', [0], {
      provider,
      jobStore: store,
      ctxManager: fastCtx,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('可重转');
  });
});

// ── executeReconvertForTask ───────────────────────────────────────────────────

describe('executeReconvertForTask', () => {
  const decision = {
    reconvertScenes: [1],
    escalatedScenes: [],
    shouldReconvert: true,
    shouldEscalate: false,
    reasons: [],
  };

  it('task.jobId 指向经典 job → 走经典链执行（classic-job）', async () => {
    const store = new FakeJobStore();
    store.set(makeClassicJob());
    const task = makeTask({ jobId: 'job-reconvert-1' });
    const provider = new MockReconvertProvider(FIXED_SCENE_JSON);

    const outcome = await executeReconvertForTask(task, decision, {
      provider,
      annotations: DEAD_CHAR_ANNOTATIONS,
      jobStore: store,
      ctxManager: fastCtx,
    });

    expect(outcome.status).toBe('reconverted');
    if (outcome.status === 'reconverted') {
      expect(outcome.source).toBe('classic-job');
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.identityAfter.passed).toBe(true);
    }
  });

  it('agent 独立任务无 jobId → 无经典写回目标 → needs-manual', async () => {
    const store = new FakeJobStore();
    // agent 任务已产出可转换结构化产物（phase1 实体 + phase2 场景）→ 解析为 agent-task
    const task = makeTask({
      phases: [
        {
          id: 't-analyze',
          name: 'analyze',
          description: '',
          role: 'writer',
          status: 'completed',
          retryCount: 0,
          output: {
            agentResult: JSON.stringify({
              characters: [
                { name: '老秦', aliases: ['老秦'], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 0 },
              ],
              locations: [{ name: '老宅', type: 'interior', description: '', sourceChapterIndex: 0 }],
            }),
          },
        },
        {
          id: 't-segment',
          name: 'segment',
          description: '',
          role: 'writer',
          status: 'completed',
          retryCount: 0,
          output: {
            agentResult: JSON.stringify({
              scenes: [
                {
                  sceneIndex: 0,
                  chapterIndex: 0,
                  startParagraph: 0,
                  endParagraph: 10,
                  originalStartOffset: 0,
                  originalEndOffset: CHAPTER_TEXTS[0].length,
                  draftSlugline: '老宅门口',
                  keyCharacterNames: ['老秦'],
                  summary: '重逢',
                },
              ],
            }),
          },
        },
      ],
    });
    const provider = new MockReconvertProvider(FIXED_SCENE_JSON);

    const outcome = await executeReconvertForTask(task, decision, {
      provider,
      jobStore: store,
      ctxManager: fastCtx,
    });

    expect(outcome.status).toBe('needs-manual');
    if (outcome.status === 'needs-manual') {
      expect(outcome.source).toBe('agent-task');
      expect(outcome.reason).toContain('需人工介入');
    }
  });
});
