/**
 * Custom OpenAI-compatible LLM Provider / Adapter
 *
 * 接入任意 OpenAI 兼容协议的自定义 API（中转服务、Kimi、GLM、通义、Ollama 等）。
 * 同时实现 LLMProvider（转换管线 / Agent 编排）与 LLMAdapter（/api/models 与作家 AI）。
 *
 * 环境变量：
 * - CUSTOM_OPENAI_BASE_URL   必需，例如 https://api.openai.com/v1
 * - CUSTOM_OPENAI_API_KEY    可选（本地服务如 Ollama 可省略）
 * - CUSTOM_OPENAI_MODEL      默认模型，例如 gpt-4o-mini
 * - CUSTOM_OPENAI_MODELS     逗号分隔的其他可用模型（可选）
 * - CUSTOM_OPENAI_NAME       显示名称（可选）
 * - CUSTOM_OPENAI_CONTEXT_WINDOW 上下文窗口（可选，默认 128000）
 */

import { BaseProvider } from './BaseProvider';
import type {
  LLMMessage,
  LLMChatOptions,
  LLMChatResponse,
  LLMStreamChunk,
  LLMProvider,
} from './types';
import type { LLMAdapter, LLMAdapterConfig, LLMAdapterHealth } from './adapter/types';
import { createBaseAdapterConfig, createBaseHealth } from './adapter/types';

export interface CustomOpenAISettings {
  baseUrl: string;
  apiKey: string;
  name: string;
  defaultModel: string;
  supportedModels: string[];
  contextWindow: number;
}

/** 从环境变量读取配置；未配置 CUSTOM_OPENAI_BASE_URL 时返回 null */
export function parseCustomOpenAISettings(): CustomOpenAISettings | null {
  const baseUrl = process.env.CUSTOM_OPENAI_BASE_URL?.trim();
  if (!baseUrl) return null;

  const defaultModel = process.env.CUSTOM_OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const extra = (process.env.CUSTOM_OPENAI_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    baseUrl,
    apiKey: process.env.CUSTOM_OPENAI_API_KEY?.trim() ?? '',
    name: process.env.CUSTOM_OPENAI_NAME?.trim() || 'Custom OpenAI',
    defaultModel,
    supportedModels: [defaultModel, ...extra].filter((m, i, arr) => arr.indexOf(m) === i),
    contextWindow: Number(process.env.CUSTOM_OPENAI_CONTEXT_WINDOW) || 128000,
  };
}

/** 把 baseUrl 规整为 /chat/completions 完整端点，并按后缀拆分为 base + path */
function resolveChatCompletions(baseUrl: string): { base: string; path: string } {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let full: string;
  if (trimmed.endsWith('/chat/completions')) {
    full = trimmed;
  } else if (trimmed.endsWith('/v1')) {
    full = `${trimmed}/chat/completions`;
  } else {
    full = `${trimmed}/v1/chat/completions`;
  }
  return { base: full.slice(0, -'/chat/completions'.length), path: '/chat/completions' };
}

/**
 * Custom OpenAI-compatible Provider
 */
export class CustomOpenAIProvider extends BaseProvider implements LLMProvider, LLMAdapter {
  readonly name = 'custom-openai';
  readonly modelId: string;
  readonly description: string;
  readonly contextWindow: number;
  readonly supportedModels: string[];
  protected baseUrl: string;
  protected apiKey: string;
  config: LLMAdapterConfig;
  health: LLMAdapterHealth;
  private requestCount = 0;
  private errorCount = 0;
  private totalLatency = 0;

  constructor(settings: CustomOpenAISettings) {
    super();
    const { base } = resolveChatCompletions(settings.baseUrl);
    this.baseUrl = base;
    this.apiKey = settings.apiKey;
    this.modelId = settings.defaultModel;
    this.supportedModels = settings.supportedModels;
    this.description = `${settings.name} (${settings.defaultModel})`;
    this.contextWindow = settings.contextWindow;
    this.config = createBaseAdapterConfig(
      'custom-openai',
      settings.name,
      settings.supportedModels,
      settings.defaultModel,
    );
    this.health = createBaseHealth(this.config.id);
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMChatOptions,
    model?: string,
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
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 4096,
          ...(options?.responseFormat === 'json_object' && {
            response_format: { type: 'json_object' },
          }),
        },
        options?.signal,
      );
      const data = await response.json();
      const latency = Date.now() - t0;

      if (!response.ok) {
        throw new Error(`Custom OpenAI API error: ${data.error?.message || response.statusText}`);
      }

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

  async *chatStream(
    messages: LLMMessage[],
    options?: LLMChatOptions,
    model?: string,
  ): AsyncGenerator<LLMStreamChunk> {
    const modelId = model || this.config.defaultModel;

    yield* this.streamFetch(
      '/chat/completions',
      {
        model: modelId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      },
      options?.signal,
    );
  }

  supportsModel(modelId: string): boolean {
    return this.supportedModels.includes(modelId);
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

// 全局单例（未配置时返回 null）
let cachedCustomOpenAI: CustomOpenAIProvider | null | undefined;

export function getCustomOpenAIProvider(): CustomOpenAIProvider | null {
  if (cachedCustomOpenAI === undefined) {
    const settings = parseCustomOpenAISettings();
    cachedCustomOpenAI = settings ? new CustomOpenAIProvider(settings) : null;
  }
  return cachedCustomOpenAI;
}
