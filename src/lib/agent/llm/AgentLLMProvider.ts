/**
 * Agent LLM Adapter - AgentLLMProvider
 *
 * Implements the LLMProvider interface required by AgentCore,
 * bridging the agent framework with the existing LLM layer.
 *
 * Responsibilities:
 * 1. Adapts AgentMessage[] → LLMMessage[] (strips framework-specific fields)
 * 2. Sends messages to the underlying LLM provider (DeepSeek, OpenAI, etc.)
 * 3. Handles OpenAI function-calling protocol (tool_calls in response)
 * 4. Converts LLM response → LLMResponse (framework format)
 */

import type { LLMProvider } from '../../llm/types';
import type { AgentMessage } from '../types';
import type { AgentTool } from '../tool-types';
import type {
  AgentChatOptions,
  ParsedToolCall,
} from './types';

import { toOpenAITools } from './tool-registry';
import { toLLMMessages, parseLLMResponse } from './message-converter';

/**
 * Adapter that wraps an LLMProvider and implements the AgentCore LLMProvider interface.
 * The adapter:
 * - Manages conversation history (accumulating tool results)
 * - Converts messages to/from OpenAI format
 * - Parses tool_calls from the response
 */
export class AgentLLMProvider {
  private messages: AgentMessage[] = [];
  private llmProvider: LLMProvider;
  private tools: AgentTool[];

  constructor(llmProvider: LLMProvider, tools: AgentTool[] = []) {
    this.llmProvider = llmProvider;
    this.tools = tools;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Replace all messages in the conversation history.
   * Used when AgentCore resets working memory.
   */
  setMessages(messages: AgentMessage[]): void {
    this.messages = messages;
  }

  /**
   * Get a snapshot of the current conversation history.
   */
  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  /**
   * Update the tool list available to the agent.
   */
  setTools(tools: AgentTool[]): void {
    this.tools = tools;
  }

  /**
   * Send a new message and get a response with optional tool calls.
   * This call is non-streaming (AgentCore uses batch tool execution).
   */
  async chat(
    messages: AgentMessage[],
    options?: AgentChatOptions,
  ): Promise<{
    content: string;
    toolCalls: ParsedToolCall[];
    finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  }> {
    this.messages = messages;

    const llmMessages = toLLMMessages(messages);
    const openaiTools = toOpenAITools(this.tools);

    const llmResponse = await this.llmProvider.chat(llmMessages, {
      signal: options?.signal,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    });

    const parsed = parseLLMResponse(llmResponse);

    return {
      content: parsed.content,
      toolCalls: parsed.toolCalls,
      finishReason: parsed.finishReason,
      usage: llmResponse.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  /**
   * Append tool results to the conversation history.
   * Returns updated messages array ready for the next LLM call.
   */
  addToolResults(
    toolCallId: string,
    toolName: string,
    result: unknown,
  ): AgentMessage[] {
    const content =
      result === undefined || result === null
        ? `${toolName} completed with no output`
        : typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2);
    this.messages.push({
      id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: 'tool',
      content,
      timestamp: Date.now(),
      toolCallId,
      toolName,
    });
    return this.messages;
  }

  /**
   * Estimate tokens for the current conversation.
   * Delegates to the underlying provider (tiktoken or char-based fallback).
   */
  async estimateTokens(text: string): Promise<number> {
    return this.llmProvider.estimateTokens(text);
  }

  /**
   * Returns the underlying provider's name for logging.
   */
  get providerName(): string {
    return this.llmProvider.name;
  }

  /**
   * Returns the underlying provider's model ID.
   */
  get modelId(): string {
    return this.llmProvider.modelId;
  }
}

/**
 * Creates an LLMProvider-compatible wrapper around AgentLLMProvider
 * that can be passed directly to AgentCore.
 *
 * Note: AgentCore expects the raw tool-calling response format,
 * so this wrapper provides the adapter-level response format.
 */
export function createAgentLLMProvider(
  llmProvider: LLMProvider,
  tools: AgentTool[] = [],
): AgentLLMProvider {
  return new AgentLLMProvider(llmProvider, tools);
}
