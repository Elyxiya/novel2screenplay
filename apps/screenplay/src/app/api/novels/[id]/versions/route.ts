import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, authError } from '@/lib/auth';
import { getNovelRepository, getNovelVersionRepository, getJobRepository } from '@/lib/store/sqlite';

export const dynamic = 'force-dynamic';

/**
 * GET /api/novels/[id]/versions —— 小说的转换版本列表 + 最新两版的摘要 diff（FIX-24）。
 *
 * 版本行在每次成功转换时落库（novel_versions）；diff 为摘要级：
 * 场景/角色/地点规模变化 + prompt 指纹与 formatVersion 是否变化，
 * 不做逐字对比（逐字对比属审计交付增强，不在本期）。
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const { id: novelId } = await params;
  const novel = getNovelRepository().get(novelId);
  if (!novel) return NextResponse.json({ error: '小说不存在' }, { status: 404 });
  if (novel.userId && novel.userId !== user.id) return authError('无权访问该小说', 403);

  const versions = getNovelVersionRepository().listByNovel(novelId);

  let diff: {
    fromJobId: string;
    toJobId: string;
    sceneDelta: number | null;
    characterDelta: number | null;
    locationDelta: number | null;
    promptChanged: boolean;
    formatVersionChanged: boolean;
  } | null = null;

  if (versions.length >= 2) {
    const [to, from] = versions; // listByNovel 倒序：最新在前
    const jobs = getJobRepository();
    const fromMeta = jobs.get(from.jobId)?.pipelineState?.phase4Output?.metadata;
    const toMeta = jobs.get(to.jobId)?.pipelineState?.phase4Output?.metadata;
    diff = {
      fromJobId: from.jobId,
      toJobId: to.jobId,
      sceneDelta: fromMeta && toMeta ? toMeta.totalScenes - fromMeta.totalScenes : null,
      characterDelta: fromMeta && toMeta ? toMeta.totalCharacters - fromMeta.totalCharacters : null,
      locationDelta: fromMeta && toMeta ? toMeta.totalLocations - fromMeta.totalLocations : null,
      promptChanged: from.promptHash !== to.promptHash,
      formatVersionChanged: from.formatVersion !== to.formatVersion,
    };
  }

  return NextResponse.json({ versions, diff });
}
