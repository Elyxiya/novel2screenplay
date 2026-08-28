/**
 * Postgres sync-facade（worker + Atomics）跨线程共享协议
 *
 * 背景：node-postgres（pg）是异步驱动，无法在 JS 主线程同步 await。
 * 为满足 DbEngine「同步语义、调用方零改动」，把 pg 查询放在一个 worker 线程里，
 * 主线程通过 SharedArrayBuffer + Atomics.wait 同步等待结果——worker 自有事件循环，
 * 其异步 pool.query 可自由完成，主线程阻塞期间互不干扰。
 *
 * 约定：两侧都必须按本文件索引读到同一块内存。SAB 作为 workerData 传入，worker 侧
 * 基于同一块内存自建 view。本文件被主线程与 worker 共同 import。
 */

export type PgBridgeMode = 'run' | 'get' | 'all' | 'exec';

/** 控制槽（Int32Array 元素索引） */
export const SLOT_FRAME = 0; // 主线程置 1（请求就绪）/ worker 置 0（已响应）
export const SLOT_MODE = 1; // PgBridgeMode 数字码
export const SLOT_TYPE = 2; // 0 query，1 exec/ddl
export const SLOT_REQ_LEN = 3; // 请求体 JSON 字节长度
export const SLOT_RES_LEN = 4; // 响应体 JSON 字节长度
export const SLOT_OVERFLOW = 5; // 结果超长时所需字节数
export const SLOT_ERR = 6; // 0 正常，1 出错（响应体为错误消息）
export const SLOT_SEQ = 7; // 请求序号（调试用）

export const CONTROL_SLOTS = 8;
/** 数据区起始字节偏移（CONTROL_SLOTS 个 int32） */
export const HEAP_OFFSET = CONTROL_SLOTS * 4;

export const MODE_CODE: Record<PgBridgeMode, number> = { run: 0, get: 1, all: 2, exec: 3 };
export const TYPE_QUERY = 0;
export const TYPE_EXEC = 1;

export const DEFAULT_BRIDGE_BUFFER = 16 * 1024 * 1024; // 16MB，覆盖 drama_yaml 等大文本
export const BRIDGE_TIMEOUT_MS = 60_000;