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
export * from './agent/types';
export * from './agent/state-machine';
export * from './agent/memory';
export * from './agent/tool-types';
export * from './agent/llm';
export {
  AgentCore,
  AgentError,
  type AgentEventListener,
  type LLMProvider,
  type LLMResponse,
  type ToolExecutor,
} from './agent/AgentCore';

// 多 Agent 框架
export * from './multi-agent/roles';
export * from './multi-agent/agent-config';
export * from './multi-agent/registry';
export * from './multi-agent/handoff-protocol';
export * from './multi-agent/handoff-manager';
export * from './multi-agent/review-gate';
export * from './multi-agent/orchestrator';
