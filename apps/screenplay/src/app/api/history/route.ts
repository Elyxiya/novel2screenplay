import { NextRequest, NextResponse } from 'next/server';
import { getHistoryRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/history - 当前用户的转换历史列表（SQLite history 表）
 * 返回字段与前端 HistoryPanel 对齐：jobId/title/author/sceneCount/characterCount/locationCount/createdAt
 */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const repo = getHistoryRepository();
    const list = repo.listRecent(50, user.id).map((h) => ({
      jobId: h.jobId,
      title: h.title,
      author: h.author,
      sceneCount: h.sceneCount,
      characterCount: h.characterCount,
      locationCount: h.locationCount,
      createdAt: h.createdAt,
    }));

    return NextResponse.json({ history: list });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * DELETE /api/history?jobId=xxx - 删除单条历史（归属校验）
 * DELETE /api/history - 清空当前用户全部历史
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const repo = getHistoryRepository();
    const jobId = request.nextUrl.searchParams.get('jobId');

    if (jobId) {
      repo.deleteByJobId(jobId, user.id);
    } else {
      repo.clearByUser(user.id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
