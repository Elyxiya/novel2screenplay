import { NextResponse } from 'next/server';
import { getJobRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';
import type { StoredJob } from '@/lib/store/job-store';

export const dynamic = 'force-dynamic';

/** 从任务行派生历史卡展示字段（config 优先，剧本 metadata 兜底） */
function toHistoryEntry(j: StoredJob) {
  const config = j.config as { title?: string; author?: string } | undefined;
  const meta = j.pipelineState?.phase4Output?.metadata;
  return {
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
    title: config?.title ?? meta?.title ?? null,
    author: config?.author ?? meta?.author ?? '',
    sourceNovel: meta?.sourceNovel ?? '',
    totalScenes: meta?.totalScenes ?? 0,
    totalCharacters: meta?.totalCharacters ?? 0,
    totalLocations: meta?.totalLocations ?? 0,
    modelId: (j.config as { modelId?: string })?.modelId ?? null,
    selectedChapterCount: ((j.config as { selectedChapters?: number[] })?.selectedChapters ?? []).length,
  };
}

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
      .map(toHistoryEntry);

    return NextResponse.json({ jobs: list });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/jobs/history - 清空当前用户的全部持久化任务（历史面板"清空"）
 */
export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const repo = getJobRepository();
    const deleted = repo.deleteByUser(user.id);

    return NextResponse.json({ success: true, deleted });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
