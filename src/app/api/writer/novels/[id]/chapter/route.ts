/**
 * Writer Chapter API
 *
 * POST   /api/writer/novels/[id]/chapter - 保存单章（upsert，含字数统计）
 * DELETE /api/writer/novels/[id]/chapter - 删除单章（body: { chapterId }）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWriterNovelRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';
import { ChapterSchema } from '@/lib/schema/novel.schema';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function authorize(id: string): Promise<Response | null> {
  const user = await getCurrentUser();
  if (!user) return authError();
  const repo = getWriterNovelRepository();
  const draft = repo.getDraft(id);
  if (!draft) return NextResponse.json({ error: '创作小说不存在' }, { status: 404 });
  if (draft.userId !== user.id) {
    return NextResponse.json({ error: '无权访问该小说' }, { status: 403 });
  }
  return null;
}

/** POST /api/writer/novels/[id]/chapter */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const denied = await authorize(id);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const parsed = ChapterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '章节数据不合法' }, { status: 400 });
  }

  const repo = getWriterNovelRepository();
  const saved = repo.saveChapter(id, parsed.data);
  if (!saved) {
    return NextResponse.json({ error: '创作小说不存在' }, { status: 404 });
  }
  return NextResponse.json({ success: true, chapter: saved });
}

/** DELETE /api/writer/novels/[id]/chapter */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const denied = await authorize(id);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const chapterId = body?.chapterId;
  if (!chapterId || typeof chapterId !== 'string') {
    return NextResponse.json({ error: '缺少 chapterId' }, { status: 400 });
  }

  const repo = getWriterNovelRepository();
  repo.deleteChapter(id, chapterId);
  return NextResponse.json({ success: true });
}
