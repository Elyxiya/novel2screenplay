/**
 * PostgresRunner（worker + Atomics 同步桥）——主线程侧实现
 *
 * 将 org 层的同步调用（run/get/all/exec）发给 worker 线程执行，主线程用
 * Atomics.wait 阻塞至结果回写，从而对调用方保持「同步」语义。
 * 默认缓冲 16MB；结果超大时抛明确错误（自动增长留待后续）。
 */

import { Worker } from 'node:worker_threads';
import {
  BRIDGE_TIMEOUT_MS,
  DEFAULT_BRIDGE_BUFFER,
  HEAP_OFFSET,
  MODE_CODE,
  SLOT_ERR,
  SLOT_FRAME,
  SLOT_MODE,
  SLOT_OVERFLOW,
  SLOT_REQ_LEN,
  SLOT_RES_LEN,
  SLOT_SEQ,
  SLOT_TYPE,
  TYPE_EXEC,
  TYPE_QUERY,
} from './postgres-bridge-protocol.js';
import type { PgOp, PgOpResult, PgSyncRunner } from './postgres-engine.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface PostgresWorkerRunnerOptions {
  bufferSize?: number;
}

export function createPostgresWorkerRunner(connectionString: string, opts: PostgresWorkerRunnerOptions = {}): PgSyncRunner {
  return new PostgresWorkerRunner(connectionString, opts);
}

class PostgresWorkerRunner implements PgSyncRunner {
  private readonly sab: SharedArrayBuffer;
  private readonly control: Int32Array;
  private readonly bytes: Uint8Array;
  private readonly capacity: number;
  private readonly worker: Worker;
  private seq = 0;

  constructor(connectionString: string, opts: PostgresWorkerRunnerOptions) {
    this.capacity = opts.bufferSize ?? DEFAULT_BRIDGE_BUFFER;
    this.sab = new SharedArrayBuffer(this.capacity);
    this.control = new Int32Array(this.sab, 0, 8);
    this.bytes = new Uint8Array(this.sab);

    this.worker = new Worker(new URL('./postgres-worker.worker.js', import.meta.url), {
      workerData: { sab: this.sab, connectionString },
    });
    this.worker.on('error', (err) => {
      // worker 异常不阻塞调用方；真正错误以 ERR 槽回传
      console.error('[PG bridge] worker error:', err);
    });
  }

  sync(op: PgOp): PgOpResult {
    const payload = JSON.stringify([op.sql, op.params ?? []]);
    const reqBytes = encoder.encode(payload);
    if (HEAP_OFFSET + reqBytes.byteLength > this.capacity) {
      throw new Error(`PG bridge: request too large (${reqBytes.byteLength}B > ${this.capacity}B)`);
    }

    this.seq += 1;
    Atomics.store(this.control, SLOT_SEQ, this.seq);
    Atomics.store(this.control, SLOT_MODE, MODE_CODE[op.mode]);
    Atomics.store(this.control, SLOT_TYPE, op.mode === 'exec' ? TYPE_EXEC : TYPE_QUERY);
    Atomics.store(this.control, SLOT_REQ_LEN, reqBytes.byteLength);
    this.bytes.set(reqBytes, HEAP_OFFSET);
    Atomics.store(this.control, SLOT_RES_LEN, 0);
    Atomics.store(this.control, SLOT_OVERFLOW, 0);
    Atomics.store(this.control, SLOT_ERR, 0);
    Atomics.store(this.control, SLOT_FRAME, 1);
    Atomics.notify(this.control, SLOT_FRAME, 1);

    // 阻塞等待 worker 把 FRAME 复位为 0
    for (;;) {
      const status = Atomics.wait(this.control, SLOT_FRAME, 1, BRIDGE_TIMEOUT_MS);
      if (Atomics.load(this.control, SLOT_FRAME) === 0) break;
      if (status === 'timed-out') {
        throw new Error(`PG bridge: worker timeout after ${BRIDGE_TIMEOUT_MS}ms`);
      }
    }

    const overflow = Atomics.load(this.control, SLOT_OVERFLOW);
    if (overflow > 0) {
      throw new Error(`PG bridge: result (${overflow}B) exceeds buffer (${this.capacity}B); increase bufferSize`);
    }
    const bodyLen = Atomics.load(this.control, SLOT_RES_LEN);
    const bodyStr = decoder.decode(this.bytes.subarray(HEAP_OFFSET, HEAP_OFFSET + bodyLen));
    if (Atomics.load(this.control, SLOT_ERR) === 1) {
      throw new Error(`PG error: ${bodyStr}`);
    }
    return JSON.parse(bodyStr) as PgOpResult;
  }

  close(): void {
    try {
      void this.worker.terminate();
    } catch {
      // 已关闭时忽略
    }
  }
}