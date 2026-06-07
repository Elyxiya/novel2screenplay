import { NextRequest, NextResponse } from 'next/server';
import { PipelineEngine } from '@/lib/pipeline/PipelineEngine';
import { initializeProviders } from '@/lib/llm/registry';

initializeProviders();
const engine = new PipelineEngine();

export async function POST(request: NextRequest) {
  try {
    const { novelText, title, author, modelId, temperature, selectedChapters } = await request.json();
    if (!novelText) return NextResponse.json({ error: '缺少 novelText' }, { status: 400 });

    const jobId = await engine.startJob({
      novelText,
      title,
      author,
      modelId,
      temperature: temperature ?? 0.7,
      selectedChapters,
    });
    return NextResponse.json({ jobId });
  } catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 500 }); }
}
