/** Role in a chat completion message */
export type LLMRole = 'system' | 'user' | 'assistant';

/** A single message in the chat completion request */
export interface LLMMessage {
  role: LLMRole;
  content: string;
}

/** Options for chat completion calls */
export interface LLMChatOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
  signal?: AbortSignal;
}

/** Response from a chat completion call */
export interface LLMChatResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  raw?: unknown;
}

/** A chunk from a streaming response */
export interface LLMStreamChunk {
  type: 'text' | 'done' | 'error';
  content?: string;
  error?: string;
}

/**
 * Abstract interface for LLM providers.
 * All providers (DeepSeek, OpenAI, Claude, etc.) implement this.
 */
export interface LLMProvider {
  readonly name: string;
  readonly modelId: string;
  readonly description: string;
  readonly contextWindow: number;

  /** Send a chat completion request */
  chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResponse>;

  /** Streaming chat completion */
  chatStream(messages: LLMMessage[], options?: LLMChatOptions): AsyncGenerator<LLMStreamChunk>;

  /** Whether this provider supports JSON response mode */
  supportsJSONMode(): boolean;

  /** Estimate token count for a string */
  estimateTokens(text: string): number;
}
