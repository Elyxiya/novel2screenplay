import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolExecutor } from '../AgentCore';
import type { AgentTool, ToolCall } from '../types';
import { AgentConversationLogger } from './conversation-logger';
import { createLoggingToolExecutor } from './logging-tool-executor';

function createStubExecutor(overrides: Partial<ToolExecutor> = {}): ToolExecutor {
  const tool: AgentTool = {
    name: 'echo',
    description: 'echo back',
    inputSchema: { type: 'object' },
  };
  return {
    async execute(call: ToolCall) {
      return `echo:${JSON.stringify(call.arguments)}`;
    },
    listTools() {
      return [tool];
    },
    ...overrides,
  };
}

describe('createLoggingToolExecutor', () => {
  let logger: AgentConversationLogger;
  let executor: ToolExecutor;

  beforeEach(() => {
    logger = new AgentConversationLogger({ persistToFile: false });
    logger.beginSession('task-1', { phase: 'convert', role: 'converter' });
    executor = createLoggingToolExecutor(createStubExecutor(), logger, {
      taskId: 'task-1',
      phase: 'convert',
      role: 'converter',
    });
  });

  it('execute 记录参数与结果，并透传返回值', async () => {
    const call: ToolCall = { id: 'call-1', name: 'echo', arguments: { text: 'hi' } };
    const result = await executor.execute(call);
    expect(result).toBe('echo:{"text":"hi"}');

    const entries = logger.getSession('task-1')!.entries;
    const calls = entries.filter((e) => e.type === 'tool_call');
    expect(calls).toHaveLength(2); // 请求 + 结果
    expect(calls[0].data.tool).toBe('echo');
    expect(calls[0].data.arguments).toBe('{"text":"hi"}');
    expect(calls[0].data.phase).toBe('convert');
    expect(calls[1].data.success).toBe(true);
    expect(calls[1].data.output).toBe('echo:{"text":"hi"}');
    expect(typeof calls[1].data.durationMs).toBe('number');
  });

  it('execute 失败时记录 error 并重新抛出', async () => {
    const failing = createLoggingToolExecutor(
      createStubExecutor({
        async execute() {
          throw new Error('tool-boom');
        },
      }),
      logger,
      { taskId: 'task-1' },
    );

    await expect(
      failing.execute({ id: 'c', name: 'echo', arguments: {} }),
    ).rejects.toThrow('tool-boom');
    const calls = logger.getSession('task-1')!.entries.filter((e) => e.type === 'tool_call');
    expect(calls.at(-1)!.data.success).toBe(false);
    expect(calls.at(-1)!.data.error).toBe('tool-boom');
  });

  it('listTools 原样透传', () => {
    const tools = executor.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('echo');
  });

  it('超长参数与输出被截断', async () => {
    const big = { text: 'z'.repeat(8000) };
    await executor.execute({ id: 'c', name: 'echo', arguments: big });
    const calls = logger.getSession('task-1')!.entries.filter((e) => e.type === 'tool_call');
    const argText = calls[0].data.arguments as string;
    expect(argText.length).toBeLessThan(2500);
    expect(argText).toContain('已截断');
  });
});
