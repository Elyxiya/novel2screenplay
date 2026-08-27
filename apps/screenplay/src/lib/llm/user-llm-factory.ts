/**
 * UserLLM Factory - 从用户持久化的 Provider 记录构造运行时 Provider 实例
 *
 * 复用 CustomOpenAIProvider / CustomAnthropicProvider 的构造逻辑，按记录协议构造
 * 任意实例（非 env 单例）。为多实例场景把 provider.name 与 config.id 覆写为唯一
 * 标识 `user-${record.id}`，避免与全局 env 单例 name（custom-openai/custom-anthropic）
 * 冲突。
 */

import { CustomOpenAIProvider, type CustomOpenAISettings } from './CustomOpenAIProvider';
import { CustomAnthropicProvider, type CustomAnthropicSettings } from './CustomAnthropicProvider';
import type { LLMProvider } from './types';
import type { UserLLMRecord } from '../store/sqlite';

export function createUserLLMProvider(record: UserLLMRecord): LLMProvider {
  const base: Record<string, unknown> = {
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    name: record.name,
    defaultModel: record.defaultModel,
    supportedModels: record.supportedModels,
    contextWindow: record.contextWindow,
  };

  const provider =
    record.protocol === 'anthropic'
      ? new CustomAnthropicProvider(base as unknown as CustomAnthropicSettings)
      : new CustomOpenAIProvider(base as unknown as CustomOpenAISettings);

  // 覆写身份为唯一标识（type-level readonly，运行时可变）
  const uid = `user-${record.id}`;
  const mutable = provider as unknown as { name: string; config?: { id: string } };
  mutable.name = uid;
  if (mutable.config) {
    mutable.config = { ...mutable.config, id: uid };
  }

  return provider as LLMProvider;
}