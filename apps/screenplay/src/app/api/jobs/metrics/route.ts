import { NextResponse } from 'next/server';
import { getJobRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';
import { aggregateJobMetrics } from '@/lib/jobs/metrics';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/jobs/metrics?days=7 —— 当前用户的任务指标聚合（FIX-08）。
 *
 * 数据源为已落库内容（无需额外存储）：jobs 行（状态/耗时/error）+
 * pipelineState.metrics（FIX-02b 运行期指标）+ phase2Output.rawResponses（fallback）+
 * phase4Output（空 sourceRefs / 低置信场景）。供 debug 聚合卡片与成本/质量报告消费。
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const url = new URL(request.url);
    const daysRaw = Number(url.searchParams.get('days') ?? '7');
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.floor(daysRaw), 1), 90) : 7;

    const to = Date.now();
    const from = to - days * DAY_MS;

    const repo = getJobRepository();
    const jobs = repo.list(undefined, user.id).filter((j) => j.createdAt >= from);

    return NextResponse.json(aggregateJobMetrics(jobs, { from, to, days }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
