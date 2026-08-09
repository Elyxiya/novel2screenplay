/**
 * SSE Client 管理器
 *
 * 管理 Server-Sent Events 客户端连接，
 * 支持心跳、广播、连接生命周期管理。
 */

export interface SSEClient {
  id: string;
  jobId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  connectedAt: number;
}

export interface SSEEvent {
  type: 'progress' | 'log' | 'phase' | 'complete' | 'error' | 'heartbeat' | 'quality';
  data: unknown;
  timestamp?: number;
}

type EventHandler = (event: SSEEvent) => void;

class SSEClientManager {
  private clients = new Map<string, SSEClient>();
  private jobClients = new Map<string, Set<string>>();
  private eventHandlers: EventHandler[] = [];
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startHeartbeat();
  }

  /**
   * 注册新的 SSE 客户端
   * 返回 cleanup 函数
   */
  addClient(jobId: string, controller: ReadableStreamDefaultController<Uint8Array>): { clientId: string; cleanup: () => void } {
    const clientId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const client: SSEClient = {
      id: clientId,
      jobId,
      controller,
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);

    if (!this.jobClients.has(jobId)) {
      this.jobClients.set(jobId, new Set());
    }
    this.jobClients.get(jobId)!.add(clientId);

    console.log(`[SSE] Client connected: ${clientId} for job ${jobId}`);

    // 返回 cleanup 函数用于断开连接
    const cleanup = () => this.removeClient(clientId);
    return { clientId, cleanup };
  }

  /**
   * 移除 SSE 客户端
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    this.clients.delete(clientId);

    const jobClientSet = this.jobClients.get(client.jobId);
    if (jobClientSet) {
      jobClientSet.delete(clientId);
      if (jobClientSet.size === 0) {
        this.jobClients.delete(client.jobId);
      }
    }

    console.log(`[SSE] Client disconnected: ${clientId}`);
    console.log(`[SSE] Remaining clients: ${this.clients.size}`);
  }

  /**
   * 向指定 Job 的所有客户端发送消息
   */
  sendToJob(jobId: string, event: SSEEvent): void {
    const clientIds = this.jobClients.get(jobId);
    if (!clientIds || clientIds.size === 0) return;

    const eventData = this.formatEvent(event);

    for (const clientId of clientIds) {
      const client = this.clients.get(clientId);
      if (!client) continue;

      try {
        client.controller.enqueue(eventData);
      } catch {
        // Client disconnected, remove it
        this.removeClient(clientId);
      }
    }
  }

  /**
   * 向指定客户端发送消息
   */
  sendToClient(clientId: string, event: SSEEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      client.controller.enqueue(this.formatEvent(event));
      return true;
    } catch {
      this.removeClient(clientId);
      return false;
    }
  }

  /**
   * 广播消息到所有客户端
   */
  broadcast(event: SSEEvent): void {
    const eventData = this.formatEvent(event);
    const disconnected: string[] = [];

    for (const [clientId, client] of this.clients) {
      try {
        client.controller.enqueue(eventData);
      } catch {
        disconnected.push(clientId);
      }
    }

    // Clean up disconnected clients
    for (const clientId of disconnected) {
      this.removeClient(clientId);
    }
  }

  /**
   * 添加事件处理器
   */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index > -1) this.eventHandlers.splice(index, 1);
    };
  }

  /**
   * 获取 Job 的客户端数量
   */
  getJobClientCount(jobId: string): number {
    return this.jobClients.get(jobId)?.size ?? 0;
  }

  /**
   * 获取总客户端数
   */
  getTotalClients(): number {
    return this.clients.size;
  }

  /**
   * 格式化 SSE 事件
   */
  private formatEvent(event: SSEEvent): Uint8Array {
    const timestamp = event.timestamp ?? Date.now();
    const lines = [
      `event: ${event.type}`,
      `data: ${JSON.stringify({ ...event, timestamp })}`,
      '',
      '',
    ];
    const text = lines.join('\r\n');
    return new TextEncoder().encode(text);
  }

  /**
   * 启动心跳机制
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    const HEARTBEAT_INTERVAL = 30000; // 30秒
    const HEARTBEAT_TIMEOUT = 60000; // 60秒无响应断开

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const event: SSEEvent = {
        type: 'heartbeat',
        data: { timestamp: now },
        timestamp: now,
      };

      const disconnected: string[] = [];

      for (const [clientId, client] of this.clients) {
        try {
          client.controller.enqueue(this.formatEvent(event));
        } catch {
          disconnected.push(clientId);
        }
      }

      // Clean up disconnected clients
      for (const clientId of disconnected) {
        this.removeClient(clientId);
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳机制
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 关闭所有客户端
   */
  closeAll(): void {
    this.stopHeartbeat();

    for (const [clientId, client] of this.clients) {
      try {
        client.controller.close();
      } catch {
        // ignore
      }
    }

    this.clients.clear();
    this.jobClients.clear();
    this.eventHandlers = [];
  }
}

// 全局单例
const GLOBAL_KEY = '__novel2screenplay_sse_manager__';

export function getSSEClientManager(): SSEClientManager {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new SSEClientManager();
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as SSEClientManager;
  }
  return new SSEClientManager();
}
