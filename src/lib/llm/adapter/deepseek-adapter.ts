/**
 * DeepSeek LLM Adapter
 *
 * 实现 DeepSeek 模型的 LLM Adapter。
 */

import type {
  LLMAdapter,
  LLMAdapterConfig,
  LLMAdapterHealth,
} from './types';
import type { LLMMessage, LLMChatOptions, LLMChatResponse, LLMStreamChunk } from '../types';
import { BaseProvider } from '../BaseProvider';
import {
  createBaseAdapterConfig,
  createBaseHealth,
} from './types';

const DEEPSEEK_MODELS = [
  'deepseek-chat',
  'deepseek-coder',
  'deepseek-reasoner',
];

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

/**
 * DeepSeek LLM Adapter
 */
export class DeepSeekAdapter extends BaseProvider implements LLMAdapter {
  config: LLMAdapterConfig;
  health: LLMAdapterHealth;
  private requestCount = 0;
  private errorCount = 0;
  private totalLatency = 0;

  constructor(config?: Partial<LLMAdapterConfig>) {
    super();

    this.config = {
      ...createBaseAdapterConfig(
        'deepseek',
        'DeepSeek',
        DEEPSEEK_MODELS,
        'deepseek-chat'
      ),
      ...config,
    };

    this.health = createBaseHealth(this.config.id);
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
    model?: string
  ): Promise<LLMChatResponse> {
    const modelId = model || this.config.defaultModel;
    const t0 = Date.now();

    this.requestCount++;
    this.health.currentLoad = Math.min(this.requestCount, this.config.maxConcurrentRequests);

    try {
      const response = await this.fetchWithRetry(
        '/chat/completions',
        {
          model: modelId,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 4096,
          ...(options?.responseFormat === 'json_object' && {
            response_format: { type: 'json_object' },
          }),
        },
        options?.signal
      );

      const data = await response.json();
      const latency = Date.now() - t0;

      this.totalLatency += latency;
      this.health = {
        ...this.health,
        lastCheck: Date.now(),
        avgLatency: this.totalLatency / this.requestCount,
        errorRate: this.errorCount / this.requestCount,
        status: this.health.errorRate > 0.1 ? 'degraded' : 'healthy',
      };

      return {
        content: data.choices?.[0]?.message?.content || '',
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
        model: data.model || modelId,
        raw: data,
      };
    } catch (error) {
      this.errorCount++;
      this.health = {
        ...this.health,
        lastCheck: Date.now(),
        errorRate: this.errorCount / this.requestCount,
        status: this.health.errorRate > 0.3 ? 'unhealthy' : 'degraded',
      };
      throw error;
    }
  }

  protected readonly baseUrl = DEEPSEEK_BASE_URL;
  protected readonly apiKey = DEEPSEEK_API_KEY;
  readonly name = 'DeepSeek';
  readonly modelId = 'deepseek-chat';
  readonly description = 'DeepSeek Chat API';
  readonly contextWindow = 128000;

  async *chatStream(
    messages: LLMMessage[],
    options?: LLMChatOptions,
    model?: string
  ): AsyncGenerator<LLMStreamChunk> {
    const modelId = model || this.config.defaultModel;

    yield* this.streamFetch(
      '/chat/completions',
      {
        model: modelId,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      },
      options?.signal
    );
  }

  supportsModel(modelId: string): boolean {
    return DEEPSEEK_MODELS.includes(modelId);
  }

  getHealth(): LLMAdapterHealth {
    return this.health;
  }

  updateConfig(config: Partial<LLMAdapterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  resetHealth(): void {
    this.requestCount = 0;
    this.errorCount = 0;
    this.totalLatency = 0;
    this.health = createBaseHealth(this.config.id);
  }
}

// 创建 DeepSeek Adapter 实例
let deepSeekAdapter: DeepSeekAdapter | null = null;

export function getDeepSeekAdapter(): DeepSeekAdapter {
  if (!deepSeekAdapter) {
    deepSeekAdapter = new DeepSeekAdapter();
  }
  return deepSeekAdapter;
}
