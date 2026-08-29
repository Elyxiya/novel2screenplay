/**
 * 外科式 supervisor 手写 handoff 编排层（Task 4.4）单元测试
 *
 * 覆盖：
 * - classic-job 重转 → supervisor→writer 手写交接 completed，payload 带决策+执行结果+重跑断言
 * - agent-task 无 jobId → needs-manual → supervisor→validator 升级人工（writer 不执行）
 * - 纯 escalatedScenes（reconvertScenes 空）→ 不调经典链执行，直接 supervisor→validator
 * - 混合（重转 + 升级）→ writer + validator 两条 handoff 均留痕
 * - registry 无 agent 池 → handoff failed 但仍留痕
 * - supervisor agent 状态迁移（busy → idle）
 */

import { describe, it, expect } from 'vitest';
import type { LLMProvider, LLMMessage, LLMChatOptions, LLMChatResponse } from '@/lib/llm/types';
import type { ContextManager } from '@/lib/pipeline/ContextManager';
import type { AgentInstance } from '@/lib/multi-agent/agent-config';
import type { AgentRole } from '@/lib/multi-agent/roles';
import type { HandoffContext, HandoffPayload, HandoffRequest, HandoffResult } from '@/lib/multi-agent/handoff-protocol';
import type { ReconvertJobStore } from '@/lib/multi-agent/reconvert-bridge';
import type { StoredJob } from '@/lib/store/job-store';
import type { OrchestratorTask } from '@/lib/multi-agent/orchestrator';
import type { ReconvertDecision } from '@/lib/multi-agent/reconvert-decision';
import {
  type SurgicalRegistry,
  type SurgicalHandoffSink,
} from '@/lib/multi-agent/supervisor-reconvert';
import { executeSurgicalReconvert } from '@/lib/multi-agent/supervisor-reconvert';

// ── 快速 token 计数（避免测试加载 tiktoken）──────────────────────────────────────
const fastCtx = { countTokens: async (text: string) => text.length } as unknown as ContextManager;

// ── Fake JobStore ──────────────────────────────────────────────────────────────
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

