/**
 * Agent LLM Adapter - Message Converter
 *
 * Bidirectional conversion between:
 * - AgentMessage (framework): role ∈ {system,user,assistant,tool}, no tool_calls
 * - LLMMessage (llm layer): role ∈ {system,user,assistant}, no tool_calls
 *
 * The agent adapter normalises messages to OpenAI format before sending,
 * and parses OpenAI responses (with tool_calls) back to framework format.
 */

import type { AgentMessage } from '../types';
import type { LLMMessage } from '../../llm/types';
import type { AgentLLMMessage, ParsedToolCall } from './types';
import type { LLMChatResponse } from '../../llm/types';

/**
 * Converts AgentMessage → LLMMessage for sending to the LLM provider.
 * - Strips tool role messages (they are added separately as tool role)
 * - Preserves system/user/assistant
 */
export function toLLMMessages(messages: AgentMessage[]): LLMMessage[] {
  const result: LLMMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') continue;

  const content = msg.role === 'assistant' && (msg as unknown as { toolCalls?: unknown }).toolCalls
    ? (msg.content || '[tool calls]')
    : msg.content;

    result.push({ role: msg.role as 'system' | 'user' | 'assistant', content });
  }

  return result;
}

/**
 * Converts AgentLLMMessage (with tool_calls support) → LLMMessage.
 * Used when the agent already has parsed tool_call results stored in messages.
 */
export function toLLMMessagesWithTools(
  messages: AgentLLMMessage[],
): LLMMessage[] {
  const result: LLMMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Tool result: embed in a user message (OpenAI compatible)
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant message with tool_calls: keep content, add tool_calls via raw
      result.push({ role: 'assistant', content: msg.content || '' });
    } else {
      result.push({ role: msg.role as 'system' | 'user' | 'assistant', content: msg.content });
    }
  }

  return result;
}

/**
 * Parses an LLMChatResponse into framework-compatible format.
 * Handles both plain text responses and tool_calls responses.
 */
export function parseLLMResponse(
  response: LLMChatResponse,
): {
  content: string;
  toolCalls: ParsedToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
} {
  const raw = response.raw as {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  } | undefined;

  const choice = raw?.choices?.[0];
  const finishReason = (choice?.finish_reason ?? 'stop') as
    | 'stop'
    | 'length'
    | 'tool_calls'
    | 'error';

  const message = choice?.message;
  const toolCalls: ParsedToolCall[] = [];

  if (message?.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // Malformed arguments — pass through as-is
        args = { _raw: tc.function.arguments };
      }
      toolCalls.push({
        id: tc.id,
        name: tc.function.name,
        arguments: args,
        raw: {
          id: tc.id,
          type: tc.type as 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        },
      });
    }
  }

  return {
    content: message?.content ?? '',
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
  };
}

/**
 * Converts a tool result into a tool-role message for the next LLM call.
 */
export function toolResultToMessage(
  toolCallId: string,
  toolName: string,
  result: unknown,
): AgentLLMMessage {
  const content =
    result === undefined || result === null
      ? `${toolName} completed with no output`
      : typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);

  return {
    role: 'tool',
    content,
    toolCallId,
  };
}
