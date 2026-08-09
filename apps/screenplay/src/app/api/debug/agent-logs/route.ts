import { NextResponse } from 'next/server';
import { getAgentDebugLogger } from '@/lib/agent/debug';
import { getCurrentUser, authError } from '@/lib/auth';

/**
 * Agent 调试日志查询 API
 *
 * GET  /api/debug/agent-logs          → 列出全部会话摘要
 * GET  /api/debug/agent-logs?taskId=x → 返回单个会话完整日志
 * DELETE /api/debug/agent-logs        → 清空内存日志
 */
export async function GET(request: Request): Promise<NextResponse> {
  // 调试日志查询必须登录
  const user = await getCurrentUser();
  if (!user) return authError();

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');

  const logger = getAgentDebugLogger();

  if (taskId) {
    const session = logger.getSession(taskId);
    if (!session) {
      return NextResponse.json({ error: '会话不存在', taskId }, { status: 404 });
    }
    return NextResponse.json({ session });
  }

  const sessions = logger.listSessions().map((s) => ({
    taskId: s.taskId,
    meta: s.meta,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    entryCount: s.entries.length,
  }));
  return NextResponse.json({ sessions });
}

export async function DELETE(): Promise<NextResponse> {
  // 清空调试日志必须登录
  const user = await getCurrentUser();
  if (!user) return authError();

  getAgentDebugLogger().clear();
  return NextResponse.json({ ok: true });
}
