/**
 * Jobs 模块导出
 *
 * 【预留模块 · p1-2 收敛（D6）】
 * 本目录为早期内存队列执行系统的实现，现已在架构上标记为预留：
 * - 主执行链路为 `PipelineEngine + jobStore`（SQLite），见 ../pipeline
 * - 本目录仅保留类型定义（types.ts 被 executor/flow-evaluator 等复用）
 *   与队列实现（job-queue.ts / worker.ts），当前无任何消费方
 * - 不新增依赖、不接入新功能；如需启用请重新评估与主链路的一致性
 */

export * from './types';
export * from './job-queue';
export * from './worker';
// PipelineExecutor 在 pipeline 模块中
export { PipelineExecutor, getExecutor, type ExecuteOptions, type ExecuteResult } from '../pipeline/executor';
