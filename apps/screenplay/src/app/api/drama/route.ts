import { NextResponse } from 'next/server';
import { getDramaRepository } from '@/lib/store/sqlite/drama-repository';
import { getCurrentUser, authError } from '@novel/auth';

export const dynamic = 'force-dynamic';

/** GET /api/drama - 当前用户的分镜列表（摘要） */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const repo = getDramaRepository();
    const dramas = repo.list(user.id);

    return NextResponse.json({ dramas });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
