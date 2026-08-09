/**
 * MultiAgentOrchestrator 进程级单例
 *
 * 供 /api/agent/start（启动/查询）、/api/agent/review（人工介入）与
 * /api/agent/stream/[taskId]（SSE 订阅归属校验）共享同一实例，
 * 保证任务状态在 API 间一致可见。
 *
 * P-记忆：注入 SQLite 持久化适配器，服务重启后自动恢复未完成任务
 * （含人工介入挂起 awaiting 的任务），实现 Agent 任务状态跨进程存活。
 */

import { MultiAgentOrchestrator } from './orchestrator';
import { initializeProviders } from '@/lib/llm/registry';
import { getAgentTaskRepository } from '@/lib/store/sqlite';

let orchestrator: MultiAgentOrchestrator | null = null;

export function getOrchestrator(): MultiAgentOrchestrator {
  initializeProviders();
  if (!orchestrator) {
    orchestrator = new MultiAgentOrchestrator({
      enableReviewGates: true,
      enableAutoRetry: true,
      defaultQualityThreshold: 75,
      persistence: getAgentTaskRepository(),
    });
    // 服务重启：恢复持久化的未完成任务（awaiting 挂起任务等待人工介入，其余自动续跑）
    void orchestrator.restoreFromPersistence();
  }
  return orchestrator;
}
