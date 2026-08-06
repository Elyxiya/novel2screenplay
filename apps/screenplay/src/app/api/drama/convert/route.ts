import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '@/lib/store/job-store';
import { getDramaRepository } from '@/lib/store/sqlite/drama-repository';
import { getNovelRepository } from '@/lib/store/sqlite/novel-repository';
import { dramatize } from '@/lib/drama/dramatize';
import { serializeDramaToYaml, safeParseDramaFromYaml } from '@novel/contracts/serializers';
import { getCurrentUser, authError } from '@novel/auth';

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

    const job = jobStore.get(jobId);
    if (!job) return NextResponse.json({ error: '剧本任务不存在' }, { status: 404 });
    if (job.userId && job.userId !== user.id) {
      return authError('无权访问该任务', 403);
    }
    if (job.status !== 'completed') {
      return NextResponse.json({ error: `任务未完成(${job.status})，无法生成分镜` }, { status: 400 });
    }

    const screenplay = job.pipelineState.phase4Output;
    if (!screenplay) return NextResponse.json({ error: '剧本数据不存在' }, { status: 404 });

    // 溯源链：job.novelId → 小说资产（补全来源标题）
    const novelId = job.novelId ?? null;
    let sourceNovelTitle = '';
    if (novelId) {
      const novel = getNovelRepository().get(novelId);
      if (novel) sourceNovelTitle = novel.title;
    }

    const drama = dramatize(screenplay, {
      title: job.config?.title ?? screenplay.metadata.title,
      sourceScreenplayId: jobId,
      sourceNovelId: novelId,
      sourceNovelTitle,
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
      sourceNovelId: novelId,
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
        sourceNovelId: novelId,
        sourceNovelTitle,
      },
    });
  } catch (err) {
    console.error('[POST /api/drama/convert] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
