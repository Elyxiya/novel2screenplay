/**
 * Agent 任务人工介入端点
 *
 * POST /api/agent/review
 * 质量关卡重试耗尽进入"等待人工介入"后，由用户决定：
 * - approve: 批准当前阶段输出，继续后续阶段
 * - retry:   重新生成当前阶段
 * - discard: 放弃当前阶段，任务终止
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/multi-agent/orchestrator-singleton';

const ACTIONS = ['approve', 'retry', 'discard'] as const;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      taskId?: unknown;
      phaseId?: unknown;
      action?: unknown;
    };

    const taskId = typeof body.taskId === 'string' ? body.taskId : '';
    const phaseId = typeof body.phaseId === 'string' ? body.phaseId : '';
    const action = body.action as (typeof ACTIONS)[number] | undefined;

    if (!taskId || !phaseId) {
      return NextResponse.json({ error: '缺少 taskId / phaseId' }, { status: 400 });
    }
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action 必须是 ${ACTIONS.join(' | ')} 之一` },
        { status: 400 },
      );
    }

    const ok = getOrchestrator().resolveManualReview(taskId, phaseId, action);
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
