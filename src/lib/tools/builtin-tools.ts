/**
 * 内置工具定义
 *
 * 提供剧本转换所需的内置工具。
 */

import { getToolRegistry } from './tool-registry';
import { jobStore } from '../store/job-store';
import { getHistoryRepository } from '../store/sqlite';

/**
 * 初始化内置工具
 */
export function initializeBuiltinTools(): void {
  const registry = getToolRegistry();

  // Pipeline 工具
  registry.register({
    id: 'pipeline.start',
    name: 'start_pipeline',
    description: '启动一个新的小说转剧本任务',
    category: 'pipeline',
    tags: ['pipeline', 'start', 'novel', 'conversion'],
    estimatedDuration: 60000,
    estimatedTokens: 100,
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        novelText: { type: 'string', description: '小说文本内容' },
        modelId: { type: 'string', description: 'LLM 模型 ID' },
        selectedChapters: { type: 'array', items: { type: 'number' }, description: '选择的章节索引' },
      },
      required: ['novelText'],
    },
    handler: async (args) => {
      // 实际实现中会调用 PipelineEngine.startJob
      return { success: true, message: 'Pipeline started' };
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
      // 实际实现中会调用 PipelineEngine.cancelJob
      return { success: true, message: 'Pipeline cancelled' };
    },
  });

  // 分析工具
  registry.register({
    id: 'analysis.characters',
    name: 'extract_characters',
    description: '从文本中提取角色信息',
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
    handler: async (args) => {
      // 实际实现中会调用 Phase1Analyzer
      return { characters: [], count: 0 };
    },
  });

  registry.register({
    id: 'analysis.locations',
    name: 'extract_locations',
    description: '从文本中提取地点信息',
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
    handler: async (args) => {
      // 实际实现中会调用 Phase1Analyzer
      return { locations: [], count: 0 };
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
