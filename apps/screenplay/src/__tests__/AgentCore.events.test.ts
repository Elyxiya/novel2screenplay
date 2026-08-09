/**
 * AgentCore 事件订阅 API 测试
 *
 * 覆盖：
 * - on() 订阅后能收到 state_change / task_start / task_complete 等事件
 * - off() / 取消订阅函数能停止接收
 * - emit 事件分发不影响 Agent 正常执行
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentCore, type AgentEventHandler } from '@/lib/agent/AgentCore';
import type { LLMProvider, LLMResponse } from '@/lib/agent/AgentCore';
import type { AgentConfig, AgentTool, ToolCall } from '@/lib/agent/types';
import type { ToolExecutor } from '@/lib/agent/AgentCore';

// ── Stubs ──────────────────────────────────────────────────────────────────────

class StubLLMProvider implements LLMProvider {
  async chat(messages: Array<{ role: string; content: string }>): Promise<LLMResponse> {
    return {
      content: `reply:${messages.at(-1)?.content}`,
      finishReason: 'stop',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
  }
}

const stubTool: AgentTool = {
  name: 'noop',
  description: 'noop',
  inputSchema: {},
};

const stubExecutor: ToolExecutor = {
  async execute(call: ToolCall) {
    return `done:${call.name}`;
  },
  listTools() {
    return [stubTool];
  },
};

const baseConfig: AgentConfig = {
  modelId: 'stub-model',
  maxTokens: 1000,
  temperature: 0.5,
  maxSteps: 3,
  maxTotalTokens: 4000,
  maxConcurrentTools: 1,
  verbose: false,
  systemPrompt: '你是测试助手。',
  tools: [stubTool],
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AgentCore 事件订阅', () => {
  it('on() 订阅后可收到 state_change 与 task_start 事件', async () => {
    const agent = new AgentCore(baseConfig, new StubLLMProvider(), stubExecutor);
    const received: Parameters<AgentEventHandler>[0][] = [];
    const unsubscribe = agent.on((e) => received.push(e));

    await agent.run('开始');

    expect(received.some((e) => e.type === 'task_start')).toBe(true);
    expect(received.some((e) => e.type === 'state_change')).toBe(true);
    expect(received.some((e) => e.type === 'task_complete')).toBe(true);
    unsubscribe();
  });

  it('取消订阅后不再收到事件', async () => {
    const agent = new AgentCore(baseConfig, new StubLLMProvider(), stubExecutor);
    const received: Parameters<AgentEventHandler>[0][] = [];
    const unsubscribe = agent.on((e) => received.push(e));
    unsubscribe();

    await agent.run('开始');
    expect(received).toHaveLength(0);
  });

  it('off() 移除指定处理器', async () => {
    const agent = new AgentCore(baseConfig, new StubLLMProvider(), stubExecutor);
    const handler = vi.fn();
    agent.on(handler);
    agent.off(handler);
    await agent.run('开始');
    expect(handler).not.toHaveBeenCalled();
  });

  it('事件处理器抛异常不影响 Agent 执行', async () => {
    const agent = new AgentCore(baseConfig, new StubLLMProvider(), stubExecutor);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    agent.on(() => {
      throw new Error('handler-boom');
    });
    const result = await agent.run('开始');
    expect(result).toBeTruthy();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
