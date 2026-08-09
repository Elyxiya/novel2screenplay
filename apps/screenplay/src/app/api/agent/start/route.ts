import { NextRequest, NextResponse } from 'next/server';
import { getOrchestrator } from '@/lib/multi-agent/orchestrator-singleton';
import { getCurrentUser, authError } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // 启动 Agent 任务必须登录
    const user = await getCurrentUser();
    if (!user) return authError();

    const { novelText, title, author, instruction } = await request.json();
    if (!novelText) return NextResponse.json({ error: '缺少 novelText' }, { status: 400 });

    const taskId = getOrchestrator().startConversion({
      novelText,
      title,
      author,
      instruction,
      userId: user.id,
    });

    return NextResponse.json({ taskId, message: 'Agent 编排任务已启动' });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // 查询任务状态必须登录
    const user = await getCurrentUser();
    if (!user) return authError();

    const taskId = request.nextUrl.searchParams.get('taskId');
    if (!taskId) return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });

    const task = getOrchestrator().getTask(taskId);
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    // 归属校验：任务属于他人时不可见（旧任务 userId 为空则放行）
    if (task.userId && task.userId !== user.id) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }

    return NextResponse.json({
      taskId: task.id,
      phases: task.phases.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        status: p.status,
        retryCount: p.retryCount,
        error: p.error,
      })),
      completed: task.phases.every((p) => p.status === 'completed'),
      failed: task.phases.some((p) => p.status === 'failed'),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
