/**
 * Agent Task Repository - Agent 编排任务持久化（P-记忆）
 *
 * MultiAgentOrchestrator.tasks（内存 Map）的 SQLite 持久化镜像：
 * - 任务创建 / 状态变更时 upsert 全量 OrchestratorTask JSON
 * - 服务重启后 loadActive() 恢复未完成任务（含人工介入挂起 awaiting 的任务）
 * - 任务终态（completed / failed）标记保留，供审计与查询
 */

import { getEngine } from '@novel/db';
import type { OrchestratorTask } from '../../multi-agent/orchestrator';

export type AgentTaskStatus = 'active' | 'completed' | 'failed';

export interface AgentTaskRow {
  id: string;
  status: string;
  user_id: string | null;
  task_json: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface AgentTaskRecord {
  task: OrchestratorTask;
  status: AgentTaskStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface AgentTaskRepository {
  /** 全量保存任务状态（存在则覆盖，status 默认 active） */
  upsert(task: OrchestratorTask, status?: AgentTaskStatus): void;
  /** 获取单条任务记录 */
  get(taskId: string): AgentTaskRecord | null;
  /** 恢复所有未完成任务（status='active'，按创建时间升序保证恢复顺序稳定） */
  loadActive(): AgentTaskRecord[];
  /** 删除任务记录 */
  delete(taskId: string): void;
}

class AgentTaskRepositoryImpl implements AgentTaskRepository {
  upsert(task: OrchestratorTask, status: AgentTaskStatus = 'active'): void {
    const db = getEngine();
    const now = Date.now();
    const taskJson = JSON.stringify(task);
    const completedAt = status === 'active' ? null : now;

    db.prepare(`
      INSERT INTO agent_tasks (id, status, user_id, task_json, created_at, updated_at, completed_at)
      VALUES (@id, @status, @userId, @taskJson, @createdAt, @updatedAt, @completedAt)
      ON CONFLICT(id) DO UPDATE SET
        status = @status,
        task_json = @taskJson,
        user_id = @userId,
        updated_at = @updatedAt,
        completed_at = @completedAt
    `).run({
      id: task.id,
      status,
      userId: task.userId ?? null,
      taskJson,
      createdAt: now,
      updatedAt: now,
      completedAt,
    });
  }

  get(taskId: string): AgentTaskRecord | null {
    const db = getEngine();
    const row = db
      .prepare('SELECT * FROM agent_tasks WHERE id = ?')
      .get(taskId) as AgentTaskRow | undefined;
    if (!row) return null;
    return this.rowToRecord(row);
  }

  loadActive(): AgentTaskRecord[] {
    const db = getEngine();
    const rows = db
      .prepare(`SELECT * FROM agent_tasks WHERE status = 'active' ORDER BY created_at ASC`)
      .all() as AgentTaskRow[];
    return rows.map((r) => this.rowToRecord(r));
  }

  delete(taskId: string): void {
    const db = getEngine();
    db.prepare('DELETE FROM agent_tasks WHERE id = ?').run(taskId);
  }

  private rowToRecord(row: AgentTaskRow): AgentTaskRecord {
    return {
      task: JSON.parse(row.task_json) as OrchestratorTask,
      status: row.status as AgentTaskStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
    };
  }
}

// 单例导出
let repository: AgentTaskRepository | null = null;

export function getAgentTaskRepository(): AgentTaskRepository {
  if (!repository) {
    repository = new AgentTaskRepositoryImpl();
  }
  return repository;
}
