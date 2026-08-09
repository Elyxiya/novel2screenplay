/**
 * Agent 任务人工介入端点
 *
 * POST /api/agent/review
 * 质量关卡重试耗尽进入"等待人工介入"后，由用户决定：
 * - approve: 批准当前阶段输出，继续后续阶段
 * - retry:   重新生成当前阶段
 * - revise:  按用户自由文本建议（instruction）重新生成当前阶段，建议累积到任务指令
 * - discard: 放弃当前阶段，任务终止
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/multi-agent/orchestrator-singleton';
import type { ManualReviewAction } from '@/lib/multi-agent/orchestrator';
import { getCurrentUser, authError } from '@/lib/auth';

const ACTIONS: ManualReviewAction[] = ['approve', 'retry', 'revise', 'discard'];

export async function POST(request: NextRequest) {
  try {
    // 人工介入必须登录
    const user = await getCurrentUser();
    if (!user) return authError();

    const body = (await request.json()) as {
      taskId?: unknown;
      phaseId?: unknown;
      action?: unknown;
      instruction?: unknown;
    };

    const taskId = typeof body.taskId === 'string' ? body.taskId : '';
    const phaseId = typeof body.phaseId === 'string' ? body.phaseId : '';
    const action = body.action as ManualReviewAction | undefined;
    const instruction = typeof body.instruction === 'string' ? body.instruction : '';

    if (!taskId || !phaseId) {
      return NextResponse.json({ error: '缺少 taskId / phaseId' }, { status: 400 });
    }
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action 必须是 ${ACTIONS.join(' | ')} 之一` },
        { status: 400 },
      );
    }
    if (action === 'revise' && !instruction.trim()) {
      return NextResponse.json(
        { error: 'revise 动作必须携带非空 instruction（修改建议）' },
        { status: 400 },
      );
    }

    // 归属校验：他人任务不可介入（旧任务 userId 为空则放行）
    const task = getOrchestrator().getTask(taskId);
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }
    if (task.userId && task.userId !== user.id) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    const ok = getOrchestrator().resolveManualReview(taskId, phaseId, action, instruction);
    if (!ok) {
      return NextResponse.json(
        { error: '任务不存在，或该阶段不在等待人工介入状态' },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, message: `人工介入已处理：${action}` });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
