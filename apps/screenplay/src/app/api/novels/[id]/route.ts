import { NextRequest, NextResponse } from 'next/server';
import { getNovelRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@novel/auth';

export const dynamic = 'force-dynamic';

/** GET /api/novels/[id] - 小说资产详情（含章节与已转换标记） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const { id } = await params;
    const novelRepo = getNovelRepository();
    const novel = novelRepo.get(id);
    if (!novel) return NextResponse.json({ error: '小说资产不存在' }, { status: 404 });
    if (novel.userId !== user.id) {
      return NextResponse.json({ error: '无权访问该资产' }, { status: 403 });
    }

    return NextResponse.json({
      novel: {
        id: novel.id,
        title: novel.title,
        author: novel.author,
        totalChapters: novel.totalChapters,
        convertedChapters: novel.convertedChapters,
        convertedCount: novel.convertedCount,
        chapterTexts: novel.chapterTexts,
        chapters: novel.chapters,
        createdAt: novel.createdAt,
        updatedAt: novel.updatedAt,
        lastJobId: novel.lastJobId,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** DELETE /api/novels/[id] - 删除小说资产 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const { id } = await params;
    const novelRepo = getNovelRepository();
    const novel = novelRepo.get(id);
    if (!novel) return NextResponse.json({ error: '小说资产不存在' }, { status: 404 });
    if (novel.userId !== user.id) {
      return NextResponse.json({ error: '无权删除该资产' }, { status: 403 });
    }
    novelRepo.delete(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
