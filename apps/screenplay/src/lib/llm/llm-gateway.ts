/**
 * LLM Gateway - 模型 Provider 解析网关（用户优先，env 回退）
 *
 * 主链路（pipeline / Agent 编排 / revise）拿到 userId 后，经此解析"该用户导入的
 * 自定义 LLM"；未登录 / 无 userId / 用户未命中时回退全局 env llmRegistry。
 * 这样不破坏既有接口：无用户上下文时行为与改造前一致。
 */

import type { LLMProvider } from './types';
import { llmRegistry } from './registry';
import { getUserLLMRegistry, type UserModelDescriptor } from './user-llm-registry';

export interface ResolveOptions {
  /** 需要支持 JSON mode（如管线 JSON 语义阶段）；用户 provider 不支持时回退全局 JSON provider */
  requireJson?: boolean;
}

/** 按模型 ID 解析 provider；未指定 modelId 时取默认 */
export function resolveProvider(
  userId: string | null | undefined,
  modelId?: string,
  opts: ResolveOptions = {},
): LLMProvider | undefined {
  if (userId) {
    const userProvider = getUserLLMRegistry(userId).get(modelId);
    if (userProvider && (!opts.requireJson || userProvider.supportsJSONMode())) {
      return userProvider;
    }
  }
  // 回退全局 env 注册表
  if (opts.requireJson) return llmRegistry.getForJSONMode();
  return modelId ? llmRegistry.get(modelId) ?? llmRegistry.getDefault() : llmRegistry.getDefault();
}

/** 解析默认 provider：用户默认模型优先，回退全局默认 */
export function resolveDefaultProvider(
  userId: string | null | undefined,
  opts: ResolveOptions = {},
): LLMProvider | undefined {
  if (userId) {
    const userProvider = getUserLLMRegistry(userId).getDefault();
    if (userProvider && (!opts.requireJson || userProvider.supportsJSONMode())) {
      return userProvider;
    }
  }
  return opts.requireJson ? llmRegistry.getForJSONMode() : llmRegistry.getDefault();
}

/** 当前用户导入模型列表（供 /api/models 注入与配置页展示） */
export function listModelsForUser(userId: string): UserModelDescriptor[] {
  return getUserLLMRegistry(userId).descriptors();
}

/** 判断用户是否导入了自定义 LLM */
export function hasUserLLM(userId: string): boolean {
  return !getUserLLMRegistry(userId).isEmpty();
}