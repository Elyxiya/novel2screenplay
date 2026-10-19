/**
 * 单场景回放（P1.5）
 *
 * POST /api/debug/replay  { jobId, sceneIndex, modelId? }
 * 用任务自身的 Phase1/Phase2 产物重建该场景，重跑一次 Phase 3，返回新旧对比。
 * 只读任务（不改状态、不覆盖产物），会写一条 replay trace 与一份产物快照。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, authError } from '@/lib/auth';
import { replayScene, ReplayError } from '@/lib/debug/replay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const body = (await request.json().catch(() => null)) as
    | { jobId?: unknown; sceneIndex?: unknown; modelId?: unknown }
    | null;

  const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
  const sceneIndex = typeof body?.sceneIndex === 'number' ? body.sceneIndex : NaN;
  if (!jobId) return NextResponse.json({ error: '缺少 jobId' }, { status: 400 });
  if (!Number.isInteger(sceneIndex) || sceneIndex <= 0) {
    return NextResponse.json({ error: 'sceneIndex 必须是正整数' }, { status: 400 });
  }

  try {
    const result = await replayScene({
      jobId,
      sceneIndex,
      userId: user.id,
      modelId: typeof body?.modelId === 'string' && body.modelId ? body.modelId : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof ReplayError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
