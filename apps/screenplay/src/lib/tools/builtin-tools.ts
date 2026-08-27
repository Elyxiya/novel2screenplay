/**
 * 内置工具定义
 *
 * 提供剧本转换所需的内置工具。
 * 所有 handler 均真实接线到 Pipeline / Phase 模块，不返回 mock 数据。
 */

import { getToolRegistry } from './tool-registry';
import { jobStore } from '../store/job-store';
import { getHistoryRepository } from '../store/sqlite';
import { PipelineEngine } from '../pipeline/PipelineEngine';
import { Phase1Analyzer } from '../pipeline/Phase1Analyzer';
import { Phase4Merger } from '../pipeline/Phase4Merger';
import { ContextManager } from '../pipeline/ContextManager';
import { resolveDefaultProvider } from '../llm/llm-gateway';
import { parseNovel } from '../novel/parser';

/**
 * 初始化内置工具
 */
export function initializeBuiltinTools(): void {
  const registry = getToolRegistry();
  const pipelineEngine = new PipelineEngine();

  // Pipeline 工具
  registry.register({
    id: 'pipeline.start',
    name: 'start_pipeline',
    description: '启动一个新的小说转剧本任务，返回任务 ID',
    category: 'pipeline',
    tags: ['pipeline', 'start', 'novel', 'conversion'],
    estimatedDuration: 60000,
    estimatedTokens: 100,
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        novelText: { type: 'string', description: '小说文本内容' },
        title: { type: 'string', description: '作品标题' },
        author: { type: 'string', description: '作者' },
        modelId: { type: 'string', description: 'LLM 模型 ID' },
        selectedChapters: { type: 'array', items: { type: 'number' }, description: '选择的章节索引' },
      },
      required: ['novelText'],
    },
    handler: async (args, context) => {
      const jobId = await pipelineEngine.startJob({
        novelText: args.novelText as string,
        title: args.title as string | undefined,
        author: args.author as string | undefined,
        modelId: args.modelId as string | undefined,
        selectedChapters: args.selectedChapters as number[] | undefined,
        userId: context?.userId,
      });
      return { success: true, jobId, message: 'Pipeline started' };
    },
  });

  registry.register({
    id: 'pipeline.status',
    name: 'get_pipeline_status',
    description: '获取当前转换任务的状态',
    category: 'pipeline',
    tags: ['pipeline', 'status', 'progress'],
    estimatedDuration: 100,
    estimatedTokens: 50,
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: '任务 ID' },
      },
      required: ['jobId'],
    },
    handler: async (args) => {
      const job = jobStore.get(args.jobId as string);
      if (!job) {
        return { error: '任务不存在' };
      }
      return {
        id: job.id,
        status: job.status,
        currentPhase: job.currentPhase,
        progress: job.progress,
        subProgress: job.subProgress,
        error: job.error,
      };
    },
  });

  registry.register({
    id: 'pipeline.cancel',
    name: 'cancel_pipeline',
    description: '取消正在进行的转换任务',
    category: 'pipeline',
    tags: ['pipeline', 'cancel', 'stop'],
    estimatedDuration: 100,
    estimatedTokens: 30,
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: '任务 ID' },
      },
      required: ['jobId'],
    },
    handler: async (args) => {
      pipelineEngine.cancelJob(args.jobId as string);
      return { success: true, message: 'Pipeline cancelled' };
    },
  });

  // 分析工具
  registry.register({
    id: 'analysis.characters',
    name: 'extract_characters',
    description: '从小说文本中提取角色信息（真实调用 Phase 1 分析器）',
    category: 'analysis',
    tags: ['analysis', 'characters', 'extract'],
    estimatedDuration: 5000,
    estimatedTokens: 200,
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要分析的文本' },
      },
      required: ['text'],
    },
    handler: async (args, context) => {
      const provider = resolveDefaultProvider(context.userId);
      if (!provider) {
        return { error: '未配置 LLM Provider，请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY' };
      }

      const phase1 = new Phase1Analyzer(provider, new ContextManager());
      const chapters = parseNovel(args.text as string).chapters;
      const input = chapters.length > 0
        ? chapters.map((c) => ({ index: c.index, title: c.title, text: c.text }))
        : [{ index: 0, title: 'text', text: args.text as string }];

      const output = await phase1.analyze(input);
      return {
        characters: output.characters,
        count: output.characters.length,
        rawResponse: output.rawResponse,
      };
    },
  });

  registry.register({
    id: 'analysis.locations',
    name: 'extract_locations',
    description: '从小说文本中提取地点信息（真实调用 Phase 1 分析器）',
    category: 'analysis',
    tags: ['analysis', 'locations', 'extract'],
    estimatedDuration: 5000,
    estimatedTokens: 200,
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要分析的文本' },
      },
      required: ['text'],
    },
    handler: async (args, context) => {
      const provider = resolveDefaultProvider(context.userId);
      if (!provider) {
        return { error: '未配置 LLM Provider，请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY' };
      }

      const phase1 = new Phase1Analyzer(provider, new ContextManager());
      const chapters = parseNovel(args.text as string).chapters;
      const input = chapters.length > 0
        ? chapters.map((c) => ({ index: c.index, title: c.title, text: c.text }))
        : [{ index: 0, title: 'text', text: args.text as string }];

      const output = await phase1.analyze(input);
      return {
        locations: output.locations,
        count: output.locations.length,
        rawResponse: output.rawResponse,
      };
    },
  });

  // 转换工具
  registry.register({
    id: 'conversion.merge',
    name: 'merge_validate',
    description: '合并各阶段输出并校验为最终剧本（真实调用 Phase 4 合并器）',
    category: 'conversion',
    tags: ['conversion', 'merge', 'validate'],
    estimatedDuration: 5000,
    estimatedTokens: 200,
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '剧本标题' },
        author: { type: 'string', description: '作者' },
        phase1Output: { type: 'object', description: 'Phase 1 分析输出' },
        phase2Output: { type: 'object', description: 'Phase 2 场景输出' },
        phase3Outputs: { type: 'array', description: 'Phase 3 场景转换输出数组' },
      },
      required: ['phase1Output', 'phase2Output', 'phase3Outputs'],
    },
    handler: async (args) => {
      const phase4 = new Phase4Merger();
      const { screenplay, fixes } = await phase4.merge(
        {
          title: (args.title as string) || '剧本',
          author: (args.author as string) || '',
          sourceNovel: (args.title as string) || '剧本',
        },
        args.phase1Output as Parameters<typeof phase4.merge>[1],
        args.phase2Output as Parameters<typeof phase4.merge>[2],
        args.phase3Outputs as Parameters<typeof phase4.merge>[3],
      );
      return { success: true, screenplay, fixes };
    },
  });

  // 存储工具
  registry.register({
    id: 'storage.history',
    name: 'save_to_history',
    description: '保存转换结果到历史记录',
    category: 'storage',
    tags: ['storage', 'history', 'save'],
    estimatedDuration: 200,
    estimatedTokens: 50,
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: '任务 ID' },
        title: { type: 'string', description: '剧本标题' },
        yamlContent: { type: 'string', description: 'YAML 剧本内容' },
      },
      required: ['jobId'],
    },
    handler: async (args) => {
      const historyRepo = getHistoryRepository();
      const id = historyRepo.create({
        jobId: args.jobId as string,
        title: args.title as string | undefined,
        yamlContent: args.yamlContent as string | undefined,
      });
      return { success: true, historyId: id };
    },
  });

  registry.register({
    id: 'storage.result',
    name: 'get_result',
    description: '获取转换结果',
    category: 'storage',
    tags: ['storage', 'result', 'get'],
    estimatedDuration: 100,
    estimatedTokens: 50,
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: '任务 ID' },
      },
      required: ['jobId'],
    },
    handler: async (args) => {
      const job = jobStore.get(args.jobId as string);
      if (!job) {
        return { error: '任务不存在' };
      }
      return {
        id: job.id,
        status: job.status,
        resultId: job.resultId,
      };
    },
  });

  console.log(`[ToolRegistry] Initialized ${registry.list().length} builtin tools`);
}
