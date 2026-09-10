import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PipelineEngine } from '@/lib/pipeline/PipelineEngine';
import { initializeProviders } from '@/lib/llm/registry';
import { getCurrentUser, authError } from '@/lib/auth';
import { jobStore } from '@/lib/store/job-store';
import { RawCharacterSchema, RawLocationSchema, SettingCardSchema } from '@novel/contracts/pipeline';

initializeProviders();
const engine = new PipelineEngine();

const CardEditBodySchema = z.object({
  phase1Output: z.object({
    characters: z.array(RawCharacterSchema).min(1),
    locations: z.array(RawLocationSchema).optional(),
    settingCard: SettingCardSchema.optional(),
  }),
});

/**
 * POST /api/jobs/[jobId]/card-edit —— 应用设定卡编辑并做失效集局部重转（B-03）。
 * 请求体：{ phase1Output: { characters, locations?, settingCard? } }（编辑后的完整卡）。
 * 返回：{ invalidatedScenes, reconvertedScenes }（仅失效场景被重转，其余产物原样保留）。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const { jobId } = await params;
    const job = jobStore.get(jobId);
    if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    if (job.userId && job.userId !== user.id) return authError('无权访问该任务', 403);

    const json = await req.json().catch(() => null);
    const parsed = CardEditBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: `卡编辑校验失败: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；').slice(0, 300)}` },
        { status: 400 },
      );
    }

    const result = await engine.applyCardEdit(jobId, parsed.data.phase1Output);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = (err as Error).message;
    const status = /正在恢复\/重转/.test(message) ? 409 : /不存在|缺少/.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
