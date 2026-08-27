/**
 * Pipeline Job 定义
 *
 * 定义后台任务的类型、状态和生命周期。
 *
 * 【p1-2 收敛（D6）】
 * 本文件为共享类型定义：被 pipeline/executor、flow-evaluator 等复用；
 * 内存队列执行链路（job-queue/worker）已标记预留。
 */

export type JobStatus =
  | 'pending'      // 等待中
  | 'queued'       // 已入队
  | 'running'      // 执行中
  | 'completed'    // 已完成
  | 'failed'       // 失败
  | 'cancelled'    // 已取消
  | 'paused';      // 暂停

export type JobPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface PipelineJob {
  /** 任务 ID */
  id: string;
  /** 任务类型 */
  type: 'conversion' | 'segment' | 'analyze' | 'custom';
  /** 任务状态 */
  status: JobStatus;
  /** 优先级 */
  priority: JobPriority;
  /** 输入数据 */
  input: PipelineJobInput;
  /** 输出结果 */
  output?: PipelineJobOutput;
  /** 当前阶段 */
  currentPhase?: PipelinePhase;
  /** 进度（0-100） */
  progress: number;
  /** 子进度信息 */
  subProgress?: string;
  /** 错误信息 */
  error?: string;
  /** 重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 创建时间 */
  createdAt: number;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 使用的模型 */
  modelId?: string;
  /** 归属用户（多用户数据隔离，内存队列任务） */
  userId?: string;
  /** Token 使用统计 */
  tokenUsage?: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface PipelineJobInput {
  /** 小说文本 */
  novelText?: string;
  /** 小说 ID */
  novelId?: string;
  /** 章节索引列表 */
  selectedChapters?: number[];
  /** 转换选项 */
  options?: ConversionOptions;
}

export interface PipelineJobOutput {
  /** 剧本 YAML 内容 */
  yamlContent?: string;
  /** 剧本 JSON 内容 */
  jsonContent?: string;
  /** 提取的角色 */
  characters?: Character[];
  /** 提取的场景 */
  scenes?: Scene[];
  /** 统计信息 */
  stats?: ConversionStats;
}

export interface ConversionOptions {
  /** 风格 */
  style?: 'dramatic' | 'cinematic' | 'faithful';
  /** 输出格式 */
  format?: 'yaml' | 'json';
  /** 是否包含注释 */
  includeNotes?: boolean;
  /** 最大场景数 */
  maxScenes?: number;
}

export interface PipelinePhase {
  /** 阶段 ID */
  id: string;
  /** 阶段名称 */
  name: string;
  /** 阶段状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  /** 阶段进度 */
  progress: number;
  /** 阶段开始时间 */
  startedAt?: number;
  /** 阶段结束时间 */
  completedAt?: number;
  /** 阶段输出 */
  output?: unknown;
  /** 阶段错误 */
  error?: string;
}

/**
 * Pipeline 阶段定义
 */
export const PIPELINE_PHASES = {
  SEGMENT: 'segment',
  ANALYZE: 'analyze',
  CONVERT_SCENE: 'convert_scene',
  VALIDATE: 'validate',
  OUTPUT: 'output',
} as const;

export type PipelinePhaseId = typeof PIPELINE_PHASES[keyof typeof PIPELINE_PHASES];

/**
 * 角色信息
 */
export interface Character {
  id: string;
  name: string;
  description?: string;
  dialogues?: number;
}

/**
 * 场景信息
 */
export interface Scene {
  id: string;
  location?: string;
  timeOfDay?: string;
  characters?: string[];
  summary?: string;
}

/**
 * 转换统计
 */
export interface ConversionStats {
  totalScenes: number;
  totalCharacters: number;
  totalWords: number;
  totalTokens: number;
  processingTimeMs: number;
  phases: Record<string, { durationMs: number; tokens: number }>;
}
