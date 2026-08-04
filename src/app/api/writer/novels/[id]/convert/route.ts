/**
 * Writer 送去转剧本 API
 *
 * POST /api/writer/novels/[id]/convert
 *
 * 把创作小说物化为上传资产格式（novel_text + chapter_texts），
 * 返回 novelId，前端跳转 /configure?novel=<id> 进入现有转换流程。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWriterNovelRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return authError();

  const repo = getWriterNovelRepository();
  const draft = repo.getDraft(id);
  if (!draft) return NextResponse.json({ error: '创作小说不存在' }, { status: 404 });
  if (draft.userId !== user.id) {
    return NextResponse.json({ error: '无权访问该小说' }, { status: 403 });
  }

  const chapters = draft.chapters;
  if (chapters.length === 0) {
    return NextResponse.json({ error: '暂无章节，请先创作至少一章' }, { status: 400 });
  }
  const empty = chapters.filter((c) => !c.content.trim());
  if (empty.length === chapters.length) {
    return NextResponse.json({ error: '所有章节均为空，请先写入正文' }, { status: 400 });
  }

  repo.materialize(id);
  return NextResponse.json({ novelId: id, title: draft.title, chapterCount: chapters.length });
}
