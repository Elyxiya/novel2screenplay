/**
 * Agent 产物 ↔ 经典 pipelineState 互转层（Task 4.2b）单元测试
 *
 * 覆盖：
 * - resolvePipelineState：优先读经典 job；无 jobId 回退 agent 转换；两者皆无 → unavailable
 * - orchestratorTaskToPipelineState：结构化 JSON 通道 + 文本启发式 + zod 校验通过
 * - hasReconvertibleState
 * - pipelineStateToAgentContext：经典产物 → agent 监督上下文
 */

import { describe, it, expect } from 'vitest';
import { PipelineJobStateSchema } from '@novel/contracts/pipeline';
import type { OrchestratorTask } from '@/lib/multi-agent/orchestrator';
import type { StoredJob } from '@/lib/store/job-store';
import {
  resolvePipelineState,
  orchestratorTaskToPipelineState,
  hasReconvertibleState,
  pipelineStateToAgentContext,
} from '@/lib/multi-agent/agent-pipeline-bridge';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function phase(name: string, output?: unknown) {
  return {
    id: `t-${name}`,
    name,
    description: '',
    role: 'writer',
    status: 'completed' as const,
    retryCount: 0,
    ...(output !== undefined ? { output } : {}),
  };
}

function makeTask(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: 'task-bridge-1',
    input: '小说原文',
    phaseCount: 4,
    phases: [
      phase('analyze', { agentResult: '角色: 老秦\n角色: 秦爷\n地点: 老宅' }),
      phase('segment', { agentResult: '第1场 老宅门口\n老秦推门而入\n第2场 后山\n秦爷提刀而立' }),
      phase('convert', { agentResult: '第1场 老宅门口\n（老秦走进来）老秦：你来了。\n第2场 后山\n（秦爷冷笑）秦爷：等你好久了。' }),
      phase('merge', { agentResult: '剧本合并完成' }),
    ],
    ...overrides,
  };
}

const completedClassicState: StoredJob['pipelineState'] = {
  phase1Output: {
    characters: [
      {
        name: '老秦',
        aliases: ['老秦', '秦爷'],
        personalityTags: [],
        description: '',
        isMajor: true,
        sourceChapterIndex: 0,
      },
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
        originalEndOffset: 1,
        draftSlugline: '老宅门口',
        keyCharacterNames: ['老秦'],
        summary: '老秦推门而入',
      },
    ],
    rawResponses: [],
  },
  phase3Output: [
    {
      sceneNumber: 0,
      slugline: '老宅门口',
      timeOfDay: '夜',
      locationId: 'loc_1',
      characterIds: ['char_1'],
      content: [{ type: 'action', description: '老秦推门而入', sourceRefs: [] }],
      summary: '重逢',
      confidence: 0.8,
    },
  ],
};

// ── resolvePipelineState ──────────────────────────────────────────────────────

describe('resolvePipelineState', () => {
  it('优先读关联经典 job 的真实 pipelineState', async () => {
    const task = makeTask({ jobId: 'job-classic-1' });
    const readJob: (id: string) => StoredJob | undefined = (id) =>
      ({
        id,
        type: 'conversion',
        status: 'completed',
        progress: 100,
        retryCount: 0,
        maxRetries: 3,
        scenesStatus: [],
        logs: [],
        novelText: '',
        chapterTexts: [],
        config: { modelId: 'm', selectedChapters: [], temperature: 0.7 },
        pipelineState: completedClassicState,
      }) as unknown as StoredJob;

    const res = await resolvePipelineState(task, readJob);
    expect(res.source).toBe('classic-job');
    expect(res.jobId).toBe('job-classic-1');
    expect(res.convertedFromAgent).toBe(false);
    expect(res.state?.phase2Output?.scenes.length).toBe(1);
  });

  it('jobId 指向不存在的 job → 回退 agent 任务转换', async () => {
    const task = makeTask({ jobId: 'job-ghost' });
    const res = await resolvePipelineState(task, () => undefined);
    expect(res.source).toBe('agent-task');
    expect(res.convertedFromAgent).toBe(true);
    expect(res.state).not.toBeNull();
  });

  it('无 jobId → 从 agent 任务产物转换', async () => {
    const task = makeTask();
    const res = await resolvePipelineState(task);
    expect(res.source).toBe('agent-task');
    expect(res.state?.phase1Output?.characters.map((c) => c.name)).toEqual(['老秦', '秦爷']);
  });

  it('无 jobId 且 agent 无可转换产物 → unavailable', async () => {
    const task = makeTask({ phases: [phase('analyze')] });
    const res = await resolvePipelineState(task);
    expect(res.source).toBe('unavailable');
    expect(res.state).toBeNull();
  });
});

