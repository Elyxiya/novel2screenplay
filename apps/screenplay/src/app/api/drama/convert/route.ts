import { NextRequest, NextResponse } from 'next/server';
import { getDramaRepository } from '@/lib/store/sqlite/drama-repository';
import { getScreenplaySnapshot, ScreenplaySnapshotError } from '@/lib/jobs/screenplay-snapshot';
import { dramatize } from '@/lib/drama/dramatize';
import { serializeDramaToYaml, safeParseDramaFromYaml } from '@novel/contracts/serializers';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/drama/convert - 剧本 → 短剧分镜
 * body: { jobId: string }
 * 幂等：同一剧本重复转换会覆盖该剧本已有的分镜记录。
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    let body: { jobId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
    }

    const jobId = body.jobId;
    if (!jobId) return NextResponse.json({ error: '缺少 jobId' }, { status: 400 });

    // C1 收敛：通过 ② 侧剧本快照读取输入，不再直接触碰 ② 内部存储
    let snapshot;
    try {
      snapshot = getScreenplaySnapshot(jobId, user.id);
    } catch (err) {
      if (err instanceof ScreenplaySnapshotError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }

    const drama = dramatize(snapshot.screenplay, {
      title: snapshot.title,
      sourceScreenplayId: snapshot.sourceJobId,
      sourceNovelId: snapshot.sourceNovelId,
      sourceNovelTitle: snapshot.sourceNovelTitle,
    });
    const yaml = serializeDramaToYaml(drama);

    // 校验产物（双保险：dramatize 内部已 parse，此处保证落库内容合法）
    const result = safeParseDramaFromYaml(yaml);
    if (!result.success) {
      return NextResponse.json({ error: '分镜生成校验失败', details: result.error }, { status: 500 });
    }

    // 幂等：同一剧本已生成过分镜 → 覆盖更新
    const repo = getDramaRepository();
    const existing = repo.findBySourceJobId(jobId, user.id);
    const dramaId = existing?.id ?? repo.create({
      sourceJobId: jobId,
      sourceNovelId: snapshot.sourceNovelId,
      title: drama.metadata.title,
      dramaYaml: yaml,
      userId: user.id,
    });

    return NextResponse.json({
      dramaId,
      drama,
      yaml,
      source: {
        sourceScreenplayId: jobId,
        sourceNovelId: snapshot.sourceNovelId,
        sourceNovelTitle: snapshot.sourceNovelTitle,
      },
    });
  } catch (err) {
    console.error('[POST /api/drama/convert] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
