/**
 * Agent Registry - 角色 Agent 注册表
 *
 * 管理系统中所有角色的 Agent 实例，
 * 提供创建、获取、监控 Agent 的功能。
 */

import type { AgentInstance } from './agent-config';
import type { AgentRole } from './roles';
import { createDefaultAgentConfig } from './agent-config';

export interface RegistryStats {
  totalAgents: number;
  idleAgents: number;
  busyAgents: number;
  errorAgents: number;
  offlineAgents: number;
}

export interface AgentRegistry {
  /** 注册一个 Agent 实例 */
  register(instance: AgentInstance): void;
  /** 注销一个 Agent 实例 */
  unregister(instanceId: string): void;
  /** 获取指定实例 */
  get(instanceId: string): AgentInstance | undefined;
  /** 获取指定角色的所有实例 */
  getByRole(role: AgentRole): AgentInstance[];
  /** 获取指定角色的空闲实例 */
  getAvailableByRole(role: AgentRole): AgentInstance[];
  /** 标记实例为忙碌 */
  markBusy(instanceId: string, taskId: string): void;
  /** 标记实例为空闲 */
  markIdle(instanceId: string): void;
  /** 标记实例为错误 */
  markError(instanceId: string): void;
  /** 标记实例为离线 */
  markOffline(instanceId: string): void;
  /** 获取统计信息 */
  getStats(): RegistryStats;
  /** 创建指定角色的新实例 */
  createAgent(role: AgentRole): AgentInstance;
  /** 列出所有实例 */
  listAll(): AgentInstance[];
}

class AgentRegistryImpl implements AgentRegistry {
  private agents = new Map<string, AgentInstance>();

  register(instance: AgentInstance): void {
    this.agents.set(instance.instanceId, instance);
    console.log(`[Registry] Agent registered: ${instance.instanceId} (${instance.config.role})`);
  }

  unregister(instanceId: string): void {
    const agent = this.agents.get(instanceId);
    if (agent) {
      this.agents.delete(instanceId);
      console.log(`[Registry] Agent unregistered: ${instanceId}`);
    }
  }

  get(instanceId: string): AgentInstance | undefined {
    return this.agents.get(instanceId);
  }

  getByRole(role: AgentRole): AgentInstance[] {
    return Array.from(this.agents.values()).filter((a) => a.config.role === role);
  }

  getAvailableByRole(role: AgentRole): AgentInstance[] {
    return this.getByRole(role).filter((a) => a.status === 'idle');
  }

  markBusy(instanceId: string, taskId: string): void {
    const agent = this.agents.get(instanceId);
    if (agent) {
      agent.status = 'busy';
      agent.currentTaskId = taskId;
      agent.lastActiveAt = Date.now();
      console.log(`[Registry] Agent ${instanceId} marked busy for task ${taskId}`);
    }
  }

  markIdle(instanceId: string): void {
    const agent = this.agents.get(instanceId);
    if (agent) {
      agent.status = 'idle';
      agent.currentTaskId = null;
      agent.lastActiveAt = Date.now();
      agent.completedTasks++;
      console.log(`[Registry] Agent ${instanceId} marked idle`);
    }
  }

  markError(instanceId: string): void {
    const agent = this.agents.get(instanceId);
    if (agent) {
      agent.status = 'error';
      agent.lastActiveAt = Date.now();
      console.log(`[Registry] Agent ${instanceId} marked error`);
    }
  }

  markOffline(instanceId: string): void {
    const agent = this.agents.get(instanceId);
    if (agent) {
      agent.status = 'offline';
      console.log(`[Registry] Agent ${instanceId} marked offline`);
    }
  }

  getStats(): RegistryStats {
    const agents = Array.from(this.agents.values());
    return {
      totalAgents: agents.length,
      idleAgents: agents.filter((a) => a.status === 'idle').length,
      busyAgents: agents.filter((a) => a.status === 'busy').length,
      errorAgents: agents.filter((a) => a.status === 'error').length,
      offlineAgents: agents.filter((a) => a.status === 'offline').length,
    };
  }

  createAgent(role: AgentRole): AgentInstance {
    const instanceId = `agent_${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const config = createDefaultAgentConfig(role, { id: instanceId });

    const instance: AgentInstance = {
      instanceId,
      config,
      status: 'idle',
      currentTaskId: null,
      lastActiveAt: Date.now(),
      completedTasks: 0,
      totalTokenUsage: 0,
    };

    this.register(instance);
    return instance;
  }

  listAll(): AgentInstance[] {
    return Array.from(this.agents.values());
  }
}

// 全局单例
const GLOBAL_KEY = '__novel2screenplay_agent_registry__';

export function getAgentRegistry(): AgentRegistry {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new AgentRegistryImpl();
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as AgentRegistry;
  }
  return new AgentRegistryImpl();
}

/**
 * 初始化默认 Agent 池
 *
 * 创建系统所需的默认 Agent 实例。
 */
export function initializeDefaultAgents(): AgentRegistry {
  const registry = getAgentRegistry();

  // 初始化各角色的默认实例
  const roles: AgentRole[] = ['supervisor', 'analyzer', 'writer', 'editor', 'validator'];

  for (const role of roles) {
    // 每个角色创建一个默认实例
    registry.createAgent(role);
  }

  console.log('[Registry] Default agents initialized:', registry.getStats());
  return registry;
}
