/**
 * Agent LLM Adapter - Types
 *
 * Extensions to the base LLM types for agent-specific functionality.
 * These types handle the gap between the framework's tool-calling needs
 * and the OpenAI-compatible message format.
 */

import type { LLMMessage } from '../../llm/types';

/**
 * Extended message format supporting the 'tool' role.
 * The base LLM layer only has system/user/assistant.
 * We add 'tool' for tool result messages.
 */
export type AgentLLMRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A message in the agent LLM adapter layer.
 * Uses OpenAI's tool_call format for assistant messages.
 */
export interface AgentLLMMessage {
  role: AgentLLMRole;
  content: string;
  /** Only present for role === 'assistant' when model returns tool_calls */
  toolCalls?: OpenAIFunctionCall[];
  /** Only present for role === 'tool' */
  toolCallId?: string;
  name?: string;
}

/**
 * OpenAI function-calling format (shared across OpenAI-compatible providers).
 */
export interface OpenAIFunctionCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string: { "arg1": value1, ... }
  };
}

/**
 * Maps AgentTool (framework) → OpenAI tools format.
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, OpenAIFunctionParameter>;
      required?: string[];
    };
  };
}

export interface OpenAIFunctionParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

/**
 * Parsed tool call ready for execution by the agent.
 */
export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  raw: OpenAIFunctionCall;
}

/**
 * Options for building the agent chat request.
 */
export interface AgentChatOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}
