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
    // 归属校验：会话属于他人时不可见（旧会话 userId 为空则放行）
    if (session.meta.userId && session.meta.userId !== user.id) {
      return NextResponse.json({ error: '会话不存在', taskId }, { status: 404 });
    }
    return NextResponse.json({ session });
  }

  // 仅列出当前用户的会话（旧会话无 userId，不可见）
  const sessions = logger
    .listSessions()
    .filter((s) => s.meta.userId === user.id)
    .map((s) => ({
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

  // 仅清理当前用户的会话（多用户数据隔离）
  getAgentDebugLogger().clearByUserId(user.id);
  return NextResponse.json({ ok: true });
}
