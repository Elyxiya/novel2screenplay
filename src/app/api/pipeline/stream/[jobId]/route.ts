/**
 * SSE Stream API Endpoint
 *
 * GET /api/pipeline/stream/[jobId]
 * 提供 Server-Sent Events 流式推送，
 * 用于实时推送 Pipeline 进度。
 */

import { NextRequest } from 'next/server';
import { jobStore } from '@/lib/store/job-store';
import { getSSEClientManager } from '@/lib/sse/sse-client-manager';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const { jobId } = await params;

  // 验证 Job 是否存在
  const job = jobStore.get(jobId);
  if (!job) {
    return new Response('Job not found', { status: 404 });
  }
  if (job.userId && job.userId !== user.id) {
    return new Response('Forbidden', { status: 403 });
  }

  // 创建 AbortController 用于管理连接生命周期
  const abortController = new AbortController();
  let cleanup: (() => void) | null = null;

  // 创建 SSE 流
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sseManager = getSSEClientManager();

      // 注册客户端，获取 cleanup 函数
      const result = sseManager.addClient(jobId, controller);
      cleanup = result.cleanup;

      // 发送初始状态
      const initEvent = {
        type: 'init' as const,
        data: {
          jobId: job.id,
          status: job.status,
          currentPhase: job.currentPhase,
          progress: job.progress,
          subProgress: job.subProgress,
          scenesStatus: job.scenesStatus,
          logs: job.logs.slice(-20), // 最近20条日志
        },
        timestamp: Date.now(),
      };

      try {
        const initData = new TextEncoder().encode(
          `event: init\r\ndata: ${JSON.stringify(initEvent)}\r\n\r\n`
        );
        controller.enqueue(initData);
      } catch {
        // Stream closed
        cleanup?.();
        return;
      }
    },
    cancel() {
      // 客户端断开连接时清理
      console.log(`[SSE] Stream cancelled for job ${jobId}`);
      cleanup?.();
    },
  });

  // 监听请求取消
  request.signal.addEventListener('abort', () => {
    console.log(`[SSE] Request aborted for job ${jobId}`);
    cleanup?.();
  });

  // 返回 SSE 响应
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用 Nginx buffering
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  });
}

// 处理 CORS 预检请求
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Cache-Control',
    },
  });
}
