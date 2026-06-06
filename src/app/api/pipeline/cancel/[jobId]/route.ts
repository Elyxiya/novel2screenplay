import { NextRequest, NextResponse } from 'next/server';
import { PipelineEngine } from '@/lib/pipeline/PipelineEngine';
import { jobStore } from '@/lib/store/job-store';

const engine = new PipelineEngine();

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  engine.cancelJob(jobId);
  return NextResponse.json({ success: true, message: '任务已取消' });
}
