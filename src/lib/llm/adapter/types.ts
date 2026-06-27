/**
 * LLM Adapter 统一接口
 *
 * 定义 Agent 与底层 LLM 提供商之间的适配接口，
 * 支持多模型路由、负载均衡、故障转移。
 */

import type { LLMProvider, LLMMessage, LLMChatOptions, LLMChatResponse } from './types';

/**
 * LLM Adapter 配置
 */
export interface LLMAdapterConfig {
  /** Adapter 唯一标识 */
  id: string;
  /** Adapter 名称 */
  name: string;
  /** 支持的模型列表 */
  supportedModels: string[];
  /** 默认模型 */
  defaultModel: string;
  /** 优先级（数值越小优先级越高） */
  priority: number;
  /** 是否启用 */
  enabled: boolean;
  /** 最大并发请求数 */
  maxConcurrentRequests: number;
  /** 请求超时（毫秒） */
  timeout: number;
}

/**
 * LLM Adapter 健康状态
 */
export interface LLMAdapterHealth {
  adapterId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: number;
  errorRate: number;
  avgLatency: number;
  currentLoad: number;
}

/**
 * LLM Adapter 接口
 *
 * 所有 LLM 适配器必须实现此接口。
 */
export interface LLMAdapter {
  /** 配置信息 */
  readonly config: LLMAdapterConfig;
  /** 健康状态 */
  health: LLMAdapterHealth;

  /**
   * 发送聊天请求
   * @param messages 消息列表
   * @param options 请求选项
   * @param model 模型 ID（可选，使用默认模型）
   */
  chat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
    model?: string
  ): Promise<LLMChatResponse>;

  /**
   * 流式聊天请求
   */
  chatStream(
    messages: LLMMessage[],
    options?: LLMChatOptions,
    model?: string
  ): AsyncGenerator<{ type: 'text' | 'done' | 'error'; content?: string; error?: string }>;

  /**
   * 检查适配器是否支持指定模型
   */
  supportsModel(modelId: string): boolean;

  /**
   * 获取适配器状态
   */
  getHealth(): LLMAdapterHealth;

  /**
   * 更新适配器配置
   */
  updateConfig(config: Partial<LLMAdapterConfig>): void;

  /**
   * 重置健康状态
   */
  resetHealth(): void;
}

/**
 * LLM Adapter 工厂函数类型
 */
export type LLMAdapterFactory = (config: LLMAdapterConfig) => LLMAdapter;

/**
 * LLM Adapter 管理器配置
 */
export interface LLMAdapterManagerConfig {
  /** 默认适配器 ID */
  defaultAdapterId: string;
  /** 启用自动故障转移 */
  enableAutoFailover: boolean;
  /** 故障转移阈值（错误率 > 此值时触发） */
  failoverThreshold: number;
  /** 请求超时（毫秒） */
  requestTimeout: number;
  /** 最大重试次数 */
  maxRetries: number;
}

/**
 * LLM Adapter 选择策略
 */
export type AdapterSelectionStrategy =
  | 'priority'      // 按优先级选择
  | 'round_robin'   // 轮询
  | 'least_loaded'  // 选择负载最低的
  | 'random'        // 随机
  | 'latency';      // 选择延迟最低的

/**
 * 创建基础适配器配置
 */
export function createBaseAdapterConfig(
  id: string,
  name: string,
  supportedModels: string[],
  defaultModel: string
): LLMAdapterConfig {
  return {
    id,
    name,
    supportedModels,
    defaultModel,
    priority: 100,
    enabled: true,
    maxConcurrentRequests: 10,
    timeout: 30000,
  };
}

/**
 * 创建基础健康状态
 */
export function createBaseHealth(adapterId: string): LLMAdapterHealth {
  return {
    adapterId,
    status: 'healthy',
    lastCheck: Date.now(),
    errorRate: 0,
    avgLatency: 0,
    currentLoad: 0,
  };
}
