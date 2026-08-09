import { NextResponse } from 'next/server';
import { jobStore } from '@/lib/store/job-store';
import { evaluateFlow } from '@/lib/debug/flow-evaluator';
import { getCurrentUser, authError } from '@/lib/auth';

/**
 * 流程效果评测 API
 *
 * GET /api/debug/flow-eval?jobId=x → 返回该 job 的 FlowEvaluation
 */
export async function GET(request: Request): Promise<NextResponse> {
  // 流程评测必须登录
  const user = await getCurrentUser();
  if (!user) return authError();

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: '缺少 jobId 参数' }, { status: 400 });
  }

  const job = jobStore.get(jobId);
  if (!job) {
    return NextResponse.json({ error: '任务不存在', jobId }, { status: 404 });
  }

  const evaluation = evaluateFlow(job);
  return NextResponse.json({ evaluation });
}
