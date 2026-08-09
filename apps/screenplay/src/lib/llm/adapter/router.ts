/**
 * 模型路由器
 *
 * 根据模型 ID 自动选择合适的 LLM 适配器，
 * 支持故障转移和负载均衡。
 */

import type { LLMAdapter, LLMAdapterHealth } from './types';
import type { LLMMessage, LLMChatOptions, LLMChatResponse } from '../types';
import { getDeepSeekAdapter } from './deepseek-adapter';
import { getOpenAIAdapter } from './openai-adapter';

export interface RouterStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  adapters: Map<string, LLMAdapterHealth>;
}

/**
 * 模型路由器
 *
 * 负责：
 * 1. 根据模型 ID 选择合适的适配器
 * 2. 处理适配器故障和恢复
 * 3. 记录请求统计
 */
export class ModelRouter {
  private adapters = new Map<string, LLMAdapter>();
  private modelToAdapter = new Map<string, string>();
  private stats: RouterStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    adapters: new Map(),
  };

  /**
   * 注册 LLM 适配器
   */
  registerAdapter(adapter: LLMAdapter): void {
    this.adapters.set(adapter.config.id, adapter);

    // 建立模型到适配器的映射
    for (const model of adapter.config.supportedModels) {
      this.modelToAdapter.set(model, adapter.config.id);
    }

    console.log(`[Router] Registered adapter: ${adapter.config.name} (${adapter.config.supportedModels.join(', ')})`);
  }

  /**
   * 注销适配器
   */
  unregisterAdapter(adapterId: string): void {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) return;

    // 移除模型映射
    for (const model of adapter.config.supportedModels) {
      this.modelToAdapter.delete(model);
    }

    this.adapters.delete(adapterId);
    console.log(`[Router] Unregistered adapter: ${adapter.config.name}`);
  }

  /**
   * 获取适配器
   */
  getAdapter(adapterId: string): LLMAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  /**
   * 根据模型 ID 获取适配器
   */
  getAdapterForModel(modelId: string): LLMAdapter | undefined {
    const adapterId = this.modelToAdapter.get(modelId);
    if (adapterId) {
      return this.adapters.get(adapterId);
    }

    // 尝试查找支持该模型的任何适配器
    for (const adapter of this.adapters.values()) {
      if (adapter.supportsModel(modelId) && adapter.config.enabled) {
        return adapter;
      }
    }

    return undefined;
  }

  /**
   * 发送聊天请求（自动路由）
   */
  async chat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
    modelId?: string
  ): Promise<LLMChatResponse> {
    const model = modelId || this.getDefaultModel();
    const adapter = this.getAdapterForModel(model);

    if (!adapter) {
      throw new Error(`No adapter found for model: ${model}`);
    }

    this.stats.totalRequests++;

    try {
      const response = await adapter.chat(messages, options, model);
      this.stats.successfulRequests++;
      return response;
    } catch (error) {
      this.stats.failedRequests++;
      throw error;
    }
  }

  /**
   * 获取默认模型
   */
  getDefaultModel(): string {
    // 优先选择健康状态最好的适配器
    let bestAdapter: LLMAdapter | undefined;
    let lowestLoad = Infinity;

    for (const adapter of this.adapters.values()) {
      if (!adapter.config.enabled) continue;

      const health = adapter.getHealth();
      if (health.status === 'unhealthy') continue;

      if (health.currentLoad < lowestLoad) {
        lowestLoad = health.currentLoad;
        bestAdapter = adapter;
      }
    }

    return bestAdapter?.config.defaultModel || 'deepseek-chat';
  }

  /**
   * 获取路由器统计
   */
  getStats(): RouterStats {
    const adapterStats = new Map<string, LLMAdapterHealth>();
    for (const [id, adapter] of this.adapters) {
      adapterStats.set(id, adapter.getHealth());
    }

    return {
      ...this.stats,
      adapters: adapterStats,
    };
  }

  /**
   * 列出所有支持的模型
   */
  listSupportedModels(): Array<{ modelId: string; adapterId: string; adapterName: string }> {
    const models: Array<{ modelId: string; adapterId: string; adapterName: string }> = [];

    for (const [modelId, adapterId] of this.modelToAdapter) {
      const adapter = this.adapters.get(adapterId);
      if (adapter) {
        models.push({
          modelId,
          adapterId,
          adapterName: adapter.config.name,
        });
      }
    }

    return models;
  }

  /**
   * 检查模型是否支持
   */
  supportsModel(modelId: string): boolean {
    return this.getAdapterForModel(modelId) !== undefined;
  }

  /**
   * 健康检查
   */
  healthCheck(): boolean {
    for (const adapter of this.adapters.values()) {
      const health = adapter.getHealth();
      if (health.status === 'healthy' || health.status === 'degraded') {
        return true;
      }
    }
    return false;
  }
}

// 全局单例
const GLOBAL_KEY = '__novel2screenplay_model_router__';

export function getModelRouter(): ModelRouter {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
      const router = new ModelRouter();
      // 注册所有内置适配器（懒加载，避免循环依赖）
      router.registerAdapter(getDeepSeekAdapter());
      router.registerAdapter(getOpenAIAdapter());
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = router;
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as ModelRouter;
  }
  const router = new ModelRouter();
  router.registerAdapter(getDeepSeekAdapter());
  router.registerAdapter(getOpenAIAdapter());
  return router;
}
