import { NextRequest, NextResponse } from 'next/server';
import { PipelineEngine } from '@/lib/pipeline/PipelineEngine';
import { initializeProviders } from '@/lib/llm/registry';
import { getCurrentUser, authError } from '@/lib/auth';

initializeProviders();
const engine = new PipelineEngine();

export async function POST(request: NextRequest) {
  try {
    // 启动转换任务必须登录
    const user = await getCurrentUser();
    if (!user) return authError();

    const { novelText, title, author, modelId, temperature, selectedChapters, novelId, reusePhase1FromJobId } = await request.json();
    if (!novelText) return NextResponse.json({ error: '缺少 novelText' }, { status: 400 });

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
    });
    return NextResponse.json({ jobId });
  } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }); }
}
