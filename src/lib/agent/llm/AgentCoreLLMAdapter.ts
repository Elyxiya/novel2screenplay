/**
 * Agent LLM Adapter - AgentCore 兼容层
 *
 * AgentCore 期望的 LLMProvider 接口为：
 *   chat(messages: Array<{role, content}>, tools: AgentTool[], signal?): Promise<LLMResponse>
 *
 * AgentLLMProvider 提供的是：
 *   chat(messages: AgentMessage[], options?: AgentChatOptions)
 *
 * 本适配器桥接两者：补齐 AgentMessage 的 id/timestamp 字段，
 * 并把 ParsedToolCall[] 归一化为 AgentCore 需要的 ToolCall[]。
 */

import type { AgentTool } from '../tool-types';
import type { AgentMessage, ToolCall, TokenUsage } from '../types';
import type { AgentLLMProvider } from './AgentLLMProvider';

export interface AgentCoreLLMResponse {
  content: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  toolCalls: ToolCall[];
  usage: TokenUsage;
}

/**
 * 实现 AgentCore 所需 LLMProvider 接口的适配器。
 */
export class AgentCoreLLMAdapter {
  constructor(private inner: AgentLLMProvider) {}

  async chat(
    messages: Array<{ role: string; content: string }>,
    tools: AgentTool[],
    signal?: AbortSignal,
  ): Promise<AgentCoreLLMResponse> {
    // AgentLLMProvider 需要带 id/timestamp 的 AgentMessage
    const agentMessages: AgentMessage[] = messages.map((m) => ({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      role: m.role as AgentMessage['role'],
      content: m.content,
      timestamp: Date.now(),
    }));

    this.inner.setTools(tools);

    const res = await this.inner.chat(agentMessages, { signal });

    return {
      content: res.content,
      finishReason: res.finishReason,
      toolCalls: res.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      usage: res.usage,
    };
  }
}

/**
 * 便捷工厂：包装底层 LLM Provider 与工具列表。
 */
export function createAgentCoreAdapter(
  inner: AgentLLMProvider,
): AgentCoreLLMAdapter {
  return new AgentCoreLLMAdapter(inner);
}
