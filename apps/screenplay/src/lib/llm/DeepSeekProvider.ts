import { BaseProvider } from './BaseProvider';
import type { LLMMessage, LLMChatOptions, LLMChatResponse, LLMStreamChunk } from './types';

/**
 * DeepSeek LLM Provider.
 * Uses OpenAI-compatible API format: https://api.deepseek.com/v1
 */
export class DeepSeekProvider extends BaseProvider {
  readonly name = 'DeepSeek';
  readonly modelId: string;
  readonly description: string;
  readonly contextWindow = 65536;
  protected readonly baseUrl = 'https://api.deepseek.com/v1';
  protected readonly apiKey: string;

  /**
   * @param apiKey - DeepSeek API key
   * @param modelId - Model ID (default from env DEEPSEEK_MODEL_ID or 'deepseek-chat')
   */
  constructor(apiKey: string, modelId?: string) {
    super();
    this.apiKey = apiKey;
    this.modelId = modelId || process.env.DEEPSEEK_MODEL_ID || 'deepseek-chat';
    this.description = `DeepSeek (${this.modelId})`;
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResponse> {
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    };

    // JSON mode: response_format + system prompt double guarantee
    if (options?.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    const response = await this.fetchWithRetry('/chat/completions', body, options?.signal);
    const json = await response.json();

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${json.error?.message || response.statusText}`);
    }

    return {
      content: json.choices[0].message.content,
      usage: json.usage && {
        promptTokens: json.usage.prompt_tokens,
        completionTokens: json.usage.completion_tokens,
        totalTokens: json.usage.total_tokens,
      },
      model: json.model,
      raw: json,
    };
  }

  async *chatStream(
    messages: LLMMessage[],
    options?: LLMChatOptions,
  ): AsyncGenerator<LLMStreamChunk> {
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
    };

    const stream = this.streamFetch('/chat/completions', body, options?.signal);
    yield* stream;
  }
}
