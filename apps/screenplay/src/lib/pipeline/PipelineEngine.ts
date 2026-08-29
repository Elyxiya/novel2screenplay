import type { LLMProvider } from '../llm/types';
import { resolveProvider, resolveDefaultProvider } from '../llm/llm-gateway';
import { jobStore } from '../store/job-store';
import { parseNovel } from '../novel/parser';
import { ContextManager } from './ContextManager';
import { createPhase1Budget } from './phase1-budget';
import { Phase1Analyzer } from './Phase1Analyzer';
import { Phase2Segmenter } from './Phase2Segmenter';
import { Phase3SceneConverter } from './Phase3SceneConverter';
import { Phase4Merger } from './Phase4Merger';
import type { StoredJob } from '../store/job-store';
import { getSSEClientManager } from '../sse';
import { getNovelRepository, getHistoryRepository } from '../store/sqlite';
import { serializeToYaml } from '@novel/contracts/serializers';
import type { Screenplay } from '@novel/contracts/screenplay';
import { assessPipelineScreenplay } from '../eval/llm-quality';
import type { QualityAssessment } from '../multi-agent/handoff-protocol';

type SSEEventType = 'progress' | 'log' | 'phase' | 'complete' | 'error' | 'heartbeat' | 'quality';

/**
 * PipelineEngine orchestrates the 4-phase LLM conversion pipeline.
 *
 * Phases:
 *   1. Analysis — extract characters, locations, timeline
 *   2. Segmentation — split chapters into scenes
 *   3. Scene Conversion — convert each scene to screenplay format (parallel)
 *   4. Merge & Validate — dedup, resolve IDs, compute analytics, generate YAML
 */
export class PipelineEngine {
  private ctxManager = new ContextManager();
  private sseManager = getSSEClientManager();

