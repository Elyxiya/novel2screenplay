/**
 * Custom Anthropic-format LLM Provider / Adapter
 *
 * 接入 Anthropic 原生 Messages API（https://api.anthropic.com/v1/messages）
 * 或兼容 Anthropic 协议的中转服务。
 * 同时实现 LLMProvider（转换管线 / Agent 编排）与 LLMAdapter（/api/models 与作家 AI）。
 *
 * 环境变量：
 * - CUSTOM_ANTHROPIC_BASE_URL 必需，例如 https://api.anthropic.com（可带 /v1）
 * - CUSTOM_ANTHROPIC_API_KEY  必需
 * - CUSTOM_ANTHROPIC_MODEL    默认模型，例如 claude-sonnet-4-20250514
 * - CUSTOM_ANTHROPIC_MODELS   逗号分隔的其他可用模型（可选）
 * - CUSTOM_ANTHROPIC_NAME     显示名称（可选）
 * - CUSTOM_ANTHROPIC_CONTEXT_WINDOW 上下文窗口（可选，默认 200000）
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

const ANTHROPIC_VERSION = '2023-06-01';

export interface CustomAnthropicSettings {
  baseUrl: string;
  apiKey: string;
  name: string;
  defaultModel: string;
  supportedModels: string[];
  contextWindow: number;
}

/** 从环境变量读取配置；未配置 CUSTOM_ANTHROPIC_BASE_URL 时返回 null */
export function parseCustomAnthropicSettings(): CustomAnthropicSettings | null {
  const baseUrl = process.env.CUSTOM_ANTHROPIC_BASE_URL?.trim();
  if (!baseUrl) return null;

  const defaultModel =
    process.env.CUSTOM_ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-20250514';
  const extra = (process.env.CUSTOM_ANTHROPIC_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    baseUrl,
    apiKey: process.env.CUSTOM_ANTHROPIC_API_KEY?.trim() ?? '',
    name: process.env.CUSTOM_ANTHROPIC_NAME?.trim() || 'Custom Anthropic',
    defaultModel,
    supportedModels: [defaultModel, ...extra].filter((m, i, arr) => arr.indexOf(m) === i),
    contextWindow: Number(process.env.CUSTOM_ANTHROPIC_CONTEXT_WINDOW) || 200000,
  };
}

/** 把 baseUrl 规整为 /v1/messages 完整端点，并按后缀拆分为 base + path */
function resolveMessagesEndpoint(baseUrl: string): { base: string; path: string } {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let full: string;
  if (trimmed.endsWith('/v1/messages')) {
    full = trimmed;
  } else if (trimmed.endsWith('/messages')) {
    full = trimmed;
  } else if (trimmed.endsWith('/v1')) {
    full = `${trimmed}/messages`;
  } else {
    full = `${trimmed}/v1/messages`;
  }
  return { base: full.slice(0, -'/messages'.length), path: '/messages' };
}

/** 拆分 system 消息（Anthropic 使用顶层 system 字段），并归一化剩余消息 */
function toAnthropicMessages(messages: LLMMessage[]): { system: string; messages: Array<{ role: string; content: string }> } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  return { system, messages: rest };
}

/**
 * Custom Anthropic Provider
 */
export class CustomAnthropicProvider extends BaseProvider implements LLMProvider, LLMAdapter {
  readonly name = 'custom-anthropic';
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

  constructor(settings: CustomAnthropicSettings) {
    super();
    const { base } = resolveMessagesEndpoint(settings.baseUrl);
    this.baseUrl = base;
    this.apiKey = settings.apiKey;
    this.modelId = settings.defaultModel;
    this.supportedModels = settings.supportedModels;
    this.description = `${settings.name} (${settings.defaultModel})`;
    this.contextWindow = settings.contextWindow;
    this.config = createBaseAdapterConfig(
      'custom-anthropic',
      settings.name,
      settings.supportedModels,
      settings.defaultModel,
    );
    this.health = createBaseHealth(this.config.id);
  }

  /** Anthropic 使用 x-api-key + anthropic-version，而非 Bearer */
  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
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

    const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: options?.maxTokens ?? 4096,
      messages: anthropicMessages,
    };
    if (options?.temperature != null) body.temperature = options.temperature;
    if (system) body.system = system;

    try {
      const response = await this.fetchWithRetry('/messages', body, options?.signal);
      const data = await response.json();
      const latency = Date.now() - t0;

      if (!response.ok) {
        throw new Error(
          `Custom Anthropic API error: ${data.error?.message || response.statusText}`,
        );
      }

      this.totalLatency += latency;
      this.health = {
        ...this.health,
        lastCheck: Date.now(),
        avgLatency: this.totalLatency / this.requestCount,
        errorRate: this.errorCount / this.requestCount,
        status: this.health.errorRate > 0.1 ? 'degraded' : 'healthy',
      };

      const content = Array.isArray(data.content)
        ? data.content
            .filter((b: { type?: string }) => b?.type === 'text')
            .map((b: { text?: string }) => b.text ?? '')
            .join('')
        : (data.content ?? '');

      return {
        content,
        usage: data.usage
          ? {
              promptTokens: data.usage.input_tokens ?? 0,
              completionTokens: data.usage.output_tokens ?? 0,
              totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
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

    const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: options?.maxTokens ?? 4096,
      messages: anthropicMessages,
      stream: true,
    };
    if (options?.temperature != null) body.temperature = options.temperature;
    if (system) body.system = system;

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      yield { type: 'error', error: `HTTP ${response.status}: ${text.slice(0, 200) || response.statusText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            // Anthropic 原生：content_block_delta.delta.text
            // 兼容 OpenAI 格式代理：choices[0].delta.content
            const text = parsed.delta?.text ?? parsed.choices?.[0]?.delta?.content ?? '';
            if (text) yield { type: 'text', content: text };
            if (parsed.type === 'message_stop') break;
          } catch {
            // 跳过无法解析的分片
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
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
let cachedCustomAnthropic: CustomAnthropicProvider | null | undefined;

export function getCustomAnthropicProvider(): CustomAnthropicProvider | null {
  if (cachedCustomAnthropic === undefined) {
    const settings = parseCustomAnthropicSettings();
    cachedCustomAnthropic = settings ? new CustomAnthropicProvider(settings) : null;
  }
  return cachedCustomAnthropic;
}
