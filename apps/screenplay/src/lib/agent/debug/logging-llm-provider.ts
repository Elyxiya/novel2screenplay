/**
 * Agent 调试日志 - LLM Provider 包装器
 *
 * 包装底层 LLMProvider（src/lib/llm/types.ts 接口），
 * 在 chat / chatStream 边界记录请求与响应，其余能力原样透传。
 */

import type { LLMProvider, LLMMessage, LLMChatOptions, LLMChatResponse, LLMStreamChunk } from '../../llm/types';
import { AgentConversationLogger, safeStringify, isDebugEnabled } from './conversation-logger';

export interface LoggingLLMContext {
  taskId: string;
  phase?: string;
  role?: string;
}

function serializeMessages(
  messages: LLMMessage[],
  maxLen: number,
): Array<{ role: string; content: string }> {
  return messages.map((m) => ({
    role: m.role,
    content: safeStringify(m.content, maxLen),
  }));
}

function serializeOptions(options?: LLMChatOptions): Record<string, unknown> | undefined {
  if (!options) return undefined;
  return {
    responseFormat: options.responseFormat,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  };
}

/**
 * 包装 LLMProvider，记录每次 LLM 调用的请求与响应。
 * 当 isDebugEnabled() 为 false 时零开销透传。
 */
export function createLoggingLLMProvider(
  inner: LLMProvider,
  logger: AgentConversationLogger,
  ctx: LoggingLLMContext,
): LLMProvider {
  const record = (type: 'request' | 'response', payload: Record<string, unknown>, durationMs?: number): void => {
    if (!isDebugEnabled()) return;
    logger.append(ctx.taskId, {
      type: type === 'request' ? 'llm_request' : 'llm_response',
      level: 'debug',
      data: {
        model: inner.modelId,
        phase: ctx.phase,
        role: ctx.role,
        ...payload,
        ...(durationMs !== undefined ? { durationMs } : {}),
      },
    });
  };

  return {
    get name() {
      return inner.name;
    },
    get modelId() {
      return inner.modelId;
    },
    get description() {
      return inner.description;
    },
    get contextWindow() {
      return inner.contextWindow;
    },

    async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResponse> {
      record('request', {
        messages: serializeMessages(messages, logger.maxLength),
        options: serializeOptions(options),
      });

      const t0 = Date.now();
      try {
        const response = await inner.chat(messages, options);
        record(
          'response',
          {
            content: safeStringify(response.content, logger.maxLength),
            usage: response.usage ?? null,
          },
          Date.now() - t0,
        );
        return response;
      } catch (err) {
        record(
          'response',
          {
            error: err instanceof Error ? err.message : String(err),
            ok: false,
          },
          Date.now() - t0,
        );
        throw err;
      }
    },

    async *chatStream(
      messages: LLMMessage[],
      options?: LLMChatOptions,
    ): AsyncGenerator<LLMStreamChunk> {
      record('request', {
        messages: serializeMessages(messages, logger.maxLength),
        options: serializeOptions(options),
      });

      const t0 = Date.now();
      const chunks: string[] = [];
      try {
        for await (const chunk of inner.chatStream(messages, options)) {
          if (chunk.type === 'text' && chunk.content) chunks.push(chunk.content);
          yield chunk;
        }
        record(
          'response',
          {
            content: safeStringify(chunks.join(''), logger.maxLength),
            streamed: true,
          },
          Date.now() - t0,
        );
      } catch (err) {
        record(
          'response',
          {
            error: err instanceof Error ? err.message : String(err),
            ok: false,
          },
          Date.now() - t0,
        );
        throw err;
      }
    },

    supportsJSONMode(): boolean {
      return inner.supportsJSONMode();
    },

    async estimateTokens(text: string): Promise<number> {
      return inner.estimateTokens(text);
    },
  };
}
