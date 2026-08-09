/**
 * Agent 任务 SSE (Server-Sent Events) 端点
 *
 * GET /api/agent/stream/[taskId]
 * 实时推送 Agent 编排任务的状态变更、日志与阶段结果。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSSEClientManager } from '@/lib/sse';
import { getCurrentUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { taskId } = await params;

  // SSE 订阅必须登录（EventSource 自动携带 cookie）
  const user = await getCurrentUser();
  if (!user) return authError();

  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    start(controller) {
      // 注册 SSE 客户端（以 taskId 作为 jobId 概念）
      const { cleanup } = getSSEClientManager().addClient(taskId, controller);

      // 发送初始连接事件
      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ taskId })}\r\n\r\n`,
        ),
      );

      // 客户端断开时清理
      request.signal.addEventListener('abort', () => {
        if (isClosed) return;
        isClosed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
    cancel() {
      isClosed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
