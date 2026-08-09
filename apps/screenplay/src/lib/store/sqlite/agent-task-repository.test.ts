// @vitest-environment node
/**
 * AgentTaskRepository 单元测试（P-记忆）
 *
 * 覆盖：upsert / get 往返还原、终态标记、loadActive 过滤、覆盖更新、删除、user_id 隔离列。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase } from './db';
import { getAgentTaskRepository } from './agent-task-repository';
import type { OrchestratorTask } from '../../multi-agent/orchestrator';

function makeTask(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  const base: OrchestratorTask = {
    id: 'task-test-' + Math.random().toString(36).slice(2, 10),
    input: '测试小说',
    phaseCount: 2,
    phases: [
      {
        id: 'p-analyze',
        name: 'analyze',
        description: '分析小说',
        role: 'analyzer',
        status: 'completed',
        retryCount: 0,
        output: { agentResult: '分析结果' },
        startedAt: 1,
        completedAt: 2,
      },
      {
        id: 'p-merge',
        name: 'merge',
        description: '合并校验',
        role: 'editor',
        status: 'awaiting',
        retryCount: 1,
        error: '质量未达标（待人工介入）',
      },
    ],
    awaiting: {
      phaseId: 'p-merge',
      phaseName: 'merge',
      reason: 'merge 质量未达标',
      decision: 'fail',
    },
    ...overrides,
  };
  return base;
}

describe('AgentTaskRepository', () => {
  const repo = getAgentTaskRepository();

  beforeEach(() => {
    const db = getDatabase();
    db.exec('DELETE FROM agent_tasks');
  });

  it('upsert 后 get 往返还原（含 phases 状态机 / awaiting / 阶段产物）', () => {
    const task = makeTask();
    repo.upsert(task);

    const record = repo.get(task.id);
    expect(record).not.toBeNull();
    expect(record?.status).toBe('active');
    expect(record?.task.id).toBe(task.id);
    expect(record?.task.phases).toHaveLength(2);
    expect(record?.task.phases.find((p) => p.name === 'merge')?.status).toBe('awaiting');
    expect(record?.task.awaiting?.phaseName).toBe('merge');
    expect(record?.task.phases[0].output).toEqual({ agentResult: '分析结果' });
  });

  it('记录 user_id（p1-4 数据隔离字段）', () => {
    const task = makeTask({ userId: 'user-42' });
    repo.upsert(task);

    const row = getDatabase()
      .prepare('SELECT user_id FROM agent_tasks WHERE id = ?')
      .get(task.id) as { user_id: string };
    expect(row.user_id).toBe('user-42');
  });

  it('终态标记写入 completed_at，且不再被 loadActive 返回', () => {
    const task = makeTask();
    repo.upsert(task, 'active');
    repo.upsert(task, 'completed');

    const record = repo.get(task.id);
    expect(record?.status).toBe('completed');
    expect(record?.completedAt).toBeGreaterThan(0);
    expect(repo.loadActive().some((r) => r.task.id === task.id)).toBe(false);
  });

  it('覆盖更新：同一 taskId 再次 upsert 全量替换', () => {
    const task = makeTask();
    repo.upsert(task);
    const updated = makeTask({
      id: task.id,
      title: '更新后的标题',
      awaiting: undefined,
      phases: task.phases.map((p) =>
        p.id === 'p-merge' ? { ...p, status: 'completed' as const, retryCount: 2 } : p,
      ),
    });
    repo.upsert(updated);

    const record = repo.get(task.id);
    expect(record?.task.title).toBe('更新后的标题');
    expect(record?.task.awaiting).toBeUndefined();
    expect(record?.task.phases.find((p) => p.name === 'merge')?.status).toBe('completed');
    expect(record?.task.phases.find((p) => p.name === 'merge')?.retryCount).toBe(2);
  });

  it('loadActive 按创建时间升序返回，且过滤终态记录', () => {
    const t1 = makeTask();
    const t2 = makeTask();
    const t3 = makeTask();
    repo.upsert(t1, 'active');
    repo.upsert(t2, 'active');
    repo.upsert(t3, 'completed');

    const active = repo.loadActive();
    expect(active).toHaveLength(2);
    expect(active.map((r) => r.task.id)).toEqual([t1.id, t2.id]);
  });

  it('delete 删除记录', () => {
    const task = makeTask();
    repo.upsert(task);
    repo.delete(task.id);
    expect(repo.get(task.id)).toBeNull();
  });
});
