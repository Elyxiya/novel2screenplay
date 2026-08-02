/**
 * Agent Framework - Public API
 *
 * Barrel export for all agent framework modules.
 *
 * 包含两个框架：
 * - 单 Agent 框架：src/lib/agent/ - 适用于简单任务
 * - 多 Agent 框架：src/lib/multi-agent/ - 适用于复杂任务编排
 */

// 单 Agent 框架
export * from './types';
export * from './state-machine';
export * from './memory';
export * from './tool-types';
export * from './llm';
export {
  AgentCore,
  AgentError,
  type AgentEventListener,
  type LLMProvider,
  type LLMResponse,
  type ToolExecutor,
} from './AgentCore';
