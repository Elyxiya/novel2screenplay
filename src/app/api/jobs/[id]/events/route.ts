/**
 * Job SSE (Server-Sent Events) Endpoint
 *
 * GET /api/jobs/[id]/events
 * 实时推送任务进度更新。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJobQueue } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/jobs/[id]/events
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const queue = getJobQueue();
  const job = queue.get(id);

  // 如果任务不存在，返回 404
  if (!job) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  // 检查任务是否已完成
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    // 对于已完成的请求，返回单个事件并关闭
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const event = formatSSEMessage(job);
        controller.enqueue(encoder.encode(event));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // 创建事件流
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    start(controller) {
      // 发送初始状态
      const initialEvent = formatSSEMessage(job);
      controller.enqueue(encoder.encode(initialEvent));

      // 设置进度监听器
      const handleProgress = (updatedJob: typeof job) => {
        if (isClosed) return;

        const event = formatSSEMessage(updatedJob);
        controller.enqueue(encoder.encode(event));

        // 如果任务完成或失败，关闭连接
        if (
          updatedJob.status === 'completed' ||
          updatedJob.status === 'failed' ||
          updatedJob.status === 'cancelled'
        ) {
          isClosed = true;
          controller.close();
          queue.off('update', handleProgress);
        }
      };

      queue.on('update' as any, handleProgress);

      // 处理客户端断开连接
      request.signal.addEventListener('abort', () => {
        isClosed = true;
        queue.off('update' as any, handleProgress);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

function formatSSEMessage(job: ReturnType<typeof getJobQueue> extends { get: (id: string) => infer T } ? T : never): string {
  const data = JSON.stringify({
    id: job.id,
    status: job.status,
    progress: job.progress,
    subProgress: job.subProgress,
    currentPhase: job.currentPhase,
    error: job.error,
    output: job.output,
  });

  return `data: ${data}\n\n`;
}
