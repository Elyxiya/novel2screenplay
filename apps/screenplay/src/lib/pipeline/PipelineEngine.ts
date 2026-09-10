import type { LLMProvider } from '../llm/types';
import { resolveProvider, resolveDefaultProvider } from '../llm/llm-gateway';
import { jobStore, RECOVER_LOCK_TTL_MS } from '../store/job-store';
import { parseNovel } from '../novel/parser';
import { ContextManager } from './ContextManager';
import { createPhase1Budget } from './phase1-budget';
import { Phase1Analyzer } from './Phase1Analyzer';
import { Phase2Segmenter } from './Phase2Segmenter';
import { Phase3SceneConverter } from './Phase3SceneConverter';
import { Phase4Merger } from './Phase4Merger';
import { MetricsAccumulator } from './metrics';
import { toJobErrorPayload } from '../errors';
import { SYSTEM_PROMPT as CONVERT_SYSTEM_PROMPT } from '../llm/prompts/convert-scene';
import { createHash } from 'crypto';
import type { Phase1Output, StyleProfile, UserProfile } from '@novel/contracts/pipeline';
import { cleanNovelText } from '../preprocess/clean';
import { applyUserProfile } from './user-profile';
import { diffCharacters, diffSettingCard, computeInvalidatedScenes } from './card-edit';

