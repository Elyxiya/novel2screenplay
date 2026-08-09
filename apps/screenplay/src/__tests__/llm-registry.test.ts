import { describe, expect, it } from 'vitest';
import { LLMProviderRegistry } from '@/lib/llm/registry';
import { DeepSeekProvider } from '@/lib/llm/DeepSeekProvider';
import { CustomOpenAIProvider } from '@/lib/llm/CustomOpenAIProvider';
import { CustomAnthropicProvider } from '@/lib/llm/CustomAnthropicProvider';
import type { LLMProvider } from '@/lib/llm/types';

/**
 * LLMProviderRegistry 查找语义测试。
 * 覆盖修复点：DeepSeekProvider 声明 supportedModels 后，
 * llmRegistry.get(modelId) 可按模型 ID 命中（而非仅按 provider 名）。
 */

/** 构造自定义 provider 的最小实现（不实际发请求） */
function fakeProvider(name: string, modelId: string, supportedModels?: string[]): LLMProvider {
  return {
    name,
    modelId,
    description: `fake ${name}`,
    contextWindow: 8192,
    supportedModels,
    async chat() {
      throw new Error('not implemented');
    },
    async *chatStream() {
      yield { type: 'error', error: 'not implemented' };
    },
    supportsJSONMode: () => true,
    async estimateTokens(t: string) {
      return Math.ceil(t.length / 2);
    },
  };
}

describe('LLMProviderRegistry.get', () => {
  it('按 provider 名查找（大小写不敏感）', () => {
    const reg = new LLMProviderRegistry();
    const p = fakeProvider('DeepSeek', 'deepseek-chat');
    reg.register(p);

    expect(reg.get('deepseek')).toBe(p);
    expect(reg.get('DeepSeek')).toBe(p);
    expect(reg.get('DEEPSEEK')).toBe(p);
  });

  it('按 supportedModels 中的模型 ID 查找（DeepSeek 修复点）', () => {
    const reg = new LLMProviderRegistry();
    // 与 DeepSeekProvider 相同构造语义：modelId 默认 deepseek-chat，supportedModels 含 deepseek-chat/reasoner
    reg.register(new DeepSeekProvider('sk-test'));

    expect(reg.get('deepseek-chat')).toBeInstanceOf(DeepSeekProvider);
    expect(reg.get('deepseek-reasoner')).toBeInstanceOf(DeepSeekProvider);
    expect(reg.get('deepseek-chat')?.modelId).toBe('deepseek-chat');
  });

  it('自定义 modelId 也在 supportedModels 中（get 可按其命中）', () => {
    const reg = new LLMProviderRegistry();
    reg.register(new DeepSeekProvider('sk-test', 'deepseek-v3-custom'));

    expect(reg.get('deepseek-v3-custom')).toBeInstanceOf(DeepSeekProvider);
    expect(reg.get('deepseek-chat')).toBeInstanceOf(DeepSeekProvider); // 默认模型仍在支持列表
  });

  it('未注册的名字或模型 ID 返回 undefined', () => {
    const reg = new LLMProviderRegistry();
    reg.register(new DeepSeekProvider('sk-test'));

    expect(reg.get('gpt-4o')).toBeUndefined();
    expect(reg.get('unknown-model')).toBeUndefined();
    expect(reg.get('deepseek-v3')).toBeUndefined();
  });
});

describe('LLMProviderRegistry.getDefault 优先级', () => {
  it('custom-anthropic 优先于 custom-openai 与 deepseek', () => {
    const reg = new LLMProviderRegistry();
    const anthropic = new CustomAnthropicProvider({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-test',
      name: 'Custom Anthropic',
      defaultModel: 'claude-sonnet-4-20250514',
      supportedModels: ['claude-sonnet-4-20250514'],
      contextWindow: 200000,
    });
    const openai = new CustomOpenAIProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      name: 'Custom OpenAI',
      defaultModel: 'gpt-4o-mini',
      supportedModels: ['gpt-4o-mini'],
      contextWindow: 128000,
    });
    const deepseek = new DeepSeekProvider('sk-test');
    reg.register(openai);
    reg.register(deepseek);
    reg.register(anthropic);

    expect(reg.getDefault()).toBe(anthropic);
  });

  it('无自定义 provider 时回退 deepseek（默认模型查找链路）', () => {
    const reg = new LLMProviderRegistry();
    const deepseek = new DeepSeekProvider('sk-test');
    reg.register(deepseek);

    expect(reg.getDefault()).toBe(deepseek);
  });

  it('仅注册无 supportedModels 的 provider 时 getDefault 仍按名字命中（getForJSONMode 兜底）', () => {
    const reg = new LLMProviderRegistry();
    const p = fakeProvider('plain', 'plain-model');
    reg.register(p);

    expect(reg.getDefault()).toBe(p);
  });
});
