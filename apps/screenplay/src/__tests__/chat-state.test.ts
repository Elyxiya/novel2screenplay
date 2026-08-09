// @vitest-environment node
/**
 * agent-chat reducer：SSE 事件 → UI 状态映射纯函数测试
 */
import { describe, it, expect } from 'vitest';
import { initialState, agentChatReducer, AgentChatEvent } from '@/lib/agent-chat/chat-state';

const evt = (e: AgentChatEvent) => agentChatReducer(initialState, e);

describe('agentChatReducer', () => {
  it('task_start：置 running/started 并记录 taskId', () => {
    const s = evt({ event: 'task_start', taskId: 't1' });
    expect(s.taskId).toBe('t1');
    expect(s.running).toBe(true);
    expect(s.started).toBe(true);
  });

  it('task_start 重置上一次的 summary/error', () => {
    let s = evt({ event: 'task_start', taskId: 't1' });
    s = agentChatReducer(s, { event: 'phase_start', taskId: 't1', phaseId: 'p1', name: 'analyze' });
    s = agentChatReducer(s, { event: 'task_complete', taskId: 't1', success: true, durationMs: 100, phases: [] });
    expect(s.summary).not.toBeNull();

    s = agentChatReducer(s, { event: 'task_start', taskId: 't2' });
    expect(s.summary).toBeNull();
    expect(s.error).toBeNull();
  });

  it('phase_start：新增或更新阶段为 running', () => {
    let s = evt({ event: 'task_start', taskId: 't1' });
    s = agentChatReducer(s, { event: 'phase_start', taskId: 't1', phaseId: 'p1', name: 'analyze' });
    expect(s.phases).toHaveLength(1);
    expect(s.phases[0]).toMatchObject({ id: 'p1', name: 'analyze', status: 'running' });
  });

  it('phase_complete：阶段置 completed', () => {
    let s = evt({ event: 'task_start', taskId: 't1' });
    s = agentChatReducer(s, { event: 'phase_start', taskId: 't1', phaseId: 'p1', name: 'analyze' });
    s = agentChatReducer(s, { event: 'phase_complete', taskId: 't1', phaseId: 'p1', name: 'analyze' });
    expect(s.phases[0].status).toBe('completed');
  });

  it('phase_failed：阶段置 failed 并记录错误', () => {
    let s = evt({ event: 'task_start', taskId: 't1' });
    s = agentChatReducer(s, { event: 'phase_start', taskId: 't1', phaseId: 'p1', name: 'analyze' });
    s = agentChatReducer(s, { event: 'phase_failed', taskId: 't1', phaseId: 'p1', name: 'analyze', error: 'LLM 超时' });
    expect(s.phases[0].status).toBe('failed');
    expect(s.phases[0].error).toBe('LLM 超时');
  });

  it('gate_result：附加到对应阶段（不改变状态）', () => {
    let s = evt({ event: 'task_start', taskId: 't1' });
    s = agentChatReducer(s, { event: 'phase_start', taskId: 't1', phaseId: 'p1', name: 'analyze' });
    s = agentChatReducer(s, {
      event: 'gate_result', taskId: 't1', phaseId: 'p1',
      gate: { decision: 'pass', reason: '质量达标' },
    });
    expect(s.phases[0].status).toBe('running'); // 状态不变
    expect(s.phases[0].gate).toEqual({ decision: 'pass', reason: '质量达标' });
  });

  it('log：追加日志条目', () => {
    let s = evt({ event: 'task_start', taskId: 't1' });
    s = agentChatReducer(s, { event: 'log', taskId: 't1', level: 'info', message: '开始分析' });
    s = agentChatReducer(s, { event: 'log', taskId: 't1', message: '无 level' });
    expect(s.logs).toHaveLength(2);
    expect(s.logs[0]).toMatchObject({ level: 'info', message: '开始分析' });
    expect(s.logs[1].level).toBe('info'); // 缺省 level 兜底
  });

  it('task_complete 成功：置 summary、停止 running', () => {
    let s = evt({ event: 'task_start', taskId: 't1' });
    s = agentChatReducer(s, {
      event: 'task_complete', taskId: 't1', success: true, durationMs: 5000,
      phases: [{ id: 'p1', name: 'analyze', status: 'completed' }],
    });
    expect(s.running).toBe(false);
    expect(s.summary).toEqual({
      success: true, durationMs: 5000,
      phases: [{ id: 'p1', name: 'analyze', status: 'completed' }],
    });
  });

  it('task_complete 失败：置 summary + error', () => {
    let s = evt({ event: 'task_start', taskId: 't1' });
    s = agentChatReducer(s, { event: 'phase_failed', taskId: 't1', phaseId: 'p1', name: 'convert', error: '质量未达标' });
    s = agentChatReducer(s, {
      event: 'task_complete', taskId: 't1', success: false, durationMs: 3000, phases: [],
    });
    expect(s.running).toBe(false);
    expect(s.summary?.success).toBe(false);
    expect(s.error).toBeTruthy();
  });

  it('task_complete 无 phases 时回退到当前阶段快照', () => {
    let s = evt({ event: 'task_start', taskId: 't1' });
    s = agentChatReducer(s, { event: 'phase_start', taskId: 't1', phaseId: 'p1', name: 'segment' });
    s = agentChatReducer(s, { event: 'task_complete', taskId: 't1', success: true, durationMs: 100, phases: [] });
    expect(s.summary?.phases).toEqual([{ id: 'p1', name: 'segment', status: 'running' }]);
  });
});
