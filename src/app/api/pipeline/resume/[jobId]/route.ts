import { NextRequest, NextResponse } from 'next/server';
import { PipelineEngine } from '@/lib/pipeline/PipelineEngine';
import { jobStore } from '@/lib/store/job-store';

const engine = new PipelineEngine();

export async function POST(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (job.status !== 'converting' && job.status !== 'failed')
    return NextResponse.json({ error: `当前状态(${job.status})不支持恢复` }, { status: 400 });
  if (jobStore.isRecovering(jobId))
    return NextResponse.json({ error: '任务正在恢复中，请勿重复操作' }, { status: 409 });

  try { await engine.resumeJob(jobId); return NextResponse.json({ success: true, jobId }); }
  catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }); }
}