/** FIX-24：版本行记录的转换提示词指纹（源文件内容 hash，前缀 16 位） */
const CONVERT_PROMPT_HASH = createHash('sha256').update(CONVERT_SYSTEM_PROMPT).digest('hex').slice(0, 16);
import type { StoredJob } from '../store/job-store';
import { getSSEClientManager } from '../sse';
import { getNovelRepository, getHistoryRepository, getNovelVersionRepository } from '../store/sqlite';
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
    /** B-09：显式复用来源任务的 Phase1 设定卡（跳过本次 LLM 分析，用户主动选择） */
    reusePhase1FromJobId?: string;
    /** FIX-13：用户自定义设定（意图通道；路由层已按 UserProfileSchema 校验） */
    userProfile?: UserProfile;
    /** FIX-12：风格五轴（路由层已完成预设解析 + StyleProfileSchema 校验） */
    styleProfile?: StyleProfile;
  }): Promise<string> {
    // FIX-11：章节解析前清洗噪声行（盗版水印/广告/章尾引导/乱码）；留痕进 pipelineState.preprocess
    const { text: cleanedNovelText, report: preprocessReport } = cleanNovelText(input.novelText);

    // Parse novel text into chapters
    const parseResult = parseNovel(cleanedNovelText);

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

    // B-09：复用来源校验（先校验后建 job，避免产生无主的半成品任务）
    let reusablePhase1: Phase1Output | undefined;
    if (input.reusePhase1FromJobId) {
      const source = jobStore.get(input.reusePhase1FromJobId);
      if (!source?.pipelineState.phase1Output) {
        throw new Error('复用的设定卡不存在（来源任务无 Phase1 产物）');
      }
      if (source.userId && source.userId !== input.userId) {
        throw new Error('无权复用该任务的设定卡');
      }
      reusablePhase1 = source.pipelineState.phase1Output;
    }

    // Create job — store ALL chapters (for result page original text)
    const jobId = jobStore.create({
      novelText: cleanedNovelText,
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

    // B-09：写入复用设定卡（审计留痕；runPipeline 将据此跳过 Phase 1）
    if (reusablePhase1) {
      jobStore.update(jobId, (job) => ({
        ...job,
        pipelineState: { ...job.pipelineState, phase1Output: reusablePhase1 },
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `Phase 1: 复用设定卡（来源任务 ${input.reusePhase1FromJobId}）` },
        ],
      }));
    }

    // FIX-11：预处理留痕（仅在有移除时写入；含分规则计数与审计样本）
    if (preprocessReport.removedLines > 0) {
      const detail = Object.entries(preprocessReport.byRule)
        .map(([rule, count]) => `${rule}×${count}`)
        .join('、');
      jobStore.update(jobId, (job) => ({
        ...job,
        pipelineState: { ...job.pipelineState, preprocess: preprocessReport },
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `预处理: 移除 ${preprocessReport.removedLines} 行噪声（${detail}）` },
        ],
      }));
    }

    // FIX-13：用户设定载入（落库；融合在 Phase1 完成后执行）
    if (input.userProfile) {
      const p = input.userProfile;
      jobStore.update(jobId, (job) => ({
        ...job,
        pipelineState: { ...job.pipelineState, userProfile: p },
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `已载入用户设定（角色覆盖 ${p.characters?.length ?? 0} / 称谓锁定 ${p.appellations?.length ?? 0} / 约束 ${p.constraints?.length ?? 0}）` },
        ],
      }));
    }

    // FIX-12：风格五轴载入（落库；Phase3 常驻注入 + 分集/序列化按 preset 消费）
    if (input.styleProfile) {
      const s = input.styleProfile;
      jobStore.update(jobId, (job) => ({
        ...job,
        pipelineState: { ...job.pipelineState, styleProfile: s },
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `已载入风格五轴（${s.channel}/${s.dialoguePolicy}/vo=${s.voPolicy}/${s.artifactForm}，集长 ${s.rhythmUnit.episodeTargetMinutes}min·${s.rhythmUnit.hookPolicy}）` },
        ],
      }));
    }

    // Start pipeline asynchronously (don't await — let it run in background)
    this.runPipeline(jobId, provider, selectedChapterObjs, input).catch((err) => {
      // FIX-22：持久化为结构化 payload（SSE/日志仍用可读文案）
      const failedJob = jobStore.get(jobId);
      const payload = toJobErrorPayload(err, {
        phase: failedJob?.currentPhase,
        provider: provider.modelId,
      });
      const errorMsg = payload.message;
      jobStore.update(jobId, (job) => {
        const updated = {
          ...job,
          status: 'failed' as const,
          error: JSON.stringify(payload),
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

    // FIX-05：心跳续锁（TTL/3 周期）——长恢复期间防止锁过期被其他进程夺走
    const heartbeat = setInterval(() => {
      jobStore.refreshRecoverLock(jobId);
    }, Math.floor(RECOVER_LOCK_TTL_MS / 3));

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

      // FIX-02b：从已落库指标恢复并继续累积（旧 job 无指标时置 partial）
      const metrics = MetricsAccumulator.restore(job.pipelineState.metrics);

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
        { settingCard: phase1Output.settingCard, metrics, userProfile: job.pipelineState.userProfile, styleProfile: job.pipelineState.styleProfile },
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
        pipelineState: { ...j.pipelineState, phase3Output: allOutputs, phase4Output: screenplay, metrics: metrics.snapshot() },
        resultId: screenplay.metadata.title,
        logs: [
          ...j.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `恢复完成，共 ${fixes.length} 项修正` },
        ],
      }));
    } finally {
      clearInterval(heartbeat);
      jobStore.unlockRecover(jobId);
    }
  }

  /**
   * B-03：设定卡编辑 → 失效集 → 局部重转（不重跑全量）。
   * 复用 resume 的锁与「单场景重转 + Phase4 重合并」通道；编辑与重转留痕（cardEditLog）。
   */
  async applyCardEdit(
    jobId: string,
    edited: {
      characters: Phase1Output['characters'];
      locations?: Phase1Output['locations'];
      settingCard?: Phase1Output['settingCard'];
    },
  ): Promise<{ invalidatedScenes: number[]; reconvertedScenes: number[] }> {
    const job = jobStore.get(jobId);
    if (!job) throw new Error(`任务 ${jobId} 不存在`);
    const oldPhase1 = job.pipelineState.phase1Output;
    const phase2Output = job.pipelineState.phase2Output;
    if (!oldPhase1 || !phase2Output) throw new Error('任务缺少 Phase1/Phase2 产物，无法应用卡编辑');

    if (!jobStore.tryLockRecover(jobId)) {
      throw new Error(`任务 ${jobId} 正在恢复/重转中，请勿重复操作`);
    }
    try {
      const newPhase1: Phase1Output = {
        ...oldPhase1,
        characters: edited.characters,
        locations: edited.locations ?? oldPhase1.locations,
        settingCard: edited.settingCard ?? oldPhase1.settingCard,
      };
      const charDiff = diffCharacters(oldPhase1.characters, newPhase1.characters);
      const cardDiff = diffSettingCard(oldPhase1.settingCard, newPhase1.settingCard);
      const invalidated = computeInvalidatedScenes(phase2Output.scenes, charDiff, cardDiff);

      jobStore.update(jobId, (j) => ({
        ...j,
        pipelineState: { ...j.pipelineState, phase1Output: newPhase1 },
        logs: [
          ...j.logs,
          {
            timestamp: Date.now(), level: 'info' as const,
            message: `设定卡编辑已应用：失效场景 ${invalidated.length} 个（主角变化=${charDiff.touchedMajor}，配角变化 ${charDiff.changedMinors.length + charDiff.addedMinors.length + charDiff.removedMinors.length}，线索窗口 ${cardDiff.threadWindows.length}，摘要章 ${cardDiff.summariesChangedChapters.length}）`,
          },
        ],
      }));

      if (invalidated.length === 0) {
        return { invalidatedScenes: [], reconvertedScenes: [] };
      }

      const provider = resolveDefaultProvider(job.userId);
      if (!provider) throw new Error('未配置 LLM Provider');
      const metrics = MetricsAccumulator.restore(job.pipelineState.metrics);

      const phase3 = new Phase3SceneConverter(provider, this.ctxManager);
      const sceneDefs = phase2Output.scenes.filter((s) => invalidated.includes(s.sceneIndex));
      const results = await phase3.convertScenes(
        sceneDefs,
        newPhase1.characters,
        newPhase1.locations,
        job.chapterTexts,
        jobStore,
        jobId,
        undefined,
        { settingCard: newPhase1.settingCard, metrics, userProfile: job.pipelineState.userProfile, styleProfile: job.pipelineState.styleProfile },
      );

      const oldOutputs = job.pipelineState.phase3Output || [];
      const allOutputs = oldOutputs.map((o) => results.find((r) => r.sceneNumber === o.sceneNumber) || o);

      const phase4 = new Phase4Merger();
      const { screenplay, fixes } = await phase4.merge(
        { title: '剧本', author: '', sourceNovel: '剧本' },
        newPhase1,
        phase2Output,
        allOutputs,
      );

      jobStore.update(jobId, (j) => ({
        ...j,
        // 重转走 Phase3 会把状态置为 converting——收尾必须恢复终态（集成测试抓到的真 bug）
        status: 'completed' as const,
        currentPhase: 4,
        progress: 100,
        pipelineState: {
          ...j.pipelineState,
          phase3Output: allOutputs,
          phase4Output: screenplay,
          metrics: metrics.snapshot(),
          cardEditLog: { editedAt: Date.now(), invalidatedCount: invalidated.length, reconvertedScenes: invalidated, touchedMajor: charDiff.touchedMajor },
        },
        resultId: screenplay.metadata.title,
        logs: [
          ...j.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `卡编辑局部重转完成：${invalidated.length} 个场景重转，${fixes.length} 项修正` },
        ],
      }));
      return { invalidatedScenes: invalidated, reconvertedScenes: invalidated };
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

    // 运行期指标累积（FIX-02b）：耗时/usage/预算拦截/占位统一进 MetricsAccumulator，
    // 在阶段边界与终态随 pipelineState.metrics 一起落库（run-local 累积，避免
    // 依赖 job.metadata——它没有持久化路径且每次 update 会从 DB 重载）
    const metrics = new MetricsAccumulator();
    const recordTiming = (phase: string, startedAt: number): void => {
      metrics.recordPhaseTiming(phase, Date.now() - startedAt);
    };
    const withTiming = (job: StoredJob): Record<string, unknown> => ({
      ...(job.metadata ?? {}),
      phaseTimings: { ...metrics.value.phaseTimings },
    });

    // ── Phase 1: Analyze（B-09：已导入历史设定卡时跳过 LLM 分析）──
    const t1 = Date.now();
    const existingPhase1 = jobStore.get(jobId)?.pipelineState.phase1Output;
    let phase1Output: Phase1Output;

    if (existingPhase1) {
      console.log(`[${jobId}] Phase 1: 复用已导入的设定卡（跳过 LLM 分析）`);
      recordTiming('analyze', t1);
      jobStore.update(jobId, (job) => {
        const updated = {
          ...job,
          status: 'analyzing' as const,
          currentPhase: 1 as StoredJob['currentPhase'],
          progress: 25,
          metadata: withTiming(job),
          pipelineState: { ...job.pipelineState, metrics: metrics.snapshot() },
          logs: [...job.logs, { timestamp: Date.now(), level: 'info' as const, message: 'Phase 1: 复用已导入的历史设定卡（跳过 LLM 分析）' }],
        };
        this.emitSSE(jobId, 'phase', { phase: 1, status: 'analyzing', progress: 25 });
        this.emitSSE(jobId, 'progress', { progress: 25 });
        return updated;
      });
      phase1Output = existingPhase1;
    } else {
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
            metrics.addBudgetBlocked();
          },
        }),
      );
      phase1Output = await phase1.analyze(
        chapters.map((c) => ({ index: c.index, title: c.title, text: c.text })),
      );

      console.log(`[${jobId}] Phase 1 完成: ${phase1Output.characters.length} 角色, ${phase1Output.locations.length} 地点`);
      recordTiming('analyze', t1);
      jobStore.update(jobId, (job) => {
        const updated = {
          ...job,
          progress: 25,
          metadata: withTiming(job),
          pipelineState: { ...job.pipelineState, phase1Output, metrics: metrics.snapshot() },
          logs: [
            ...job.logs,
            { timestamp: Date.now(), level: 'info' as const, message: `Phase 1 完成: 提取到 ${phase1Output.characters.length} 个角色、${phase1Output.locations.length} 个地点` },
          ],
        };
        this.emitSSE(jobId, 'progress', { progress: 25 });
        this.emitSSE(jobId, 'log', { message: `Phase 1 完成: 提取到 ${phase1Output.characters.length} 个角色、${phase1Output.locations.length} 个地点`, level: 'info' });
        return updated;
      });
    }

    // FIX-13：融合用户设定（用户 > 原文；差异记 conflict，不静默覆盖；profile hash 留痕）
    const activeProfile = jobStore.get(jobId)?.pipelineState.userProfile;
    const activeStyle = jobStore.get(jobId)?.pipelineState.styleProfile;
    if (activeProfile) {
      const { phase1: mergedPhase1, report: profileReport } = applyUserProfile(phase1Output, activeProfile);
      phase1Output = mergedPhase1;
      jobStore.update(jobId, (job) => ({
        ...job,
        pipelineState: { ...job.pipelineState, phase1Output, profileReport },
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info' as const, message: `用户设定已融合: 应用 ${profileReport.applied.length} 项 / 冲突 ${profileReport.conflicts.length} 项（profile=${profileReport.profileHash ?? '无'}）` },
        ],
      }));
    }

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
        pipelineState: { ...job.pipelineState, phase2Output, metrics: metrics.snapshot() },
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
      { settingCard: phase1Output.settingCard, metrics, userProfile: activeProfile, styleProfile: activeStyle },
    );

    const successCount = phase3Outputs.filter((o) => o.confidence > 0.5).length;
    console.log(`[${jobId}] Phase 3 完成: ${successCount}/${phase3Outputs.length} 场景成功`);
    recordTiming('convert', t3);
    jobStore.update(jobId, (job) => {
      const updated = {
        ...job,
        progress: 75,
        metadata: withTiming(job),
        pipelineState: { ...job.pipelineState, phase3Output: phase3Outputs, metrics: metrics.snapshot() },
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
        pipelineState: { ...job.pipelineState, phase4Output: screenplay, metrics: metrics.snapshot() },
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

      // FIX-24：每次成功转换记录版本行（审计交付 / 版本对比）
      if (finished?.novelId) {
        getNovelVersionRepository().create({
          novelId: finished.novelId,
          jobId,
          formatVersion: screenplay.formatVersion,
          promptHash: CONVERT_PROMPT_HASH,
        });
        console.log(`[${jobId}] 版本已记录: novel=${finished.novelId}, prompt=${CONVERT_PROMPT_HASH}`);
      }
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
