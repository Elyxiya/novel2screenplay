/**
 * Postgres sync-facade 的 worker 线程入口。
 *
 * 独立事件循环运行 pg 查询；通过 SharedArrayBuffer + Atomics 与主线程同步握手。
 * 主线程（懒加载 postgres-runner）并不直接持有 pg 连接，只有本 worker 用它。
 *
 * workerData: { sab: SharedArrayBuffer, connectionString: string }
 */

import { workerData } from 'node:worker_threads';
import pg from 'pg';
import {
  HEAP_OFFSET,
  MODE_CODE,
  SLOT_ERR,
  SLOT_FRAME,
  SLOT_MODE,
  SLOT_OVERFLOW,
  SLOT_REQ_LEN,
  SLOT_RES_LEN,
  SLOT_TYPE,
  TYPE_EXEC,
  BRIDGE_TIMEOUT_MS,
} from './postgres-bridge-protocol.js';

interface WorkerPayload {
  sab: SharedArrayBuffer;
  connectionString: string;
}
const payload = workerData as WorkerPayload;

const sab = payload.sab;
const control = new Int32Array(sab, 0, 8);
const bytes = new Uint8Array(sab);
const capacity = bytes.byteLength;

// int8（BIGINT，OID 20）默认以字符串返回；转为 Number 保持与 SQLite INTEGER 一致
// （时间戳/计数都在 Number.MAX_SAFE_INTEGER 内，无精度损失）
pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));

const { Pool } = pg;
const pool = new Pool({ connectionString: payload.connectionString });

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 把结果写入共享缓冲并通知主线程。overflow 分支只写 OVERFLOW 槽。 */
function respond(bodyStr: string): void {
  const bodyBytes = encoder.encode(bodyStr);
  const needed = HEAP_OFFSET + bodyBytes.byteLength;
  if (needed > capacity) {
    Atomics.store(control, SLOT_OVERFLOW, needed);
    Atomics.store(control, SLOT_RES_LEN, 0);
    Atomics.store(control, SLOT_ERR, 0);
    Atomics.notify(control, SLOT_FRAME);
    return;
  }
  bytes.set(bodyBytes, HEAP_OFFSET);
  Atomics.store(control, SLOT_RES_LEN, bodyBytes.byteLength);
  Atomics.store(control, SLOT_OVERFLOW, 0);
  Atomics.store(control, SLOT_ERR, 0);
  Atomics.notify(control, SLOT_FRAME);
}

function respondError(message: string): void {
  const bodyBytes = encoder.encode(message);
  Atomics.store(control, SLOT_RES_LEN, bodyBytes.byteLength);
  bytes.set(bodyBytes, HEAP_OFFSET);
  Atomics.store(control, SLOT_ERR, 1);
  Atomics.store(control, SLOT_OVERFLOW, 0);
  Atomics.notify(control, SLOT_FRAME);
}

async function handleRequest(): Promise<void> {
  const mode = Atomics.load(control, SLOT_MODE);
  const type = Atomics.load(control, SLOT_TYPE);
  const reqLen = Atomics.load(control, SLOT_REQ_LEN);
  const raw = decoder.decode(bytes.subarray(HEAP_OFFSET, HEAP_OFFSET + reqLen));
  const [sql, params] = JSON.parse(raw) as [string, unknown[]];

  try {
    let result: { rows: Record<string, unknown>[]; rowCount: number | null };
    if (type === TYPE_EXEC) {
      result = (await pool.query(sql)) as { rows: Record<string, unknown>[]; rowCount: number | null };
    } else {
      result = (await pool.query(sql, params ?? [])) as { rows: Record<string, unknown>[]; rowCount: number | null };
    }
    const rows = result.rows ?? [];
    const changes = result.rowCount ?? 0;
    let lastInsertRowid: bigint | number = 0;
    if (rows.length > 0 && rows[0]?.id !== undefined && rows[0]?.id !== null) {
      lastInsertRowid = rows[0].id as bigint | number;
    }
    const body = JSON.stringify({
      rows,
      changes,
      lastInsertRowid,
      mode: mode === MODE_CODE.run ? 'run' : mode === MODE_CODE.get ? 'get' : 'all',
    });
    respond(body);
  } catch (err) {
    respondError(err instanceof Error ? err.message : String(err));
  }
}

// 主循环：等待请求 → 处理 → 回写。响应后 FRAME 归零由主线程发起下一次请求时重写。
while (true) {
  Atomics.wait(control, SLOT_FRAME, 0, BRIDGE_TIMEOUT_MS);
  if (Atomics.load(control, SLOT_FRAME) !== 1) {
    // 主线程未发起请求（仅超时）；继续等待
    continue;
  }
  await handleRequest();
  // 处理结束仍需把 FRAME 复位为 0，通知主线程「已完成」
  Atomics.store(control, SLOT_FRAME, 0);
  Atomics.notify(control, SLOT_FRAME);
}