import { NextRequest, NextResponse } from 'next/server';
import { getDramaRepository } from '@/lib/store/sqlite/drama-repository';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/drama/[id] - 分镜详情（含 YAML 与溯源信息） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) return authError();

    const repo = getDramaRepository();
    const record = repo.get(id);
    if (!record) return NextResponse.json({ error: '分镜不存在' }, { status: 404 });
    if (record.userId && record.userId !== user.id) {
      return authError('无权访问该分镜', 403);
    }

    return NextResponse.json({
      id: record.id,
      title: record.title,
      yaml: record.dramaYaml,
      sourceJobId: record.sourceJobId,
      sourceNovelId: record.sourceNovelId,
      createdAt: record.createdAt,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
