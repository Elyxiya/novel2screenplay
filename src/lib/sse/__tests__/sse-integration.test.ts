/**
 * SSE Integration Tests
 *
 * 测试 SSE 客户端管理器和流推送功能。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSSEClientManager } from '../sse-client-manager';

describe('SSE Client Manager', () => {
  let manager: ReturnType<typeof getSSEClientManager>;

  beforeEach(() => {
    manager = getSSEClientManager();
    manager.closeAll();
  });

  afterEach(() => {
    manager.closeAll();
  });

  describe('client registration', () => {
    it('should register a new client', () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;

      const result = manager.addClient('job_123', mockController);
      expect(result.clientId).toBeDefined();
      expect(result.cleanup).toBeDefined();
      expect(manager.getTotalClients()).toBe(1);
    });

    it('should register multiple clients for same job', () => {
      const mockController1 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;
      const mockController2 = {
        enqueue: vi.fn(),
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;

      manager.addClient('job_123', mockController1);
      manager.addClient('job_123', mockController2);

      expect(manager.getJobClientCount('job_123')).toBe(2);
      expect(manager.getTotalClients()).toBe(2);
    });
  });

  describe('sendToJob', () => {
    it('should send event to all clients of a job', () => {
      const enqueue1 = vi.fn();
      const enqueue2 = vi.fn();

      const mockController1 = {
        enqueue: enqueue1,
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;
      const mockController2 = {
        enqueue: enqueue2,
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;

      manager.addClient('job_123', mockController1);
      manager.addClient('job_123', mockController2);

      manager.sendToJob('job_123', {
        type: 'progress',
        data: { progress: 50 },
        timestamp: Date.now(),
      });

      expect(enqueue1).toHaveBeenCalled();
      expect(enqueue2).toHaveBeenCalled();
    });

    it('should not send to clients of different jobs', () => {
      const enqueue1 = vi.fn();
      const enqueue2 = vi.fn();

      const mockController1 = {
        enqueue: enqueue1,
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;
      const mockController2 = {
        enqueue: enqueue2,
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;

      manager.addClient('job_123', mockController1);
      manager.addClient('job_456', mockController2);

      manager.sendToJob('job_123', {
        type: 'progress',
        data: { progress: 50 },
        timestamp: Date.now(),
      });

      expect(enqueue1).toHaveBeenCalled();
      expect(enqueue2).not.toHaveBeenCalled();
    });
  });

  describe('client cleanup', () => {
    it('should remove client on cleanup', () => {
      const mockController = {
        enqueue: vi.fn(),
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;

      const { clientId, cleanup } = manager.addClient('job_123', mockController);
      expect(manager.getTotalClients()).toBe(1);

      cleanup();
      expect(manager.getTotalClients()).toBe(0);
    });

    it('should handle cleanup for non-existent client', () => {
      expect(() => {
        const { cleanup } = manager.addClient('job_123', {
          enqueue: vi.fn(),
          close: vi.fn(),
        } as unknown as ReadableStreamDefaultController<Uint8Array>);
        cleanup();
        cleanup(); // 调用两次应该不会报错
      }).not.toThrow();
    });
  });

  describe('broadcast', () => {
    it('should broadcast to all clients', () => {
      const enqueue1 = vi.fn();
      const enqueue2 = vi.fn();
      const enqueue3 = vi.fn();

      const mockController1 = {
        enqueue: enqueue1,
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;
      const mockController2 = {
        enqueue: enqueue2,
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;
      const mockController3 = {
        enqueue: enqueue3,
        close: vi.fn(),
      } as unknown as ReadableStreamDefaultController<Uint8Array>;

      manager.addClient('job_123', mockController1);
      manager.addClient('job_456', mockController2);
      manager.addClient('job_789', mockController3);

      manager.broadcast({
        type: 'heartbeat',
        data: { timestamp: Date.now() },
        timestamp: Date.now(),
      });

      expect(enqueue1).toHaveBeenCalled();
      expect(enqueue2).toHaveBeenCalled();
      expect(enqueue3).toHaveBeenCalled();
    });
  });

  describe('closeAll', () => {
    it('should close all clients', () => {
      const close1 = vi.fn();
      const close2 = vi.fn();

      const mockController1 = {
        enqueue: vi.fn(),
        close: close1,
      } as unknown as ReadableStreamDefaultController<Uint8Array>;
      const mockController2 = {
        enqueue: vi.fn(),
        close: close2,
      } as unknown as ReadableStreamDefaultController<Uint8Array>;

      manager.addClient('job_123', mockController1);
      manager.addClient('job_456', mockController2);

      expect(manager.getTotalClients()).toBe(2);

      manager.closeAll();

      expect(manager.getTotalClients()).toBe(0);
    });
  });
});
