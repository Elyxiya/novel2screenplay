import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, authError } from '@/lib/auth';
import { getScreenplaySnapshot, ScreenplaySnapshotError } from '@/lib/jobs/screenplay-snapshot';
import { serializeToMarkdown } from '@novel/contracts/serializers';
import { planEpisodes } from '@/lib/drama/episodes';

export const dynamic = 'force-dynamic';

/** 文件名安全化（保留中文，剔除路径/控制字符） */
function safeFileName(title: string): string {
  return `${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 60) || 'screenplay'}.md`;
}

/**
 * GET /api/result/[jobId]/export?format=md[&epMinutes=2][&episodes=1][&sourceRefs=1]
 *
 * FIX-15 第一步：Markdown 导出（场景/角色/分集一体）。鉴权与归属校验复用
 * getScreenplaySnapshot（完成态+剧本存在+属主三查）。docx/pdf 依评估结论后置。
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const { jobId } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get('format') ?? 'md';
  if (format !== 'md') {
    return NextResponse.json({ error: `暂不支持的导出格式: ${format}（当前仅 md；docx/pdf 见 export-formats-assessment.md）` }, { status: 400 });
  }

  let snapshot;
  try {
    snapshot = getScreenplaySnapshot(jobId, user.id);
  } catch (err) {
    if (err instanceof ScreenplaySnapshotError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const wantEpisodes = url.searchParams.get('episodes') === '1';
  const epMinutes = Number(url.searchParams.get('epMinutes') ?? '2');
  const episodes = wantEpisodes
    ? planEpisodes(snapshot.screenplay, {
        episodeTargetMinutes: Number.isFinite(epMinutes) && epMinutes > 0 ? epMinutes : 2,
        hookPolicy: 'cliffhanger',
      }).episodes
    : undefined;

  const markdown = serializeToMarkdown(snapshot.screenplay, {
    episodes,
    includeSourceRefs: url.searchParams.get('sourceRefs') === '1',
  });

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(snapshot.title ?? 'screenplay'))}`,
    },
  });
}