// ── orchestratorTaskToPipelineState ───────────────────────────────────────────

describe('orchestratorTaskToPipelineState', () => {
  it('文本启发式提取角色/地点/场景，且通过 zod 校验', () => {
    const state = orchestratorTaskToPipelineState(makeTask());
    const parsed = PipelineJobStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);

    expect(state.phase1Output?.characters.map((c) => c.name)).toEqual(['老秦', '秦爷']);
    expect(state.phase1Output?.locations.map((l) => l.name)).toEqual(['老宅']);
    expect(state.phase2Output?.scenes.length).toBe(2);
    expect(state.phase3Output?.length).toBe(2);
    expect(state.phase3Output?.[0].content[0].type).toBe('action');
  });

  it('结构化 JSON 通道：agentResult 为合法 JSON 时直接采用', () => {
    const task = makeTask({
      phases: [
        phase('analyze', {
          agentResult: JSON.stringify({
            characters: [{ name: '阿飞', aliases: ['阿飞'], personalityTags: [], description: '剑客', isMajor: true, sourceChapterIndex: 2 }],
            locations: [{ name: '客栈', type: 'interior', description: '', sourceChapterIndex: 2 }],
          }),
        }),
        phase('segment', {
          agentResult: JSON.stringify({
            scenes: [
              {
                sceneIndex: 0,
                chapterIndex: 2,
                startParagraph: 1,
                endParagraph: 5,
                originalStartOffset: 0,
                originalEndOffset: 1,
                draftSlugline: '客栈大堂',
                keyCharacterNames: ['阿飞'],
                summary: '阿飞进店',
              },
            ],
          }),
        }),
        phase('convert', {
          agentResult: JSON.stringify([
            {
              sceneNumber: 0,
              slugline: '客栈大堂',
              timeOfDay: '昼',
              locationId: 'loc_2',
              characterIds: ['char_2'],
              content: [{ type: 'dialogue', characterId: 'char_2', line: '小二，上酒。', sourceRefs: [] }],
              summary: '',
              confidence: 0.9,
            },
          ]),
        }),
      ],
    });

    const state = orchestratorTaskToPipelineState(task);
    const parsed = PipelineJobStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(state.phase1Output?.characters[0].name).toBe('阿飞');
    expect(state.phase1Output?.characters[0].sourceChapterIndex).toBe(2);
    expect(state.phase2Output?.scenes[0].draftSlugline).toBe('客栈大堂');
    expect(state.phase3Output?.[0].content[0].type).toBe('dialogue');
    expect(state.phase3Output?.[0].confidence).toBe(0.9);
  });

  it('无 analyze/segment/convert 产物时产空结构（不造假）且 zod 通过', () => {
    const task = makeTask({ phases: [phase('merge', { agentResult: 'x' })] });
    const state = orchestratorTaskToPipelineState(task);
    const parsed = PipelineJobStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(state.phase1Output?.characters).toEqual([]);
    expect(state.phase2Output).toBeUndefined();
    expect(state.phase3Output).toBeUndefined();
  });
});

// ── hasReconvertibleState ─────────────────────────────────────────────────────

describe('hasReconvertibleState', () => {
  it('phase1 有实体且 phase2 有场景边界 → true', () => {
    expect(hasReconvertibleState(completedClassicState)).toBe(true);
  });

  it('空状态 / 无 phase2 场景 → false', () => {
    expect(hasReconvertibleState(null)).toBe(false);
    expect(hasReconvertibleState({})).toBe(false);
    expect(
      hasReconvertibleState({
        phase1Output: completedClassicState.phase1Output,
        phase2Output: { scenes: [], rawResponses: [] },
      }),
    ).toBe(false);
  });
});

// ── pipelineStateToAgentContext ───────────────────────────────────────────────

describe('pipelineStateToAgentContext', () => {
  it('渲染角色/地点/场景/剧本统计成监督上下文', () => {
    const ctx = pipelineStateToAgentContext(completedClassicState);
    expect(ctx).toContain('角色清单（1）');
    expect(ctx).toContain('老秦（别名: 秦爷） [主角]');
    expect(ctx).toContain('地点清单（1）');
    expect(ctx).toContain('老宅（interior）');
    expect(ctx).toContain('场景清单（1）');
    expect(ctx).toContain('#0 老宅门口（章0）');
    expect(ctx).toContain('已转换场景: 1/1');
  });

  it('空状态 → 空上下文', () => {
    expect(pipelineStateToAgentContext({})).toBe('');
  });
});
