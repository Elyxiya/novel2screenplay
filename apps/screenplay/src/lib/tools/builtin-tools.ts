/**
 * 内置工具定义
 *
 * 提供剧本转换所需的内置工具。
 * 工具层保持纯净（共享底座），不依赖任何 ② pipeline 实现；
 * 需要 pipeline 能力时一律通过 injectable 的 BuiltinToolDeps 回调获得，
 * 由业务侧（②）在装配处注入真实实现。
 */

import { getToolRegistry } from './tool-registry';
import { jobStore } from '../store/job-store';
import { getHistoryRepository } from '../store/sqlite';

/** 启动 pipeline 任务的入参（与 PipelineEngine.startJob 对齐） */
export interface StartPipelineInput {
  novelText: string;
  title?: string;
  author?: string;
  modelId?: string;
  selectedChapters?: number[];
  userId?: string;
}

/** 文本分析输出（Phase1 结果的可序列化摘要） */
export interface AnalyzeTextResult {
  characters?: unknown[];
  locations?: unknown[];
  rawResponse?: string;
  /** provider 缺失或出错时的错误信息 */
  error?: string;
}

/**
 * 内置工具依赖注入契约
 *
 * 由业务侧（②）装配真实 pipeline 实现并传入，
 * 工具层自身不 import 任何 pipeline / LLM Provider 模块。
 */
export interface BuiltinToolDeps {
  /** 启动一个小说转剧本任务，返回 jobId */
  startPipeline(input: StartPipelineInput): Promise<string>;
  /** 取消进行中的转换任务 */
  cancelJob(jobId: string): Promise<void>;
  /** 分析文本，返回角色/地点等（走 Phase 1 分析器） */
  analyzeText(text: string, userId?: string): Promise<AnalyzeTextResult>;
  /** 合并各阶段输出为最终剧本（走 Phase 4 合并器） */
  merge(args: {
    title: string;
    author: string;
    phase1Output: unknown;
    phase2Output: unknown;
    phase3Outputs: unknown;
  }): Promise<{ screenplay: unknown; fixes: unknown }>;
}

/**
 * 初始化内置工具（注册到工具注册表）
 *
 * @param deps 业务侧注入的 pipeline 依赖；未注入时仅注册不依赖 pipeline 的存储类工具，
 *             pipeline/analysis/conversion 类工具在调用时会返回未装配错误。
 */
export function initializeBuiltinTools(deps?: BuiltinToolDeps): void {
  const registry = getToolRegistry();

  const requireDeps = (toolId: string): BuiltinToolDeps => {
    if (!deps) {
      throw new Error(`工具 ${toolId} 需要业务侧注入 BuiltinToolDeps，但当前未装配`);
    }
    return deps;
  };

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
      const jobId = await requireDeps('pipeline.start').startPipeline({
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
      await requireDeps('pipeline.cancel').cancelJob(args.jobId as string);
      return { success: true, message: 'Pipeline cancelled' };
    },
  });

  // 分析工具
  registry.register({
    id: 'analysis.characters',
    name: 'extract_characters',
    description: '从小说文本中提取角色信息（走 Phase 1 分析器）',
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
      const result = await requireDeps('analysis.characters').analyzeText(
        args.text as string,
        context?.userId,
      );
      if (result.error) {
        return { error: result.error };
      }
      return {
        characters: result.characters,
        count: result.characters?.length,
        rawResponse: result.rawResponse,
      };
    },
  });

  registry.register({
    id: 'analysis.locations',
    name: 'extract_locations',
    description: '从小说文本中提取地点信息（走 Phase 1 分析器）',
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
      const result = await requireDeps('analysis.locations').analyzeText(
        args.text as string,
        context?.userId,
      );
      if (result.error) {
        return { error: result.error };
      }
      return {
        locations: result.locations,
        count: result.locations?.length,
        rawResponse: result.rawResponse,
      };
    },
  });

  // 转换工具
  registry.register({
    id: 'conversion.merge',
    name: 'merge_validate',
    description: '合并各阶段输出并校验为最终剧本（走 Phase 4 合并器）',
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
      const { screenplay, fixes } = await requireDeps('conversion.merge').merge({
        title: (args.title as string) || '剧本',
        author: (args.author as string) || '',
        phase1Output: args.phase1Output,
        phase2Output: args.phase2Output,
        phase3Outputs: args.phase3Outputs,
      });
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