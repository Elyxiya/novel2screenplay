/**
 * Agent 配置
 *
 * 定义每个角色 Agent 的配置信息。
 */

import type { AgentRole } from './roles';
import type { AgentTool } from '../agent';

export interface AgentConfig {
  /** Agent 唯一标识 */
  id: string;
  /** Agent 角色 */
  role: AgentRole;
  /** Agent 名称 */
  name: string;
  /** Agent 描述 */
  description: string;
  /** LLM 模型 ID */
  modelId: string;
  /** 温度参数 */
  temperature: number;
  /** 最大 token 数 */
  maxTokens: number;
  /** 最大总 token 预算 */
  maxTotalTokens: number;
  /** 最大执行步骤 */
  maxSteps: number;
  /** 是否启用详细日志 */
  verbose: boolean;
  /** 可用工具 */
  tools: AgentTool[];
  /** 系统提示词 */
  systemPrompt: string;
}

export interface AgentInstance {
  /** 实例唯一标识 */
  instanceId: string;
  /** 配置 */
  config: AgentConfig;
  /** 当前状态 */
  status: 'idle' | 'busy' | 'error' | 'offline';
  /** 当前任务 ID */
  currentTaskId: string | null;
  /** 最后活动时间 */
  lastActiveAt: number;
  /** 已完成任务数 */
  completedTasks: number;
  /** 总 token 消耗 */
  totalTokenUsage: number;
}

/**
 * 创建默认 Agent 配置
 */
export function createDefaultAgentConfig(role: AgentRole, overrides?: Partial<AgentConfig>): AgentConfig {
  const baseConfig: Record<AgentRole, Omit<AgentConfig, 'id' | 'name'>> = {
    supervisor: {
      role: 'supervisor',
      description: '协调剧本转换流程的监督者',
      modelId: process.env.DEFAULT_MODEL_ID || 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 2048,
      maxTotalTokens: 100000,
      maxSteps: 50,
      verbose: true,
      tools: [],
      systemPrompt: '',
    },
    writer: {
      role: 'writer',
      description: '将小说转换为剧本格式的编剧',
      modelId: process.env.DEFAULT_MODEL_ID || 'deepseek-chat',
      temperature: 0.7,
      maxTokens: 4096,
      maxTotalTokens: 200000,
      maxSteps: 30,
      verbose: true,
      tools: [],
      systemPrompt: '',
    },
    editor: {
      role: 'editor',
      description: '润色和修正剧本的编辑',
      modelId: process.env.DEFAULT_MODEL_ID || 'deepseek-chat',
      temperature: 0.5,
      maxTokens: 4096,
      maxTotalTokens: 150000,
      maxSteps: 20,
      verbose: true,
      tools: [],
      systemPrompt: '',
    },
    analyzer: {
      role: 'analyzer',
      description: '分析小说提取角色和场景的分析者',
      modelId: process.env.DEFAULT_MODEL_ID || 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 4096,
      maxTotalTokens: 100000,
      maxSteps: 20,
      verbose: true,
      tools: [],
      systemPrompt: '',
    },
    validator: {
      role: 'validator',
      description: '验证剧本质量的审核员',
      modelId: process.env.DEFAULT_MODEL_ID || 'deepseek-chat',
      temperature: 0.2,
      maxTokens: 2048,
      maxTotalTokens: 50000,
      maxSteps: 10,
      verbose: true,
      tools: [],
      systemPrompt: '',
    },
  };

  const base = baseConfig[role];

  return {
    id: `agent_${role}_${Date.now()}`,
    name: getRoleName(role),
    ...base,
    ...overrides,
  };
}

function getRoleName(role: AgentRole): string {
  const names: Record<AgentRole, string> = {
    supervisor: '监督者',
    writer: '编剧',
    editor: '编辑',
    analyzer: '分析者',
    validator: '验证者',
  };
  return names[role];
}
