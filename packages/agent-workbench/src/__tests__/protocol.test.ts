// __tests__/protocol.test.ts
// 点 3 桥协议单测：schema 校验 / origin 白名单 / 伪造 origin 拒绝 / 事件往返。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WORKBENCH_ORIGIN_ALLOWLIST,
  isTrustedOrigin,
  isValidProtocolMessage,
  createOriginGuard,
  WorkbenchMessageIncoming,
} from '../bridge/protocol';

describe('isValidProtocolMessage（schema 校验）', () => {
  it('接受合法的 inbound 消息（带 type/_v/refId）', () => {
    expect(isValidProtocolMessage({ type: 'workbench:start', refId: 'r1', _v: 1, payload: { novelText: 'x' } })).toBe(true);
    expect(isValidProtocolMessage({ type: 'workbench:hello', refId: 'r2', _v: 1 })).toBe(true);
    expect(isValidProtocolMessage({ type: 'workbench:review', refId: 'r3', _v: 1, payload: { taskId: 't', phaseId: 'p', action: 'approve' } })).toBe(true);
    expect(isValidProtocolMessage({ type: 'workbench:revise', refId: 'r4', _v: 1, payload: { taskId: 't', phaseId: 'p', instruction: 'i' } })).toBe(true);
  });

  it('拒绝缺少 _v 版本、缺 type、或 type 不在白名单的消息', () => {
    expect(isValidProtocolMessage({ type: 'workbench:start', refId: 'r' })).toBe(false); // 缺 _v
    expect(isValidProtocolMessage({ refId: 'r', _v: 1, payload: {} })).toBe(false); // 缺 type
    expect(isValidProtocolMessage({ type: 'workbench:evil', refId: 'r', _v: 1 })).toBe(false); // type 不在白名单
  });

  it('拒绝非对象 / null', () => {
    expect(isValidProtocolMessage(null)).toBe(false);
    expect(isValidProtocolMessage('hello')).toBe(false);
    expect(isValidProtocolMessage(42)).toBe(false);
  });
});

describe('isTrustedOrigin（origin 白名单）', () => {
  it('白名单内的 origin 通过', () => {
    expect(WORKBENCH_ORIGIN_ALLOWLIST.length).toBeGreaterThan(0);
    for (const o of WORKBENCH_ORIGIN_ALLOWLIST) {
      expect(isTrustedOrigin(o)).toBe(true);
    }
  });

  it('伪造 origin / 空值被拒绝', () => {
    expect(isTrustedOrigin('https://evil.example.com')).toBe(false);
    expect(isTrustedOrigin('http://localhost:9999')).toBe(false);
    expect(isTrustedOrigin('')).toBe(false);
    expect(isTrustedOrigin(null)).toBe(false);
    expect(isTrustedOrigin(undefined)).toBe(false);
  });
});

describe('createOriginGuard（伪造 origin 拒绝）', () => {
  let handler: ReturnType<typeof vi.fn>;
  let guard: (ev: MessageEvent) => void;
  beforeEach(() => {
    handler = vi.fn();
    guard = createOriginGuard(handler as (msg: WorkbenchMessageIncoming) => void);
  });

  it('合法结构 + 白名单 origin → 投递 handler', () => {
    guard({ origin: 'http://localhost:3004', data: { type: 'workbench:start', refId: 'r', _v: 1, payload: {} } } as MessageEvent);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('伪造 origin（非白名单）→ 不投递', () => {
    guard({ origin: 'https://evil.example.com', data: { type: 'workbench:start', refId: 'r', _v: 1, payload: {} } } as MessageEvent);
    expect(handler).not.toHaveBeenCalled();
  });

  it('白名单 origin 但非法结构 → 不投递', () => {
    guard({ origin: 'http://localhost:3002', data: { type: 'workbench:unknown', _v: 1 } } as MessageEvent);
    expect(handler).not.toHaveBeenCalled();
  });

  it('事件往返：host 回推 workbench:event 事件被同名 handler 消费（agent 事件不变形）', () => {
    const agentEvent = { event: 'task_start', taskId: 't1' };
    const outbound = { type: 'workbench:event', refId: 'r', _v: 1, payload: agentEvent };
    guard({ origin: 'http://localhost:3004', data: outbound } as MessageEvent);
    expect(handler).toHaveBeenCalledTimes(1);
    const received = handler.mock.calls[0][0] as (typeof outbound);
    expect(received.payload).toEqual(agentEvent);
    expect(received.type).toBe('workbench:event');
  });
});