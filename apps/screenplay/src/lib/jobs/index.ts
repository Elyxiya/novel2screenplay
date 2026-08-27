/**
 * Jobs 模块导出
 *
 * 【p1-2 收敛 · arch-baseline】
 * 主执行链路为 `PipelineEngine + jobStore`（SQLite），见 ../pipeline。
 * 本目录仅保留：
 * - 共享类型定义（types.ts，被 pipeline/executor、flow-evaluator 复用）
 * - 剧本快照（screenplay-snapshot.ts，P0 接入）
 * 早期内存队列实现（job-queue.ts / worker.ts）已删除，收敛为单一执行主线。
 */

export * from './types';
export * from './screenplay-snapshot';
