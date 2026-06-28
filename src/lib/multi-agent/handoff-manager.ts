/**
 * Handoff Manager - 交接管理器
 *
 * 实现 HandoffProtocol 接口，
 * 管理所有 Agent 之间的任务交接。
 */

import type {
  HandoffProtocol,
  HandoffContext,
  HandoffRequest,
  HandoffResult,
  HandoffOptions,
  HandoffPayload,
} from './handoff-protocol';
import {
  createHandoffContext,
  validateHandoffRequest,
} from './handoff-protocol';
import { getAgentRegistry } from './registry';

class HandoffManager implements HandoffProtocol {
  private handoffs = new Map<string, HandoffContext>();
  private taskHandoffs = new Map<string, Set<string>>();
  private pendingHandoffs = new Map<string, Set<string>>(); // 按目标 Agent 索引

  /**
   * 请求交接
   */
  async requestHandoff(request: HandoffRequest): Promise<HandoffResult> {
    // 验证请求
    const validation = validateHandoffRequest(request);
    if (!validation.valid) {
      return {
        success: false,
        handoff: {} as HandoffContext,
        accepted: false,
        message: validation.error,
      };
    }

    const registry = getAgentRegistry();
    const handoffId = `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 查找可用的目标 Agent
    let targetInstanceId: string;
    if (request.toInstanceId) {
      targetInstanceId = request.toInstanceId;
    } else {
      const available = registry.getAvailableByRole(request.toRole);
      if (available.length === 0) {
        const allOfRole = registry.getByRole(request.toRole);
        if (allOfRole.length > 0) {
          targetInstanceId = allOfRole[0].instanceId;
        } else {
          return {
            success: false,
            handoff: {} as HandoffContext,
            accepted: false,
            message: `没有可用的 ${request.toRole} Agent`,
          };
        }
      } else {
        targetInstanceId = available[0].instanceId;
      }
    }

    // 创建交接上下文
    const handoff = createHandoffContext(
      request.fromRole,
      request.fromInstanceId,
      request.toRole,
      request.taskId,
      request.reason,
      request.payload,
    );
    handoff.toInstanceId = targetInstanceId;

    // 存储交接
    this.handoffs.set(handoffId, handoff);
    this.indexHandoff(handoffId, handoff);

    console.log(`[Handoff] Requested: ${handoffId} (${request.fromRole} → ${request.toRole})`);

    // 自动接受交接
    handoff.status = 'in_progress';
    registry.markBusy(targetInstanceId, request.taskId);

    return {
      success: true,
      handoff,
      accepted: true,
      message: '交接已接受',
    };
  }

  /**
   * 接受交接
   */
  async acceptHandoff(handoffId: string): Promise<void> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      throw new Error(`交接 ${handoffId} 不存在`);
    }

    if (handoff.status !== 'pending') {
      throw new Error(`交接状态 ${handoff.status} 不允许接受`);
    }

    handoff.status = 'in_progress';
    console.log(`[Handoff] Accepted: ${handoffId}`);
  }

  /**
   * 拒绝交接
   */
  async rejectHandoff(handoffId: string, reason: string): Promise<void> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      throw new Error(`交接 ${handoffId} 不存在`);
    }

    handoff.status = 'failed';
    handoff.error = reason;
    handoff.completedAt = Date.now();

    console.log(`[Handoff] Rejected: ${handoffId} - ${reason}`);
  }

  /**
   * 完成交接
   */
  async completeHandoff(handoffId: string, result: HandoffPayload): Promise<void> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      throw new Error(`交接 ${handoffId} 不存在`);
    }

    // 合并结果到 payload
    handoff.payload = {
      ...handoff.payload,
      ...result,
    };
    handoff.status = 'completed';
    handoff.completedAt = Date.now();

    // 标记源 Agent 空闲
    const registry = getAgentRegistry();
    if (handoff.fromInstanceId) {
      registry.markIdle(handoff.fromInstanceId);
    }

    console.log(`[Handoff] Completed: ${handoffId}`);
  }

  /**
   * 取消交接
   */
  async cancelHandoff(handoffId: string): Promise<void> {
    const handoff = this.handoffs.get(handoffId);
    if (!handoff) {
      throw new Error(`交接 ${handoffId} 不存在`);
    }

    handoff.status = 'cancelled';
    handoff.completedAt = Date.now();

    // 释放目标 Agent
    if (handoff.toInstanceId) {
      const registry = getAgentRegistry();
      registry.markIdle(handoff.toInstanceId);
    }

    console.log(`[Handoff] Cancelled: ${handoffId}`);
  }

  /**
   * 获取交接状态
   */
  getHandoff(handoffId: string): HandoffContext | undefined {
    return this.handoffs.get(handoffId);
  }

  /**
   * 获取任务的所有交接历史
   */
  getHandoffsForTask(taskId: string): HandoffContext[] {
    const handoffIds = this.taskHandoffs.get(taskId);
    if (!handoffIds) return [];

    return Array.from(handoffIds)
      .map((id) => this.handoffs.get(id))
      .filter((h): h is HandoffContext => h !== undefined)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 获取待处理的交接
   */
  getPendingHandoffs(forRole?: string): HandoffContext[] {
    if (!forRole) {
      return Array.from(this.handoffs.values()).filter((h) => h.status === 'pending');
    }

    const pendingIds = this.pendingHandoffs.get(forRole);
    if (!pendingIds) return [];

    return Array.from(pendingIds)
      .map((id) => this.handoffs.get(id))
      .filter((h): h is HandoffContext => h !== undefined && h.status === 'pending');
  }

  /**
   * 索引交接以便快速查询
   */
  private indexHandoff(handoffId: string, handoff: HandoffContext): void {
    // 按任务索引
    if (!this.taskHandoffs.has(handoff.taskId)) {
      this.taskHandoffs.set(handoff.taskId, new Set());
    }
    this.taskHandoffs.get(handoff.taskId)!.add(handoffId);

    // 按目标角色索引
    if (!this.pendingHandoffs.has(handoff.toRole)) {
      this.pendingHandoffs.set(handoff.toRole, new Set());
    }
    this.pendingHandoffs.get(handoff.toRole)!.add(handoffId);
  }
}

// 全局单例
const GLOBAL_KEY = '__novel2screenplay_handoff_manager__';

export function getHandoffManager(): HandoffProtocol {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new HandoffManager();
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as HandoffProtocol;
  }
  return new HandoffManager();
}
