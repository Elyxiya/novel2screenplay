/**
 * Agent Framework - Tool Types
 *
 * Defines the tool abstraction used by the Agent framework.
 * Tool implementations (pipeline tools, file tools, etc.) live in the application layer.
 */

import type { AgentTool, ToolCall } from './types';

export type { AgentTool, ToolCall };

/**
 * Result of a tool execution.
 */
export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}
