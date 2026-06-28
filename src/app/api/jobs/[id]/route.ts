/**
 * Job Detail API Endpoint
 *
 * GET /api/jobs/[id] - 获取任务详情
 * DELETE /api/jobs/[id] - 取消任务
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/jobs';
import { getWorker } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/jobs/[id]
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const queue = getJobQueue();
  const job = queue.get(id);

  if (!job) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  return NextResponse.json({ job });
}

// DELETE /api/jobs/[id]
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const queue = getJobQueue();
  const worker = getWorker();

  // 尝试取消队列中的任务
  const cancelled = queue.cancel(id);

  // 如果任务正在运行，尝试中止
  if (!cancelled) {
    worker.cancelJob(id);
  }

  return NextResponse.json({ success: true, jobId: id });
}
