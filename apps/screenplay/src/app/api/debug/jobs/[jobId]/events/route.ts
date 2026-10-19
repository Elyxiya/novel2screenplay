/**
 * 运行事件查询（P1 观测层）
 *
 * GET /api/debug/jobs/:jobId/events?limit=2000
 * 返回：事件流（含解析后的 payload）+ 按 stage 的聚合 + 阶段产物快照。
 * 鉴权：登录 + 任务归属（旧任务无 userId 时放行，与其余调试路由一致）。
 */

import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '@/lib/store/job-store';
import { getRunLogRepository } from '@/lib/store/sqlite/run-log-repository';
import { summarizeByStage } from '@/lib/observability/run-log';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parsePayload(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const { jobId } = await params;
  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (job.userId && job.userId !== user.id) return NextResponse.json({ error: '无权访问该任务' }, { status: 403 });

  const limitParam = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 5000) : 2000;

  const repo = getRunLogRepository();
  const events = repo.listEvents(jobId, limit);
  const artifacts = repo.listArtifacts(jobId);

  return NextResponse.json({
    jobId,
    status: job.status,
    currentPhase: job.currentPhase ?? null,
    summary: summarizeByStage(events),
    events: events.map((e) => ({
      id: e.id,
      traceId: e.traceId,
      phase: e.phase,
      sceneIndex: e.sceneIndex,
      stage: e.stage,
      event: e.event,
      level: e.level,
      latencyMs: e.latencyMs,
      promptTokens: e.promptTokens,
      completionTokens: e.completionTokens,
      createdAt: e.createdAt,
      payload: parsePayload(e.payload),
    })),
    artifacts: artifacts.map((a) => ({
      id: a.id,
      traceId: a.traceId,
      stage: a.stage,
      sceneIndex: a.sceneIndex,
      attempt: a.attempt,
      createdAt: a.createdAt,
      meta: parsePayload(a.meta),
      inputText: a.inputText,
      outputText: a.outputText,
    })),
  });
}
