/**
 * Jobs API Endpoint
 *
 * GET /api/jobs - 列出任务
 * POST /api/jobs - 创建任务
 * GET /api/jobs/[id] - 获取任务详情
 * DELETE /api/jobs/[id] - 取消任务
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/jobs';
import { createPipelineJob, type PipelineJobInput } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

// GET /api/jobs - 列出任务
export async function GET(request: NextRequest) {
  const queue = getJobQueue();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') as PipelineJobInput['options'] extends { status: infer S } ? S : undefined;

  const jobs = queue.list(status as any);
  const stats = queue.getStats();

  return NextResponse.json({
    jobs,
    stats,
  });
}

// POST /api/jobs - 创建任务
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as PipelineJobInput & {
      priority?: 'low' | 'normal' | 'high' | 'urgent';
      timeout?: number;
      modelId?: string;
    };

    const job = createPipelineJob(body, {
      priority: body.priority,
      timeout: body.timeout,
      modelId: body.modelId,
    });

    const queue = getJobQueue();
    await queue.enqueue(job);

    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建任务失败' },
      { status: 400 }
    );
  }
}
