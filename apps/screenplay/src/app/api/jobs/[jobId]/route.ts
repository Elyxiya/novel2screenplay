/**
 * Job Detail API Endpoint
 *
 * DELETE /api/jobs/[jobId] - 删除 SQLite 持久化任务记录（历史页清理）
 *
 * 说明（p1-2 收敛）：内存队列（/api/jobs）已标记预留，此处仅保留
 * 历史页实际使用的 DELETE；GET 与 SSE（/events）随死组件一并移除。
 *
 * 目录名由 [id] 改为 [jobId]（B-03）：同一父级 api/jobs 下不允许出现
 * 两个不同的动态段名（[jobId]/card-edit 与 [id] 冲突，会导致 dev/build 启动失败）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJobRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

// DELETE /api/jobs/[jobId]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const { jobId } = await params;
  const repo = getJobRepository();
  const stored = repo.get(jobId);

  if (!stored) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (stored.userId !== user.id) return authError('无权操作该任务', 403);

  repo.delete(jobId);

  return NextResponse.json({ success: true, jobId });
}
