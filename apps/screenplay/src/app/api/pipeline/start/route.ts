import { NextRequest, NextResponse } from 'next/server';
import { PipelineEngine } from '@/lib/pipeline/PipelineEngine';
import { initializeProviders } from '@/lib/llm/registry';
import { getCurrentUser, authError } from '@/lib/auth';
import { UserProfileSchema } from '@novel/contracts/pipeline';

initializeProviders();
const engine = new PipelineEngine();

export async function POST(request: NextRequest) {
  try {
    // 启动转换任务必须登录
    const user = await getCurrentUser();
    if (!user) return authError();

    const { novelText, title, author, modelId, temperature, selectedChapters, novelId, reusePhase1FromJobId, userProfile } = await request.json();
    if (!novelText) return NextResponse.json({ error: '缺少 novelText' }, { status: 400 });

    // FIX-13：用户设定入口校验（C5 契约域；非法即 400，不静默忽略）
    let validatedProfile;
    if (userProfile !== undefined) {
      const parsed = UserProfileSchema.safeParse(userProfile);
      if (!parsed.success) {
        return NextResponse.json(
          { error: `userProfile 校验失败: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('；').slice(0, 300)}` },
          { status: 400 },
        );
      }
      validatedProfile = parsed.data;
    }

    const jobId = await engine.startJob({
      novelText,
      title,
      author,
      modelId,
      temperature: temperature ?? 0.7,
      selectedChapters,
      novelId,
      userId: user.id,
      // B-09：显式复用历史设定卡（服务端校验来源归属与产物存在性）
      reusePhase1FromJobId,
      // FIX-13：用户自定义设定（已校验）
      userProfile: validatedProfile,
    });
    return NextResponse.json({ jobId });
  } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }); }
}
