/**
 * 工具注册表
 *
 * 管理 Agent 可用的所有工具，
 * 支持工具注册、发现、验证和执行。
 */

import type { AgentTool } from '../agent/tool-types';
import type { ToolExecutor } from '../agent/AgentCore';

export interface ToolDefinition {
  /** 工具唯一标识 */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 输入参数 Schema */
  inputSchema: Record<string, unknown>;
  /** 分类 */
  category: ToolCategory;
  /** 标签 */
  tags: string[];
  /** 预估执行时间（毫秒） */
  estimatedDuration?: number;
  /** 预估 token 消耗 */
  estimatedTokens?: number;
  /** 是否启用 */
  enabled: boolean;
  /** 执行函数 */
  handler: ToolHandler;
}

export type ToolCategory =
  | 'pipeline'      // Pipeline 操作
  | 'analysis'     // 分析工具
  | 'conversion'   // 转换工具
  | 'validation'   // 验证工具
  | 'storage'       // 存储工具
  | 'utility';      // 工具函数

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext
) => Promise<unknown>;

export interface ToolContext {
  /** 当前任务 ID */
  taskId: string;
  /** 当前 Agent 角色 */
  agentRole: string;
  /** 用户 ID */
  userId?: string;
  /** 项目 ID */
  projectId?: string;
  /** 额外的上下文数据 */
  metadata?: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  tokensUsed?: number;
}

export interface ToolRegistry {
  /** 注册工具 */
  register(definition: ToolDefinition): void;
  /** 注销工具 */
  unregister(toolId: string): void;
  /** 获取工具 */
  get(toolId: string): ToolDefinition | undefined;
  /** 获取工具列表 */
  list(category?: ToolCategory): ToolDefinition[];
  /** 搜索工具 */
  search(query: string): ToolDefinition[];
  /** 执行工具 */
  execute(toolId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
  /** 获取工具的 AgentTool 格式 */
  toAgentTools(): AgentTool[];
}

class ToolRegistryImpl implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.id)) {
      console.warn(`[ToolRegistry] Tool ${definition.id} already registered, overwriting`);
    }
    this.tools.set(definition.id, definition);
    console.log(`[ToolRegistry] Registered tool: ${definition.id} (${definition.category})`);
  }

  unregister(toolId: string): void {
    this.tools.delete(toolId);
    console.log(`[ToolRegistry] Unregistered tool: ${toolId}`);
  }

  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  list(category?: ToolCategory): ToolDefinition[] {
    const all = Array.from(this.tools.values()).filter((t) => t.enabled);

    if (category) {
      return all.filter((t) => t.category === category);
    }

    return all;
  }

  search(query: string): ToolDefinition[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }

  async execute(
    toolId: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return {
        success: false,
        error: `Tool ${toolId} not found`,
        durationMs: 0,
      };
    }

    if (!tool.enabled) {
      return {
        success: false,
        error: `Tool ${toolId} is disabled`,
        durationMs: 0,
      };
    }

    const t0 = Date.now();

    try {
      const output = await tool.handler(args, context);
      return {
        success: true,
        output,
        durationMs: Date.now() - t0,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - t0,
      };
    }
  }

  toAgentTools(): AgentTool[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      estimatedTokens: tool.estimatedTokens,
    }));
  }
}

// 全局单例
const GLOBAL_KEY = '__novel2screenplay_tool_registry__';

export function getToolRegistry(): ToolRegistry {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new ToolRegistryImpl();
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as ToolRegistry;
  }
  return new ToolRegistryImpl();
}

/**
 * 创建 Agent 执行器包装器
 * @param userId 可选：归属用户 ID，透传给工具执行上下文，使内置工具能解析用户自定义 LLM
 */
export function createToolExecutor(userId?: string): ToolExecutor {
  const registry = getToolRegistry();

  return {
    async execute(call) {
      const result = await registry.execute(
        call.name,
        call.arguments,
        {
          taskId: 'unknown',
          agentRole: 'unknown',
          userId,
        }
      );

      if (!result.success) {
        throw new Error(result.error);
      }

      return result.output;
    },

    listTools() {
      return registry.toAgentTools();
    },
  };
}
