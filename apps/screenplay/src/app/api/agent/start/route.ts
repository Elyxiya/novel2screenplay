import { NextRequest, NextResponse } from 'next/server';
import { MultiAgentOrchestrator } from '@/lib/multi-agent/orchestrator';
import { initializeProviders } from '@/lib/llm/registry';

initializeProviders();

// 单例编排器（复用默认 LLM Provider）
let orchestrator: MultiAgentOrchestrator | null = null;
function getOrchestrator(): MultiAgentOrchestrator {
  if (!orchestrator) {
    orchestrator = new MultiAgentOrchestrator({
      enableReviewGates: true,
      enableAutoRetry: true,
      defaultQualityThreshold: 75,
    });
  }
  return orchestrator;
}

export async function POST(request: NextRequest) {
  try {
    const { novelText, title, author, instruction } = await request.json();
    if (!novelText) return NextResponse.json({ error: '缺少 novelText' }, { status: 400 });

    const taskId = getOrchestrator().startConversion({
      novelText,
      title,
      author,
      instruction,
    });

    return NextResponse.json({ taskId, message: 'Agent 编排任务已启动' });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const taskId = request.nextUrl.searchParams.get('taskId');
    if (!taskId) return NextResponse.json({ error: '缺少 taskId' }, { status: 400 });

    const task = getOrchestrator().getTask(taskId);
    if (!task) return NextResponse.json({ error: '任务不存在' }, { status: 404 });

    return NextResponse.json({
      taskId: task.id,
      phases: task.phases.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        status: p.status,
        retryCount: p.retryCount,
        error: p.error,
      })),
      completed: task.phases.every((p) => p.status === 'completed'),
      failed: task.phases.some((p) => p.status === 'failed'),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
