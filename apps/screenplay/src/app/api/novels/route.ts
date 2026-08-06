import { NextResponse } from 'next/server';
import { getNovelRepository, getJobRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@novel/auth';

export const dynamic = 'force-dynamic';

/** GET /api/novels - 小说资产列表（当前用户，含最近任务状态） */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const novelRepo = getNovelRepository();
    const novels = novelRepo.list(user.id);

    // 补充每部小说的最近转换任务信息
    const jobRepo = getJobRepository();
    const list = novels.map((n) => {
      let lastJob = null;
      if (n.lastJobId) {
        const job = jobRepo.get(n.lastJobId);
        if (job) {
          lastJob = {
            id: job.id,
            status: job.status,
            completedAt: job.completedAt ?? null,
            totalScenes: job.pipelineState?.phase4Output?.metadata?.totalScenes ?? null,
          };
        }
      }
      return { ...n, lastJob };
    });

    return NextResponse.json({ novels: list });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
