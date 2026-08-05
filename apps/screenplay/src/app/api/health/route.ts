/**
 * Health Check API
 *
 * GET /api/health
 * 返回系统健康状态，包括数据库连接。
 */

import { NextResponse } from 'next/server';
import { healthCheck } from '@/lib/store/sqlite/db';
import { getSSEClientManager } from '@/lib/sse/sse-client-manager';
import { getAgentRegistry } from '@/lib/multi-agent/registry';

export const dynamic = 'force-dynamic';

export async function GET() {
  const dbHealthy = healthCheck();
  const sseManager = getSSEClientManager();
  const registry = getAgentRegistry();

  const status = {
    status: dbHealthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    components: {
      database: {
        status: dbHealthy ? 'healthy' : 'unhealthy',
      },
      sse: {
        status: 'healthy',
        clients: sseManager.getTotalClients(),
      },
      agent: {
        status: 'healthy',
        agents: registry.getStats(),
      },
    },
  };

  return NextResponse.json(status, {
    status: dbHealthy ? 200 : 503,
  });
}
