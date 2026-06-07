import type { LLMProvider } from '../llm/types';
import { llmRegistry } from '../llm/registry';
import { jobStore } from '../store/job-store';
import { parseNovel } from '../novel/parser';
import { ContextManager } from './ContextManager';
import { Phase1Analyzer } from './Phase1Analyzer';
import { Phase2Segmenter } from './Phase2Segmenter';
import { Phase3SceneConverter } from './Phase3SceneConverter';
import { Phase4Merger } from './Phase4Merger';
import type { StoredJob } from '../store/job-store';

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
  }): Promise<string> {
    // Parse novel text into chapters
    const parseResult = parseNovel(input.novelText, input.title);

    if (parseResult.chapters.length === 0) {
      throw new Error('未检测到有效章节内容');
    }

    const chapterTexts = parseResult.chapters.map((c) => c.text);

    // Get LLM provider
    const provider = input.modelId
      ? llmRegistry.get(input.modelId) || llmRegistry.getDefault()
      : llmRegistry.getDefault();

    if (!provider) {
      throw new Error(
        '未配置 LLM Provider。请在 .env.local 中设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY',
      );
    }

    // Create job
    const jobId = jobStore.create({
      novelText: input.novelText,
      chapterTexts,
      modelId: provider.modelId,
      selectedChapters: parseResult.chapters.map((c) => c.index),
      temperature: input.temperature ?? 0.7,
    });

    // Start pipeline asynchronously (don't await — let it run in background)
    this.runPipeline(jobId, provider, parseResult, input).catch((err) => {
      jobStore.update(jobId, (job) => ({
        ...job,
        status: 'failed',
        error: (err as Error).message,
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'error', message: `流水线失败: ${(err as Error).message}` },
        ],
      }));
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
      const parseResult = parseNovel(job.novelText);
      const provider = llmRegistry.getDefault();
      if (!provider) throw new Error('未配置 LLM Provider');

      jobStore.update(jobId, (j) => ({
        ...j,
        status: 'converting' as const,
        currentPhase: 3,
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
      );

      // Merge old + new results
      const oldOutputs = job.pipelineState.phase3Output || [];
      const allOutputs = oldOutputs.map((o) =>
        results.find((r) => r.sceneNumber === o.sceneNumber) || o,
      );

      // Re-run Phase 4
      const phase4 = new Phase4Merger();
      const { screenplay, fixes } = await phase4.merge(
        { title: parseResult.title, author: '', sourceNovel: parseResult.title },
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
      currentPhase: 0,
      progress: 0,
      subProgress: null,
      scenesStatus: [],
      pipelineState: {},
      logs: [
        ...j.logs,
        { timestamp: Date.now(), level: 'info' as const, message: '用户取消了转换' },
      ],
      error: null,
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
   */
  private async runPipeline(
    jobId: string,
    provider: LLMProvider,
    parseResult: ReturnType<typeof parseNovel>,
    input: { title?: string; author?: string },
  ): Promise<void> {
    const { chapters } = parseResult;

    console.log(`[${jobId}] === PIPELINE STARTED ===`);
    console.log(`[${jobId}] provider=${provider.name}(${provider.modelId}), chapters=${chapters.length}`);

    // ── Phase 1: Analyze ──
    console.log(`[${jobId}] Phase 1: 开始分析角色与地点 (${chapters.length} 章, ${chapters.reduce((s,c) => s + c.text.length, 0)} 字)`);
    jobStore.update(jobId, (job) => ({
      ...job,
      status: 'analyzing' as const,
      currentPhase: 1,
      progress: 10,
      logs: [...job.logs, { timestamp: Date.now(), level: 'info' as const, message: 'Phase 1: 开始分析角色与地点...' }],
    }));

    const phase1 = new Phase1Analyzer(provider, this.ctxManager);
    const phase1Output = await phase1.analyze(
      chapters.map((c) => ({ index: c.index, title: c.title, text: c.text })),
    );

    console.log(`[${jobId}] Phase 1 完成: ${phase1Output.characters.length} 角色, ${phase1Output.locations.length} 地点`);
    jobStore.update(jobId, (job) => ({
      ...job,
      progress: 25,
      pipelineState: { ...job.pipelineState, phase1Output },
      logs: [
        ...job.logs,
        { timestamp: Date.now(), level: 'info' as const, message: `Phase 1 完成: 提取到 ${phase1Output.characters.length} 个角色、${phase1Output.locations.length} 个地点` },
      ],
    }));

    // ── Phase 2: Segment ──
    console.log(`[${jobId}] Phase 2: 开始场景切割...`);
    jobStore.update(jobId, (job) => ({
      ...job,
      status: 'segmenting' as const,
      currentPhase: 2,
      progress: 30,
      logs: [...job.logs, { timestamp: Date.now(), level: 'info' as const, message: 'Phase 2: 开始场景切割...' }],
    }));

    const phase2 = new Phase2Segmenter(provider, this.ctxManager);
    const phase2Output = await phase2.segment(
      chapters.map((c) => ({ index: c.index, title: c.title, text: c.text })),
      phase1Output,
      chapters.map((c) => c.text),
    );

    console.log(`[${jobId}] Phase 2 完成: ${phase2Output.scenes.length} 个场景`);
    jobStore.update(jobId, (job) => ({
      ...job,
      progress: 45,
      pipelineState: { ...job.pipelineState, phase2Output },
      logs: [
        ...job.logs,
        { timestamp: Date.now(), level: 'info' as const, message: `Phase 2 完成: 识别到 ${phase2Output.scenes.length} 个场景` },
      ],
    }));

    // ── Phase 3: Convert Scenes (Parallel) ──
    console.log(`[${jobId}] Phase 3: 开始并行转换 ${phase2Output.scenes.length} 个场景...`);
    jobStore.update(jobId, (job) => ({
      ...job,
      status: 'converting' as const,
      currentPhase: 3,
      progress: 50,
      logs: [...job.logs, { timestamp: Date.now(), level: 'info' as const, message: `Phase 3: 开始并行转换 ${phase2Output.scenes.length} 个场景...` }],
    }));

    const phase3 = new Phase3SceneConverter(provider, this.ctxManager);
    const phase3Outputs = await phase3.convertScenes(
      phase2Output.scenes,
      phase1Output.characters,
      phase1Output.locations,
      chapters.map((c) => c.text),
      jobStore,
      jobId,
    );

    const successCount = phase3Outputs.filter((o) => o.confidence > 0.5).length;
    console.log(`[${jobId}] Phase 3 完成: ${successCount}/${phase3Outputs.length} 场景成功`);
    jobStore.update(jobId, (job) => ({
      ...job,
      progress: 75,
      pipelineState: { ...job.pipelineState, phase3Output: phase3Outputs },
      logs: [
        ...job.logs,
        { timestamp: Date.now(), level: 'info' as const, message: `Phase 3 完成: 成功转换 ${successCount}/${phase3Outputs.length} 个场景` },
      ],
    }));

    // ── Phase 4: Merge & Validate ──
    console.log(`[${jobId}] Phase 4: 开始合并校验...`);
    jobStore.update(jobId, (job) => ({
      ...job,
      status: 'merging' as const,
      currentPhase: 4,
      progress: 80,
      logs: [...job.logs, { timestamp: Date.now(), level: 'info' as const, message: 'Phase 4: 开始合并校验...' }],
    }));

    const phase4 = new Phase4Merger();
    const { screenplay, fixes } = await phase4.merge(
      {
        title: input.title || parseResult.title,
        author: input.author || '',
        sourceNovel: parseResult.title,
      },
      phase1Output,
      phase2Output,
      phase3Outputs,
    );

    console.log(`[${jobId}] ✅ 转换完成! fixes=${fixes?.length ?? 0}`);
    jobStore.update(jobId, (job) => ({
      ...job,
      status: 'completed' as const,
      currentPhase: 4,
      progress: 100,
      pipelineState: { ...job.pipelineState, phase4Output: screenplay },
      resultId: screenplay.metadata.title,
      logs: [
        ...job.logs,
        { timestamp: Date.now(), level: 'info' as const, message: `✅ 转换完成！共 ${fixes.length} 项自动修正` },
        { timestamp: Date.now(), level: 'info' as const, message: `📊 对白 ${screenplay.analytics?.dialoguePercentage ?? '?'}% | 动作 ${screenplay.analytics?.actionPercentage ?? '?'}% | ${screenplay.metadata.totalScenes} 场景` },
      ],
    }));
    console.log(`[${jobId}] === PIPELINE COMPLETE ===`);
  }
}
