/**
 * MultiAgentOrchestrator 进程级单例
 *
 * 供 /api/agent/start（启动/查询）与 /api/agent/review（人工介入）共享同一实例，
 * 保证任务状态在 API 间一致可见。
 */

import { MultiAgentOrchestrator } from './orchestrator';
import { initializeProviders } from '@/lib/llm/registry';

let orchestrator: MultiAgentOrchestrator | null = null;

export function getOrchestrator(): MultiAgentOrchestrator {
  initializeProviders();
  if (!orchestrator) {
    orchestrator = new MultiAgentOrchestrator({
      enableReviewGates: true,
      enableAutoRetry: true,
      defaultQualityThreshold: 75,
    });
  }
  return orchestrator;
}
