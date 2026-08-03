import { NextResponse } from 'next/server';
import { getJobRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/jobs/history - 当前用户的持久化转换历史（SQLite，区别于内存队列 /api/jobs）
 * 供工作台页面展示跨重启保留的转换任务。
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const repo = getJobRepository();
    const jobs = repo.list(undefined, user.id);

    const list = jobs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map((j) => ({
        id: j.id,
        status: j.status,
        currentPhase: j.currentPhase,
        progress: j.progress,
        error: j.error,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
        completedAt: j.completedAt,
        novelId: j.novelId ?? null,
        resultId: j.resultId,
        title: (j.config as { title?: string })?.title ?? null,
        modelId: (j.config as { modelId?: string })?.modelId ?? null,
        selectedChapterCount: ((j.config as { selectedChapters?: number[] })?.selectedChapters ?? []).length,
      }));

    return NextResponse.json({ jobs: list });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
