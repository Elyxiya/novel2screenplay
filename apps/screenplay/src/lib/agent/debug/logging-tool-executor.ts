/**
 * Agent 调试日志 - ToolExecutor 包装器
 *
 * 包装 AgentCore 所需的 ToolExecutor 接口，
 * 记录每次工具调用的参数、结果摘要与耗时。
 */

import type { ToolExecutor } from '../AgentCore';
import type { AgentTool } from '../tool-types';
import type { ToolCall } from '../types';
import { AgentConversationLogger, safeStringify, isDebugEnabled } from './conversation-logger';

export interface LoggingToolContext {
  taskId: string;
  phase?: string;
  role?: string;
}

/**
 * 包装 ToolExecutor，记录工具调用日志。
 * 当 isDebugEnabled() 为 false 时零开销透传。
 */
export function createLoggingToolExecutor(
  inner: ToolExecutor,
  logger: AgentConversationLogger,
  ctx: LoggingToolContext,
): ToolExecutor {
  return {
    async execute(call: ToolCall, signal?: AbortSignal): Promise<unknown> {
      const maxLen = logger.maxLength;
      if (isDebugEnabled()) {
        logger.append(ctx.taskId, {
          type: 'tool_call',
          level: 'info',
          data: {
            tool: call.name,
            phase: ctx.phase,
            role: ctx.role,
            arguments: safeStringify(call.arguments, maxLen),
            callId: call.id,
          },
        });
      }

      const t0 = Date.now();
      try {
        const result = await inner.execute(call, signal);
        if (isDebugEnabled()) {
          logger.append(ctx.taskId, {
            type: 'tool_call',
            level: 'debug',
            data: {
              tool: call.name,
              success: true,
              output: safeStringify(result, maxLen),
              durationMs: Date.now() - t0,
              callId: call.id,
            },
          });
        }
        return result;
      } catch (err) {
        if (isDebugEnabled()) {
          logger.append(ctx.taskId, {
            type: 'tool_call',
            level: 'error',
            data: {
              tool: call.name,
              success: false,
              error: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - t0,
              callId: call.id,
            },
          });
        }
        throw err;
      }
    },

    listTools(): AgentTool[] {
      return inner.listTools();
    },
  };
}
