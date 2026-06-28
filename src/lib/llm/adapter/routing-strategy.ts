/**
 * 高级路由策略
 *
 * 支持多种模型选择策略：
 * - 优先级路由：根据模型优先级选择
 * - 负载均衡：选择当前负载最低的模型
 * - 故障转移：主模型失败时自动切换到备用模型
 * - 成本优化：优先使用成本更低的模型
 * - 延迟优化：选择响应最快的模型
 */

import type { LLMAdapter, LLMAdapterHealth } from './types';

export type RoutingStrategy =
  | 'priority'       // 按优先级
  | 'round_robin'   // 轮询
  | 'least_loaded'  // 最低负载
  | 'random'        // 随机
  | 'latency'        // 最低延迟
  | 'cost'          // 最低成本
  | 'failover';     // 故障转移

export interface RoutingContext {
  /** 策略类型 */
  strategy: RoutingStrategy;
  /** 首选模型 */
  preferredModel?: string;
  /** 备用模型列表 */
  fallbackModels?: string[];
  /** 预算限制 */
  maxCostPerRequest?: number;
  /** 最大延迟容忍（毫秒） */
  maxLatency?: number;
}

/**
 * 路由策略上下文
 */
export interface RoutingContextOptions {
  /** 成本限制（每 1M tokens 的成本，USD） */
  costLimit?: number;
  /** 最大延迟容忍 */
  maxLatencyMs?: number;
  /** 必须使用的模型 */
  preferredModel?: string;
  /** 备用模型列表 */
  fallbackModels?: string[];
}

/**
 * 路由决策结果
 */
export interface RoutingDecision {
  adapter: LLMAdapter;
  modelId: string;
  reason: string;
  alternatives: Array<{ adapter: LLMAdapter; modelId: string; reason: string }>;
}

/**
 * 成本估算（USD per 1M tokens）
 */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'deepseek-chat': { input: 0.1, output: 0.3 },
  'deepseek-coder': { input: 0.1, output: 0.3 },
  'deepseek-reasoner': { input: 0.5, output: 2.0 },
  'gpt-4o': { input: 5.0, output: 15.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
};

/**
 * 根据策略选择适配器
 */
export function selectAdapter(
  adapters: LLMAdapter[],
  strategy: RoutingStrategy,
  context?: RoutingContextOptions
): RoutingDecision | null {
  if (adapters.length === 0) return null;

  // 过滤出健康的适配器
  const healthyAdapters = adapters.filter((a) => {
    const health = a.getHealth();
    return health.status !== 'unhealthy' && a.config.enabled;
  });

  if (healthyAdapters.length === 0) return null;

  let selected: LLMAdapter;
  let reason: string;

  switch (strategy) {
    case 'priority':
      ({ adapter: selected, reason } = selectByPriority(healthyAdapters));
      break;
    case 'round_robin':
      ({ adapter: selected, reason } = selectByRoundRobin(healthyAdapters));
      break;
    case 'least_loaded':
      ({ adapter: selected, reason } = selectByLoad(healthyAdapters));
      break;
    case 'random':
      ({ adapter: selected, reason } = selectByRandom(healthyAdapters));
      break;
    case 'latency':
      ({ adapter: selected, reason } = selectByLatency(healthyAdapters));
      break;
    case 'cost':
      ({ adapter: selected, reason } = selectByCost(healthyAdapters, context?.costLimit));
      break;
    case 'failover':
      ({ adapter: selected, reason } = selectByFailover(healthyAdapters, context?.preferredModel, context?.fallbackModels));
      break;
    default:
      selected = healthyAdapters[0];
      reason = 'Default selection';
  }

  // 收集备选方案
  const alternatives = healthyAdapters
    .filter((a) => a !== selected)
    .slice(0, 3)
    .map((a) => ({
      adapter: a,
      modelId: a.config.defaultModel,
      reason: `Alternative: ${a.config.name}`,
    }));

  return {
    adapter: selected,
    modelId: selected.config.defaultModel,
    reason,
    alternatives,
  };
}

