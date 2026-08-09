/**
 * Job Detail API Endpoint
 *
 * DELETE /api/jobs/[id] - 删除 SQLite 持久化任务记录（历史页清理）
 *
 * 说明（p1-2 收敛）：内存队列（/api/jobs）已标记预留，此处仅保留
 * 历史页实际使用的 DELETE；GET 与 SSE（/events）随死组件一并移除。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJobRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// DELETE /api/jobs/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const { id } = await params;
  const repo = getJobRepository();
  const stored = repo.get(id);

  if (!stored) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (stored.userId !== user.id) return authError('无权操作该任务', 403);

  repo.delete(id);

  return NextResponse.json({ success: true, jobId: id });
}
