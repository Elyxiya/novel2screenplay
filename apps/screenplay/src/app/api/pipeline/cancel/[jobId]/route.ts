import { NextRequest, NextResponse } from 'next/server';
import { PipelineEngine } from '@/lib/pipeline/PipelineEngine';
import { jobStore } from '@/lib/store/job-store';
import { getCurrentUser, authError } from '@/lib/auth';

const engine = new PipelineEngine();

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const { jobId } = await params;
  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (job.userId && job.userId !== user.id) return authError('无权操作该任务', 403);
  engine.cancelJob(jobId);
  return NextResponse.json({ success: true, message: '任务已取消' });
}
