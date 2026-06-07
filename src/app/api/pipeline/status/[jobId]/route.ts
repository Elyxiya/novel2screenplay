import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '@/lib/store/job-store';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  return NextResponse.json({
    id: job.id, status: job.status, currentPhase: job.currentPhase,
    progress: job.progress, subProgress: job.subProgress,
    scenesStatus: job.scenesStatus, logs: job.logs.slice(-50),
    error: job.error, resultId: job.resultId, createdAt: job.createdAt,
  });
}
