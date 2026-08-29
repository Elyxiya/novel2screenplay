/**
 * ModelRouter 流式转发单测
 *
 * 覆盖：
 * - chatStream 逐 chunk 转发到所选 adapter
 * - 无 adapter 时抛错
 * - 未显式传 model 时命中 getDefaultModel，并路由到对应 adapter
 */
import { describe, it, expect } from 'vitest';
import { ModelRouter } from './router';
import type { LLMAdapter, LLMAdapterConfig, LLMAdapterHealth } from './types';
import type { LLMMessage, LLMStreamChunk } from '../types';

function makeMockAdapter(id: string, models: string[], defaultModel: string): LLMAdapter {
  const config: LLMAdapterConfig = {
    id,
    name: `mock-${id}`,
    supportedModels: models,
    defaultModel,
    priority: 100,
    enabled: true,
    maxConcurrentRequests: 10,
    timeout: 30000,
  };
  const health: LLMAdapterHealth = {
    adapterId: id,
    status: 'healthy',
    lastCheck: Date.now(),
    errorRate: 0,
    avgLatency: 0,
    currentLoad: 0,
  };
  const chatStream = async function* (): AsyncGenerator<LLMStreamChunk> {
    yield { type: 'text', content: `chunk-${id}` };
    yield { type: 'done' };
  };
  return {
    config,
    health,
    chat: async () => ({ content: '', model: defaultModel }),
    chatStream,
    supportsModel: (m: string) => models.includes(m),
    getHealth: () => health,
    updateConfig: () => {},
    resetHealth: () => {},
  };
}

describe('ModelRouter.chatStream', () => {
  it('逐 chunk 转发到所选 adapter', async () => {
    const router = new ModelRouter();
    const adapter = makeMockAdapter('a', ['m1'], 'm1');
    router.registerAdapter(adapter);

    const messages: LLMMessage[] = [{ role: 'user', content: 'hi' }];
    const chunks: string[] = [];
    for await (const ch of router.chatStream(messages, {}, 'm1')) {
      if (ch.type === 'text') chunks.push(ch.content ?? '');
    }
    expect(chunks).toEqual(['chunk-a']);
  });

  it('未显式传 model 时命中默认模型对应 adapter', async () => {
    const router = new ModelRouter();
    const idx = makeMockAdapter('idx', ['m2'], 'm2');
    router.registerAdapter(idx);

    for await (const ch of router.chatStream([{ role: 'user', content: 'x' }])) {
      if (ch.type === 'text') expect(ch.content).toBe('chunk-idx');
    }
    expect(idx.config.defaultModel).toBe('m2');
  });

  it('无可用 adapter 时抛错', async () => {
    const router = new ModelRouter();
    // 错误在首次取 chunk 时抛出（生成器惰性求值）
    await expect(
      router.chatStream([{ role: 'user', content: 'x' }], {}, 'missing-model').next(),
    ).rejects.toThrow('No adapter found');
  });
});