  /**
   * 通过 SSE 发送事件到所有订阅该 Job 的客户端
   */
  private emitSSE(jobId: string, eventType: SSEEventType, data: unknown): void {
    this.sseManager.sendToJob(jobId, {
      type: eventType,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Start a new conversion pipeline job.
   * Returns the job ID for status polling.
   */
  async startJob(input: {
    novelText: string;
    title?: string;
    author?: string;
    modelId?: string;
    temperature?: number;
    selectedChapters?: number[];
    novelId?: string;
    userId?: string;
  }): Promise<string> {
    // Parse novel text into chapters
    const parseResult = parseNovel(input.novelText);

    if (parseResult.chapters.length === 0) {
      throw new Error('未检测到有效章节内容');
    }

    // All chapters (for result page original text display)
    const allChapterTexts = parseResult.chapters.map((c) => c.text);
    // Chapters objects filtered to selected (for Phase1/Phase2)
    // 注意：selectedChapters 空数组视作「未选择」→ 回退全量章节，避免空输入导致幻觉输出
    const selectedChapterObjs =
      input.selectedChapters && input.selectedChapters.length > 0
        ? input.selectedChapters.map(i => parseResult.chapters[i]).filter(Boolean)
        : parseResult.chapters;

    // Get LLM provider（用户导入优先，回退全局 env；modelId 缺省时用默认）
    const provider = resolveProvider(input.userId, input.modelId);

    if (!provider) {
      throw new Error(
        '未配置 LLM Provider。请在 .env.local 中设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY',
      );
    }

    // Create job — store ALL chapters (for result page original text)
    const jobId = jobStore.create({
      novelText: input.novelText,
      chapterTexts: allChapterTexts,
      modelId: provider.modelId,
      selectedChapters: input.selectedChapters && input.selectedChapters.length > 0
        ? input.selectedChapters
        : parseResult.chapters.map((c) => c.index),
      temperature: input.temperature ?? 0.7,
      novelId: input.novelId,
      title: input.title,
      author: input.author,
      userId: input.userId,
    });

    // Start pipeline asynchronously (don't await — let it run in background)
    this.runPipeline(jobId, provider, selectedChapterObjs, input).catch((err) => {
      const errorMsg = (err as Error).message;
      jobStore.update(jobId, (job) => {
        const updated = {
          ...job,
          status: 'failed' as const,
          error: errorMsg,
          logs: [
            ...job.logs,
            { timestamp: Date.now(), level: 'error' as const, message: `流水线失败: ${errorMsg}` },
          ],
        };
        this.emitSSE(jobId, 'error', { error: errorMsg });
        this.emitSSE(jobId, 'log', { message: `流水线失败: ${errorMsg}`, level: 'error' });
        return updated;
      });
    });

    return jobId;
  }

  /**
   * Resume a failed job from Phase 3 (convert failed/pending scenes only).
   */
  async resumeJob(jobId: string): Promise<void> {
    const job = jobStore.get(jobId);
    if (!job) throw new Error(`任务 ${jobId} 不存在`);

    if (jobStore.isRecovering(jobId)) {
      throw new Error(`任务 ${jobId} 正在恢复中，请勿重复操作`);
    }

    if (!jobStore.tryLockRecover(jobId)) {
      throw new Error(`任务 ${jobId} 正在恢复中`);
    }

    try {
      const failedScenes = job.scenesStatus
        .filter((s) => s.status === 'failed' || s.status === 'pending')
        .map((s) => s.sceneIndex);

      if (failedScenes.length === 0) {
        jobStore.update(jobId, (j) => ({
          ...j,
          status: 'completed' as const,
          logs: [...j.logs, { timestamp: Date.now(), level: 'info' as const, message: '所有场景已完成，无需恢复' }],
        }));
        return;
      }

      // TODO: Re-run Phase 3 for failed scenes only, then Phase 4
      // For V1, just re-run the full pipeline
      const provider = resolveDefaultProvider(job.userId);
      if (!provider) throw new Error('未配置 LLM Provider');

      jobStore.update(jobId, (j) => ({
        ...j,
        status: 'converting' as const,
        currentPhase: 3 as StoredJob['currentPhase'],
        logs: [...j.logs, { timestamp: Date.now(), level: 'info' as const, message: `开始恢复 ${failedScenes.length} 个失败场景` }],
      }));

      // Re-run just Phase 3
      const phase3 = new Phase3SceneConverter(provider, this.ctxManager);
      const phase2Output = job.pipelineState.phase2Output!;
      const phase1Output = job.pipelineState.phase1Output!;

      const sceneDefs = phase2Output.scenes.filter((s) =>
        failedScenes.includes(s.sceneIndex),
      );

      const results = await phase3.convertScenes(
        sceneDefs,
        phase1Output.characters,
        phase1Output.locations,
        job.chapterTexts,
        jobStore,
        jobId,
        undefined,
        { settingCard: phase1Output.settingCard },
      );

      // Merge old + new results
      const oldOutputs = job.pipelineState.phase3Output || [];
      const allOutputs = oldOutputs.map((o) =>
        results.find((r) => r.sceneNumber === o.sceneNumber) || o,
      );

      // Re-run Phase 4
      const phase4 = new Phase4Merger();
      const { screenplay, fixes } = await phase4.merge(
        { title: '剧本', author: '', sourceNovel: '剧本' },
        phase1Output,
        phase2Output,
        allOutputs,
      );

      jobStore.update(jobId, (j) => ({
        ...j,
        status: 'completed' as const,
        currentPhase: 4,
        progress: 100,
        pipelineState: { ...j.pipelineState, phase3Output: allOutputs, phase4Output: screenplay },
        resultId: screenplay.metadata.title,
        logs: [
          ...j.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `恢复完成，共 ${fixes.length} 项修正` },
        ],
      }));
    } finally {
      jobStore.unlockRecover(jobId);
    }
  }

  /**
   * Cancel a running job.
   */
  cancelJob(jobId: string): void {
    const job = jobStore.get(jobId);
    if (!job) return;

    jobStore.update(jobId, (j) => ({
      ...j,
      status: 'pending' as const,
      currentPhase: 0 as StoredJob['currentPhase'],
      progress: 0,
      subProgress: null,
      scenesStatus: [],
      pipelineState: {},
      logs: [
        ...j.logs,
        { timestamp: Date.now(), level: 'info' as const, message: '用户取消了转换' },
      ],
      error: undefined,
    }));
  }

  /**
   * Get job status.
   */
  getJobStatus(jobId: string): StoredJob | undefined {
    return jobStore.get(jobId);
  }

  /**
   * Internal: run the full 4-phase pipeline.
   * @param chapters  Only the chapters selected for conversion (filtered by selectedChapters).
   */
  private async runPipeline(
    jobId: string,
    provider: LLMProvider,
    chapters: Array<{ index: number; title: string; text: string }>,
    input: { title?: string; author?: string },
  ): Promise<void> {

    console.log(`[${jobId}] === PIPELINE STARTED ===`);
    console.log(`[${jobId}] provider=${provider.name}(${provider.modelId}), chapters=${chapters.length}`);

    // 阶段耗时统计（供调试评测使用）
    const phaseTimings: Record<string, { durationMs: number }> = {};
    const recordTiming = (phase: string, startedAt: number): void => {
      phaseTimings[phase] = { durationMs: Date.now() - startedAt };
    };
    const withTiming = (job: StoredJob): Record<string, unknown> => ({
      ...(job.metadata ?? {}),
      phaseTimings: { ...phaseTimings },
    });

    // ── Phase 1: Analyze ──
    const t1 = Date.now();
    console.log(`[${jobId}] Phase 1: 开始分析角色与地点 (${chapters.length} 章, ${chapters.reduce((s,c) => s + c.text.length, 0)} 字)`);
    jobStore.update(jobId, (job) => {
      const updated = {
        ...job,
        status: 'analyzing' as const,
        currentPhase: 1 as StoredJob['currentPhase'],
        progress: 10,
        logs: [...job.logs, { timestamp: Date.now(), level: 'info' as const, message: 'Phase 1: 开始分析角色与地点...' }],
      };
      this.emitSSE(jobId, 'phase', { phase: 1, status: 'analyzing', progress: 10 });
      this.emitSSE(jobId, 'log', { message: 'Phase 1: 开始分析角色与地点...', level: 'info' });
      return updated;
    });

    const phase1 = new Phase1Analyzer(
      provider,
      this.ctxManager,
      createPhase1Budget({
        modelId: provider.modelId,
        enabled: true,
        onBlocked: (site, reason) => {
          console.log(`[${jobId}] Phase1 预算守卫拦截（${site}）: ${reason}`);
          jobStore.update(jobId, (job) => {
            const meta = { ...(job.metadata || {}) } as Record<string, unknown>;
            const prev = (meta.budgetBlocked as number) || 0;
            meta.budgetBlocked = prev + 1;
            return { ...job, metadata: meta };
          });
        },
      }),
    );
    const phase1Output = await phase1.analyze(
      chapters.map((c) => ({ index: c.index, title: c.title, text: c.text })),
    );

    console.log(`[${jobId}] Phase 1 完成: ${phase1Output.characters.length} 角色, ${phase1Output.locations.length} 地点`);
    recordTiming('analyze', t1);
    jobStore.update(jobId, (job) => {
      const updated = {
        ...job,
        progress: 25,
        metadata: withTiming(job),
        pipelineState: { ...job.pipelineState, phase1Output },
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `Phase 1 完成: 提取到 ${phase1Output.characters.length} 个角色、${phase1Output.locations.length} 个地点` },
        ],
      };
      this.emitSSE(jobId, 'progress', { progress: 25 });
      this.emitSSE(jobId, 'log', { message: `Phase 1 完成: 提取到 ${phase1Output.characters.length} 个角色、${phase1Output.locations.length} 个地点`, level: 'info' });
      return updated;
    });

    // ── Phase 2: Segment ──
    const t2 = Date.now();
    console.log(`[${jobId}] Phase 2: 开始场景切割...`);
    jobStore.update(jobId, (job) => {
      const updated = {
        ...job,
        status: 'segmenting' as const,
        currentPhase: 2 as StoredJob['currentPhase'],
        progress: 30,
        logs: [...job.logs, { timestamp: Date.now(), level: 'info' as const, message: 'Phase 2: 开始场景切割...' }],
      };
      this.emitSSE(jobId, 'phase', { phase: 2, status: 'segmenting', progress: 30 });
      this.emitSSE(jobId, 'log', { message: 'Phase 2: 开始场景切割...', level: 'info' });
      return updated;
    });

    const phase2 = new Phase2Segmenter(provider, this.ctxManager);
    const phase2Output = await phase2.segment(
      chapters.map((c) => ({ index: c.index, title: c.title, text: c.text })),
      phase1Output,
    );

    console.log(`[${jobId}] Phase 2 完成: ${phase2Output.scenes.length} 个场景`);
    recordTiming('segment', t2);
    jobStore.update(jobId, (job) => {
      const updated = {
        ...job,
        progress: 45,
        metadata: withTiming(job),
        pipelineState: { ...job.pipelineState, phase2Output },
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `Phase 2 完成: 识别到 ${phase2Output.scenes.length} 个场景` },
        ],
      };
      this.emitSSE(jobId, 'progress', { progress: 45 });
      this.emitSSE(jobId, 'log', { message: `Phase 2 完成: 识别到 ${phase2Output.scenes.length} 个场景`, level: 'info' });
      return updated;
    });

    // ── Phase 3: Convert Scenes (Parallel) ──
    const t3 = Date.now();
    console.log(`[${jobId}] Phase 3: 开始并行转换 ${phase2Output.scenes.length} 个场景...`);
    jobStore.update(jobId, (job) => {
      const updated = {
        ...job,
        status: 'converting' as const,
        currentPhase: 3 as StoredJob['currentPhase'],
        progress: 50,
        logs: [...job.logs, { timestamp: Date.now(), level: 'info' as const, message: `Phase 3: 开始并行转换 ${phase2Output.scenes.length} 个场景...` }],
      };
      this.emitSSE(jobId, 'phase', { phase: 3, status: 'converting', progress: 50 });
      this.emitSSE(jobId, 'log', { message: `Phase 3: 开始并行转换 ${phase2Output.scenes.length} 个场景...`, level: 'info' });
      return updated;
    });

    const phase3 = new Phase3SceneConverter(provider, this.ctxManager);
    const phase3Outputs = await phase3.convertScenes(
      phase2Output.scenes,
      phase1Output.characters,
      phase1Output.locations,
      chapters.map((c) => c.text),
      jobStore,
      jobId,
      undefined,
      { settingCard: phase1Output.settingCard },
    );

    const successCount = phase3Outputs.filter((o) => o.confidence > 0.5).length;
    console.log(`[${jobId}] Phase 3 完成: ${successCount}/${phase3Outputs.length} 场景成功`);
    recordTiming('convert', t3);
    jobStore.update(jobId, (job) => {
      const updated = {
        ...job,
        progress: 75,
        metadata: withTiming(job),
        pipelineState: { ...job.pipelineState, phase3Output: phase3Outputs },
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `Phase 3 完成: 成功转换 ${successCount}/${phase3Outputs.length} 个场景` },
        ],
      };
      this.emitSSE(jobId, 'progress', { progress: 75 });
      this.emitSSE(jobId, 'log', { message: `Phase 3 完成: 成功转换 ${successCount}/${phase3Outputs.length} 个场景`, level: 'info' });
      return updated;
    });

    // ── Phase 4: Merge & Validate ──
    const t4 = Date.now();
    console.log(`[${jobId}] Phase 4: 开始合并校验...`);
    jobStore.update(jobId, (job) => {
      const updated = {
        ...job,
        status: 'merging' as const,
        currentPhase: 4,
        progress: 80,
        logs: [...job.logs, { timestamp: Date.now(), level: 'info' as const, message: 'Phase 4: 开始合并校验...' }],
      };
      this.emitSSE(jobId, 'phase', { phase: 4, status: 'merging', progress: 80 });
      this.emitSSE(jobId, 'log', { message: 'Phase 4: 开始合并校验...', level: 'info' });
      return updated;
    });

    const phase4 = new Phase4Merger();
    const { screenplay, fixes } = await phase4.merge(
      {
        title: input.title || (chapters.length > 0 ? chapters[0].title : '未命名'),
        author: input.author || '',
        sourceNovel: input.title || (chapters.length > 0 ? chapters[0].title : '未命名'),
      },
      phase1Output,
      phase2Output,
      phase3Outputs,
    );

    console.log(`[${jobId}] ✅ 转换完成! fixes=${fixes?.length ?? 0}`);
    recordTiming('merge', t4);
    jobStore.update(jobId, (job) => {
      const updated = {
        ...job,
        status: 'completed' as const,
        currentPhase: 4,
        progress: 100,
        metadata: withTiming(job),
        pipelineState: { ...job.pipelineState, phase4Output: screenplay },
        resultId: screenplay.metadata.title,
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `✅ 转换完成！共 ${fixes.length} 项自动修正` },
          { timestamp: Date.now(), level: 'info' as const, message: `📊 对白 ${screenplay.analytics?.dialoguePercentage ?? '?'}% | 动作 ${screenplay.analytics?.actionPercentage ?? '?'}% | ${screenplay.metadata.totalScenes} 场景` },
        ],
      };
      this.emitSSE(jobId, 'complete', {
        resultId: screenplay.metadata.title,
        analytics: screenplay.analytics,
        fixes: fixes.length,
      });
      this.emitSSE(jobId, 'progress', { progress: 100 });
      this.emitSSE(jobId, 'log', { message: `✅ 转换完成！共 ${fixes.length} 项自动修正`, level: 'info' });
      return updated;
    });

    // ── 工作台联动：更新小说资产已转换章节 + 写入历史表 ──
    try {
      const finished = jobStore.get(jobId);
      if (finished?.novelId) {
        const novelRepo = getNovelRepository();
        const selected = finished.config.selectedChapters ?? [];
        const novel = novelRepo.get(finished.novelId);
        if (novel) {
          // 章节索引即选中列表（与 novel.chapters 的 index 对应）
          novelRepo.markChaptersConverted(finished.novelId, selected, jobId);
          console.log(`[${jobId}] 已更新小说资产 ${finished.novelId} 转换进度: ${novel.convertedCount}/${novel.totalChapters} -> ${selected.length} 章新增`);
        }
      }
      const historyRepo = getHistoryRepository();
      historyRepo.create({
        jobId,
        title: screenplay.metadata.title,
        author: input.author,
        sceneCount: screenplay.metadata.totalScenes,
        characterCount: screenplay.metadata.totalCharacters,
        locationCount: screenplay.metadata.totalLocations,
        yamlContent: serializeToYaml(screenplay),
        userId: finished?.userId,
      });
    } catch (err) {
      console.error(`[${jobId}] 工作台数据更新失败: ${(err as Error).message}`);
    }

    // ── P-评估：LLM 质量评估（异步、不阻塞完成，结果持久化到 pipelineState）──
    this.evaluatePipelineQuality(jobId, provider, screenplay).catch((err) => {
      console.warn(`[${jobId}] LLM 质量评估失败: ${(err as Error).message}`);
    });

    console.log(`[${jobId}] === PIPELINE COMPLETE ===`);
  }

  /**
   * P-评估：传统管线接入 LLM 质量评估。
   * 对最终剧本四维打分（format/consistency/coherence/drama），
   * 结果写入 job.pipelineState.qualityAssessment（SQLite 持久化）并通过 SSE 推送。
   */
  private async evaluatePipelineQuality(
    jobId: string,
    provider: LLMProvider,
    screenplay: Screenplay,
  ): Promise<void> {
    const assessment: QualityAssessment = await assessPipelineScreenplay(provider, screenplay);

    jobStore.update(jobId, (job) => ({
      ...job,
      pipelineState: { ...job.pipelineState, qualityAssessment: assessment },
    }));

    this.emitSSE(jobId, 'quality', { assessment });
    console.log(`[${jobId}] LLM 质量评估完成: ${assessment.score} 分`);
  }
}
