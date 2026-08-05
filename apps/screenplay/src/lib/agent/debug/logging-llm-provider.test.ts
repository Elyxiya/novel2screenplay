import { describe, it, expect, beforeEach } from 'vitest';
import type { LLMProvider, LLMMessage, LLMChatResponse, LLMStreamChunk } from '../../llm/types';
import { AgentConversationLogger } from './conversation-logger';
import { createLoggingLLMProvider } from './logging-llm-provider';

function createStubProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    name: 'stub',
    modelId: 'stub-model',
    description: 'stub',
    contextWindow: 8000,
    async chat(messages: LLMMessage[]): Promise<LLMChatResponse> {
      return {
        content: `reply:${messages.at(-1)?.content}`,
        model: 'stub-model',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    },
    async *chatStream(messages: LLMMessage[]): AsyncGenerator<LLMStreamChunk> {
      yield { type: 'text', content: 'hello ' };
      yield { type: 'text', content: 'world' };
      yield { type: 'done' };
      void messages;
    },
    supportsJSONMode() {
      return true;
    },
    async estimateTokens(text: string) {
      return text.length;
    },
    ...overrides,
  };
}

describe('createLoggingLLMProvider', () => {
  let logger: AgentConversationLogger;
  let provider: LLMProvider;

  beforeEach(() => {
    logger = new AgentConversationLogger({ persistToFile: false });
    logger.beginSession('task-1', { phase: 'analyze', role: 'analyzer' });
    provider = createLoggingLLMProvider(createStubProvider(), logger, {
      taskId: 'task-1',
      phase: 'analyze',
      role: 'analyzer',
    });
  });

  it('chat 记录 llm_request 与 llm_response，并透传结果', async () => {
    const res = await provider.chat(
      [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
      { temperature: 0.3, responseFormat: 'json_object' },
    );

    expect(res.content).toBe('reply:hi');
    expect(res.usage?.totalTokens).toBe(15);

    const entries = logger.getSession('task-1')!.entries;
    const req = entries.find((e) => e.type === 'llm_request');
    const resp = entries.find((e) => e.type === 'llm_response');
    expect(req).toBeDefined();
    expect(resp).toBeDefined();
    expect(req!.data.model).toBe('stub-model');
    expect(req!.data.phase).toBe('analyze');
    expect(req!.data.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
    expect(resp!.data.content).toBe('reply:hi');
    expect((resp!.data.usage as { totalTokens: number }).totalTokens).toBe(15);
    expect(typeof resp!.data.durationMs).toBe('number');
  });

  it('chat 失败时记录 error 并重新抛出', async () => {
    const failing = createLoggingLLMProvider(
      createStubProvider({
        async chat() {
          throw new Error('boom');
        },
      }),
      logger,
      { taskId: 'task-1' },
    );

    await expect(failing.chat([{ role: 'user', content: 'x' }])).rejects.toThrow('boom');
    const resp = logger.getSession('task-1')!.entries.findLast((e) => e.type === 'llm_response');
    expect(resp?.data.ok).toBe(false);
    expect(resp?.data.error).toBe('boom');
  });

  it('chatStream 聚合文本后记录响应', async () => {
    const chunks: string[] = [];
    for await (const chunk of provider.chatStream([{ role: 'user', content: 'stream' }])) {
      if (chunk.content) chunks.push(chunk.content);
    }
    expect(chunks.join('')).toBe('hello world');

    const resp = logger.getSession('task-1')!.entries.find((e) => e.type === 'llm_response');
    expect(resp?.data.content).toBe('hello world');
    expect(resp?.data.streamed).toBe(true);
  });

  it('supportsJSONMode / estimateTokens / 元信息 透传', async () => {
    expect(provider.supportsJSONMode()).toBe(true);
    expect(await provider.estimateTokens('abc')).toBe(3);
    expect(provider.name).toBe('stub');
    expect(provider.modelId).toBe('stub-model');
    expect(provider.description).toBe('stub');
    expect(provider.contextWindow).toBe(8000);
  });

  it('超长消息内容被截断', async () => {
    const longContent = 'x'.repeat(10000);
    await provider.chat([{ role: 'user', content: longContent }]);
    const req = logger.getSession('task-1')!.entries.find((e) => e.type === 'llm_request');
    const messages = req!.data.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content.length).toBeLessThan(2500);
    expect(messages[0].content).toContain('已截断');
  });
});
