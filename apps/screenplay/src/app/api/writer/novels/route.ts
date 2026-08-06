/**
 * Writer Novels API
 *
 * GET /api/writer/novels - 当前用户的创作小说列表
 * POST /api/writer/novels - 创建空白创作小说
 */

import { NextResponse } from 'next/server';
import { getWriterNovelRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@novel/auth';
import { CreateDraftParamsSchema } from '@novel/contracts/novel';

export const dynamic = 'force-dynamic';

/** GET /api/writer/novels - 列表（含章节数/字数/转换进度） */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const repo = getWriterNovelRepository();
    const drafts = repo.listDrafts(user.id);
    return NextResponse.json({ novels: drafts });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** POST /api/writer/novels - 创建创作小说 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const body = await request.json().catch(() => ({}));
    const parsed = CreateDraftParamsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, { status: 400 });
    }

    const repo = getWriterNovelRepository();
    const id = repo.createDraft({ ...parsed.data, userId: user.id });
    const draft = repo.getDraft(id);
    return NextResponse.json({ novel: draft }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
