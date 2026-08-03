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

    const { novelText, title, author, modelId, temperature, selectedChapters, novelId } = await request.json();
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
    });
    return NextResponse.json({ jobId });
  } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }); }
}
