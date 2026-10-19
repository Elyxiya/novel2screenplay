/**
 * 运行中任务的取消注册表（P0）
 *
 * 问题：`PipelineEngine` 是无状态类，每个路由模块都会 `new` 一个实例，而一次转换是
 * 跨阶段的长时间 Promise，状态只落在 DB 里。`cancelJob()` 以前只改 DB 状态，
 * 碰不到「正在跑的那个 Promise」，于是取消后 LLM 仍在调用、任务还会被改回 completed。
 *
 * 方案：把 AbortController 按 jobId 存在进程级注册表里（挂 globalThis，兼容 Next dev
 * 热重载与多路由模块实例），由执行链路持有 signal，取消时 abort。
 *
 * 边界：注册表是进程内的——与当前「长任务在 API 进程内执行」的运行模型一致。
 * 多实例部署下取消只能命中所连实例上的任务（与 SSE 客户端注册表同一限制）。
 */

const GLOBAL_KEY = '__novel2screenplay_cancel_registry__';

type Registry = Map<string, AbortController>;

function getRegistry(): Registry {
  const g = globalThis as Record<string, unknown>;
  if (!(g[GLOBAL_KEY] instanceof Map)) {
    g[GLOBAL_KEY] = new Map<string, AbortController>();
  }
  return g[GLOBAL_KEY] as Registry;
}

/** 注册（或复用）一个任务的取消控制器；已被取消过的任务重新注册会拿到新的控制器。 */
export function registerJobAbort(jobId: string): AbortController {
  const registry = getRegistry();
  const existing = registry.get(jobId);
  if (existing && !existing.signal.aborted) return existing;

  const controller = new AbortController();
  registry.set(jobId, controller);
  return controller;
}

/** 取消一个任务；返回是否命中正在运行的任务。 */
export function abortJob(jobId: string): boolean {
  const controller = getRegistry().get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** 任务结束（成功 / 失败 / 取消收尾）后释放注册表项。 */
export function releaseJobAbort(jobId: string): void {
  getRegistry().delete(jobId);
}

/** 判断任务当前是否已被取消。 */
export function isJobAborted(jobId: string): boolean {
  return getRegistry().get(jobId)?.signal.aborted ?? false;
}

/** 判断异常是否来自取消（各运行时抛出的 AbortError 类型不完全一致）。 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { name?: unknown }).name === 'AbortError';
}

/** 阶段边界守卫：已取消则抛出 AbortError，让执行链停止写后续状态。 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Pipeline aborted by user', 'AbortError');
  }
}