// ── Mock LLM Provider ──────────────────────────────────────────────────────────
class MockReconvertProvider implements LLMProvider {
  name = 'mock-reconvert';
  modelId = 'mock-model';
  description = 'Mock provider for supervisor reconvert tests';
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

// ── Fake Registry（SurgicalRegistry 窄接口）────────────────────────────────────
class FakeRegistry implements SurgicalRegistry {
  agents = new Map<string, AgentInstance>();
  busyCalls: Array<{ instanceId: string; taskId: string }> = [];
  idleCalls: string[] = [];
  add(instanceId: string, role: AgentRole, idle = true): void {
    this.agents.set(instanceId, {
      instanceId,
      config: {
        id: instanceId,
        role,
        name: role,
        description: '',
        modelId: 'mock-model',
        temperature: 0,
        maxTokens: 4096,
        maxTotalTokens: 200000,
        maxSteps: 30,
        verbose: false,
        tools: [],
        systemPrompt: '',
      },
      status: idle ? 'idle' : 'busy',
      currentTaskId: null,
      lastActiveAt: 0,
      completedTasks: 0,
      totalTokenUsage: 0,
    });
  }
  getAvailableByRole(role: AgentRole): AgentInstance[] {
    return Array.from(this.agents.values()).filter((a) => a.config.role === role && a.status === 'idle');
  }
  getByRole(role: AgentRole): AgentInstance[] {
    return Array.from(this.agents.values()).filter((a) => a.config.role === role);
  }
  markBusy(instanceId: string, taskId: string): void {
    this.busyCalls.push({ instanceId, taskId });
    const a = this.agents.get(instanceId);
    if (a) {
      a.status = 'busy';
      a.currentTaskId = taskId;
    }
  }
  markIdle(instanceId: string): void {
    this.idleCalls.push(instanceId);
    const a = this.agents.get(instanceId);
    if (a) {
      a.status = 'idle';
      a.currentTaskId = null;
    }
  }
}

// ── Fake Handoff Sink（SurgicalHandoffSink 窄接口）────────────────────────────
class FakeHandoffSink implements SurgicalHandoffSink {
  requests: Array<{ taskId: string; fromRole: string; toRole: string; reason: string; payload: HandoffPayload }> = [];
  completed: string[] = [];
  /** 无可用目标 agent 时 requestHandoff 返回失败（模拟真实 HandoffManager 行为） */
  noAgentPool = false;
  private seq = 0;
  async requestHandoff(req: HandoffRequest): Promise<HandoffResult> {
    this.requests.push({
      taskId: req.taskId,
      fromRole: req.fromRole,
      toRole: req.toRole,
      reason: req.reason,
      payload: req.payload,
    });
    if (this.noAgentPool) {
      return { success: false, handoff: {} as HandoffContext, accepted: false, message: '没有可用的目标 Agent' };
    }
    const id = `handoff_fake_${++this.seq}`;
    return {
      success: true,
      accepted: true,
      message: '交接已接受',
      handoff: {
        id,
        taskId: req.taskId,
        fromRole: req.fromRole,
        fromInstanceId: req.fromInstanceId,
        toRole: req.toRole,
        status: 'in_progress' as const,
        reason: req.reason,
        payload: req.payload,
        createdAt: Date.now(),
        completedAt: null,
      },
    };
  }
  async completeHandoff(handoffId: string): Promise<void> {
    this.completed.push(handoffId);
  }
}

// ── Fixtures（复用 reconvert-bridge 测试的数据形状）────────────────────────────
const CHAPTER_TEXTS = [
  '第一章 重逢\n老宅门口，阿福推门而入。\n秦爷在堂中抬头。',
  '第二章 死讯\n老秦倒在堂前。\n阿福悲愤交加。',
];

const DEAD_CHAR_ANNOTATIONS = {
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
          { type: 'dialogue' as const, characterId: 'char_01', line: '秦爷？', sourceRefs: [] },
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
          { type: 'dialogue' as const, characterId: 'char_01', line: '秦爷！你醒醒！', sourceRefs: [] },
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

const FIXED_SCENE_JSON = JSON.stringify({
  content: [{ type: 'dialogue', characterId: '阿福', line: '大哥！你醒醒！', sourceRefs: [] }],
  summary: '阿福悲恸呼唤',
  confidence: 0.92,
  timeOfDay: 'night',
});

function baseDecision(overrides: Partial<ReconvertDecision> = {}): ReconvertDecision {
  return {
    reconvertScenes: [1],
    escalatedScenes: [],
    shouldReconvert: true,
    shouldEscalate: false,
    reasons: [{ ruleId: 'dead-character-speaks', sceneNumber: 1, message: '已死角色开口' }],
    ...overrides,
  };
}

function baseRegistry(): FakeRegistry {
  const r = new FakeRegistry();
  r.add('sup-1', 'supervisor');
  r.add('writer-1', 'writer');
  r.add('validator-1', 'validator');
  return r;
}

function baseEnv() {
  const store = new FakeJobStore();
  store.set(makeClassicJob());
  const provider = new MockReconvertProvider(FIXED_SCENE_JSON);
  return { store, provider };
}

describe('executeSurgicalReconvert', () => {
  it('classic-job 重转 → supervisor→writer 手写交接 completed，payload 带决策+重跑断言', async () => {
    const { store, provider } = baseEnv();
    const registry = baseRegistry();
    const handoff = new FakeHandoffSink();
    const task = makeTask({ jobId: 'job-reconvert-1' });

    const result = await executeSurgicalReconvert(task, baseDecision(), {
      provider,
      annotations: DEAD_CHAR_ANNOTATIONS,
      jobStore: store,
      ctxManager: fastCtx,
      registry,
      handoffManager: handoff,
    });

    expect(result.outcome?.status).toBe('reconverted');
    expect(result.handoffs).toHaveLength(1);
    const h = result.handoffs[0];
    expect(h.toRole).toBe('writer');
    expect(h.status).toBe('completed');
    expect(h.sceneNumbers).toEqual([1]);
    expect(h.reason).toContain('#1');

    // handoff 请求留痕：payload 含决策与断言结果
    const req = handoff.requests[0];
    expect(req.fromRole).toBe('supervisor');
    expect(req.toRole).toBe('writer');
    expect(req.payload.metadata?.reconvertedSceneNumbers).toEqual([1]);
    expect(req.payload.metadata?.identityAfter).toMatchObject({ passed: true });
    expect(handoff.completed).toHaveLength(1);
  });

  it('agent-task 无 jobId → needs-manual → supervisor→validator 升级人工（writer 不执行）', async () => {
    const { store, provider } = baseEnv();
    const registry = baseRegistry();
    const handoff = new FakeHandoffSink();
    const task = makeTask({ jobId: undefined });

    const result = await executeSurgicalReconvert(task, baseDecision(), {
      provider,
      jobStore: store,
      ctxManager: fastCtx,
      registry,
      handoffManager: handoff,
    });

    expect(result.outcome?.status).toBe('needs-manual');
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs[0].toRole).toBe('validator');
    expect(result.handoffs[0].status).toBe('completed');
    expect(result.handoffs[0].reason).toContain('人工介入');
    expect(handoff.requests.every((r) => r.toRole === 'validator')).toBe(true);
  });

  it('纯 escalatedScenes（reconvertScenes 空）→ 不调经典链执行，直接 supervisor→validator', async () => {
    const { store, provider } = baseEnv();
    const registry = baseRegistry();
    const handoff = new FakeHandoffSink();
    const task = makeTask({ jobId: 'job-reconvert-1' });
    const decision = baseDecision({
      reconvertScenes: [],
      escalatedScenes: [1],
      shouldReconvert: false,
      shouldEscalate: true,
    });

    const result = await executeSurgicalReconvert(task, decision, {
      provider,
      jobStore: store,
      ctxManager: fastCtx,
      registry,
      handoffManager: handoff,
    });

    // 无执行层调用（无 outcome），只有升级 handoff
    expect(result.outcome).toBeUndefined();
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs[0].toRole).toBe('validator');
    expect(result.handoffs[0].sceneNumbers).toEqual([1]);
    // 经典 job 未被写回（未执行重转）
    expect(store.get('job-reconvert-1')!.pipelineState.phase3Output![1].content[0].characterId).toBe('char_01');
  });

  it('混合（重转 + 升级）→ writer + validator 两条 handoff 均留痕', async () => {
    const { store, provider } = baseEnv();
    const registry = baseRegistry();
    const handoff = new FakeHandoffSink();
    const task = makeTask({ jobId: 'job-reconvert-1' });
    const decision = baseDecision({
      reconvertScenes: [1],
      escalatedScenes: [2],
      shouldReconvert: true,
      shouldEscalate: true,
      reasons: [
        { ruleId: 'dead-character-speaks', sceneNumber: 1, message: 'a' },
        { ruleId: 'dead-character-speaks', sceneNumber: 2, message: 'b' },
      ],
    });

    const result = await executeSurgicalReconvert(task, decision, {
      provider,
      annotations: DEAD_CHAR_ANNOTATIONS,
      jobStore: store,
      ctxManager: fastCtx,
      registry,
      handoffManager: handoff,
    });

    expect(result.outcome?.status).toBe('reconverted');
    expect(result.handoffs).toHaveLength(2);
    expect(result.handoffs.map((h) => h.toRole)).toEqual(['writer', 'validator']);
    expect(result.handoffs[0].sceneNumbers).toEqual([1]);
    expect(result.handoffs[1].sceneNumbers).toEqual([2]);
    expect(handoff.requests.map((r) => r.toRole)).toEqual(['writer', 'validator']);
  });

  it('registry 无 agent 池 → handoff failed 但仍留痕（对照证据不丢）', async () => {
    const { store, provider } = baseEnv();
    const registry = new FakeRegistry(); // 空池：无 supervisor/writer/validator
    const handoff = new FakeHandoffSink();
    handoff.noAgentPool = true;
    const task = makeTask({ jobId: 'job-reconvert-1' });

    const result = await executeSurgicalReconvert(task, baseDecision(), {
      provider,
      annotations: DEAD_CHAR_ANNOTATIONS,
      jobStore: store,
      ctxManager: fastCtx,
      registry,
      handoffManager: handoff,
    });

    // 经典链执行仍完成（registry/handoff 只是留痕层，不影响执行）
    expect(result.outcome?.status).toBe('reconverted');
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs[0].status).toBe('failed');
    expect(result.handoffs[0].handoffId).toBe('');
  });

