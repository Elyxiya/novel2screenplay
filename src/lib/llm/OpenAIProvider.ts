import { BaseProvider } from './BaseProvider';
import type { LLMMessage, LLMChatOptions, LLMChatResponse, LLMStreamChunk } from './types';

/**
 * OpenAI LLM Provider.
 */
export class OpenAIProvider extends BaseProvider {
  readonly name = 'OpenAI';
  readonly modelId = 'gpt-4o';
  readonly description = 'OpenAI GPT-4o';
  readonly contextWindow = 128000;
  protected readonly baseUrl = 'https://api.openai.com/v1';
  protected readonly apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  async chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResponse> {
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    };

    if (options?.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    const response = await this.fetchWithRetry('/chat/completions', body, options?.signal);
    const json = await response.json();

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${json.error?.message || response.statusText}`);
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