function selectByPriority(adapters: LLMAdapter[]): { adapter: LLMAdapter; reason: string } {
  const sorted = [...adapters].sort((a, b) => a.config.priority - b.config.priority);
  return { adapter: sorted[0], reason: `Priority: ${sorted[0].config.priority}` };
}

let roundRobinIndex = 0;
function selectByRoundRobin(adapters: LLMAdapter[]): { adapter: LLMAdapter; reason: string } {
  const selected = adapters[roundRobinIndex % adapters.length];
  roundRobinIndex++;
  return { adapter: selected, reason: 'Round-robin selection' };
}

function selectByLoad(adapters: LLMAdapter[]): { adapter: LLMAdapter; reason: string } {
  const sorted = [...adapters].sort(
    (a, b) => a.getHealth().currentLoad - b.getHealth().currentLoad
  );
  return { adapter: sorted[0], reason: `Load: ${sorted[0].getHealth().currentLoad}` };
}

function selectByRandom(adapters: LLMAdapter[]): { adapter: LLMAdapter; reason: string } {
  const index = Math.floor(Math.random() * adapters.length);
  return { adapter: adapters[index], reason: 'Random selection' };
}

function selectByLatency(adapters: LLMAdapter[]): { adapter: LLMAdapter; reason: string } {
  const sorted = [...adapters].sort(
    (a, b) => a.getHealth().avgLatency - b.getHealth().avgLatency
  );
  return { adapter: sorted[0], reason: `Latency: ${sorted[0].getHealth().avgLatency}ms` };
}

function selectByCost(adapters: LLMAdapter[], costLimit?: number): { adapter: LLMAdapter; reason: string } {
  let candidates = adapters;

  if (costLimit !== undefined) {
    candidates = adapters.filter((a) => {
      const cost = MODEL_COSTS[a.config.defaultModel];
      if (!cost) return true; // 未知成本，默认通过
      return cost.input <= costLimit;
    });
  }

  if (candidates.length === 0) {
    // 如果没有符合条件的，返回最便宜的
    candidates = adapters;
  }

  const sorted = [...candidates].sort((a, b) => {
    const costA = MODEL_COSTS[a.config.defaultModel]?.input ?? 1;
    const costB = MODEL_COSTS[b.config.defaultModel]?.input ?? 1;
    return costA - costB;
  });

  return { adapter: sorted[0], reason: `Cost: $${MODEL_COSTS[sorted[0].config.defaultModel]?.input ?? 'unknown'}/1M tokens` };
}

function selectByFailover(
  adapters: LLMAdapter[],
  preferredModel?: string,
  fallbackModels?: string[]
): { adapter: LLMAdapter; reason: string } {
  // 如果指定了首选模型
  if (preferredModel) {
    const preferred = adapters.find((a) => a.supportsModel(preferredModel));
    if (preferred && preferred.getHealth().status === 'healthy') {
      return { adapter: preferred, reason: `Preferred model: ${preferredModel}` };
    }
  }

  // 尝试备用模型
  if (fallbackModels) {
    for (const model of fallbackModels) {
      const fallback = adapters.find((a) => a.supportsModel(model));
      if (fallback && fallback.getHealth().status === 'healthy') {
        return { adapter: fallback, reason: `Fallback model: ${model}` };
      }
    }
  }

  // 默认选择最健康的
  const sorted = [...adapters].sort((a, b) => {
    const healthA = a.getHealth();
    const healthB = b.getHealth();
    if (healthA.status === 'healthy' && healthB.status !== 'healthy') return -1;
    if (healthB.status === 'healthy' && healthA.status !== 'healthy') return 1;
    return healthA.errorRate - healthB.errorRate;
  });

  return { adapter: sorted[0], reason: `Failover to healthy adapter: ${sorted[0].config.name}` };
}

/**
 * 创建路由上下文
 */
export function createRoutingContext(
  strategy: RoutingStrategy,
  options?: RoutingContextOptions
): RoutingContext {
  return {
    strategy,
    preferredModel: options?.preferredModel,
    fallbackModels: options?.fallbackModels,
    maxCostPerRequest: options?.costLimit,
    maxLatency: options?.maxLatencyMs,
  };
}