  it('supervisor agent 状态迁移：busy → idle，目标 agent 释放', async () => {
    const { store, provider } = baseEnv();
    const registry = baseRegistry();
    const handoff = new FakeHandoffSink();
    const task = makeTask({ jobId: 'job-reconvert-1' });

    const result = await executeSurgicalReconvert(task, baseDecision(), {
      provider,
      annotations: DEAD_CHAR_ANNOTATIONS,
      jobStore: store,
      ctxManager: fastCtx,
      registry,
      handoffManager: handoff,
    });

    expect(result.outcome?.status).toBe('reconverted');
    // supervisor busy 过、最终 idle；writer 忙后被释放
    expect(registry.busyCalls.map((b) => b.instanceId)).toContain('sup-1');
    expect(registry.idleCalls).toContain('sup-1');
    expect(registry.idleCalls).toContain('writer-1');
    expect(registry.agents.get('sup-1')!.status).toBe('idle');
    expect(registry.agents.get('writer-1')!.status).toBe('idle');
  });

  it('metadata 决策快照可被审计读取（手写对照证据内容）', async () => {
    const { store, provider } = baseEnv();
    const registry = baseRegistry();
    const handoff = new FakeHandoffSink();
    const task = makeTask({ jobId: 'job-reconvert-1' });
    const decision = baseDecision();

    await executeSurgicalReconvert(task, decision, {
      provider,
      annotations: DEAD_CHAR_ANNOTATIONS,
      jobStore: store,
      ctxManager: fastCtx,
      registry,
      handoffManager: handoff,
    });

    const meta = handoff.requests[0].payload.metadata as Record<string, unknown>;
    expect(meta.decision).toMatchObject({ reconvertScenes: [1], escalatedScenes: [] });
    expect(meta.identityAfter).toMatchObject({ passed: true });
  });
});
