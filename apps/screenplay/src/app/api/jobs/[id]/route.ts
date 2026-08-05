/**
 * Job Detail API Endpoint
 *
 * GET /api/jobs/[id] - 获取任务详情
 * DELETE /api/jobs/[id] - 取消任务并删除持久化记录
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/jobs';
import { getWorker } from '@/lib/jobs';
import { getJobRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/jobs/[id]
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const { id } = await params;
  const queue = getJobQueue();
  const job = queue.get(id);

  if (!job) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  if (job.userId !== user.id) return authError('无权访问该任务', 403);

  return NextResponse.json({ job });
}

// DELETE /api/jobs/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const { id } = await params;
  const queue = getJobQueue();
  const job = queue.get(id);

  // 任务可能在内存队列或仅在 SQLite 持久化层。两者都按 userId 校验归属。
  if (job) {
    if (job.userId !== user.id) return authError('无权操作该任务', 403);
  } else {
    const repo = getJobRepository();
    const stored = repo.get(id);
    if (!stored) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    if (stored.userId !== user.id) return authError('无权操作该任务', 403);
  }

  const worker = getWorker();

  // 尝试取消队列中的任务
  const cancelled = queue.cancel(id);

  // 如果任务正在运行，尝试中止
  if (!cancelled) {
    worker.cancelJob(id);
  }

  // 删除 SQLite 持久化记录（历史页跨重启清理）
  const repo = getJobRepository();
  repo.delete(id);

  return NextResponse.json({ success: true, jobId: id });
}
