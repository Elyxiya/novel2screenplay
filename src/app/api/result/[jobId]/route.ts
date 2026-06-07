import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '@/lib/store/job-store';
import { serializeToYaml, safeParseFromYaml } from '@/lib/schema/yaml-serializer';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (job.status !== 'completed') return NextResponse.json({ error: `任务未完成(${job.status})` }, { status: 400 });

  const screenplay = job.pipelineState.phase4Output;
  if (!screenplay) return NextResponse.json({ error: '剧本数据不存在' }, { status: 404 });
  return NextResponse.json({ screenplay, yaml: serializeToYaml(screenplay), analytics: screenplay.analytics, metadata: screenplay.metadata });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });

  try {
    const { yaml } = await request.json();
    if (!yaml) return NextResponse.json({ error: '缺少 yaml' }, { status: 400 });
    const result = safeParseFromYaml(yaml);
    if (!result.success) return NextResponse.json({ error: 'YAML 校验失败', details: result.error }, { status: 400 });
    jobStore.update(jobId, j => ({ ...j, pipelineState: { ...j.pipelineState, phase4Output: result.data } }));
    return NextResponse.json({ success: true, message: '剧本更新成功' });
  } catch { return NextResponse.json({ error: '请求格式错误' }, { status: 400 }); }
}
