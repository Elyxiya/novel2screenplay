/**
 * 任务错误结构化（FIX-22）
 *
 * 目标：把 jobs.error 从"纯文本字符串"升级为可聚合、可按码分派重试的结构化 JSON，
 * 同时保持读取端向后兼容（旧字符串原样显示）。
 *
 * 存储形态：jobs.error = JSON.stringify(JobErrorPayload)（列类型不变，零迁移）。
 * 读取端：
 * - 路由层透传原始 error 并附带 errorText（格式化后的可读消息）；
 * - UI 优先显示 errorText；
 * - 聚合侧（lib/jobs/metrics.parseErrorCode）已兼容 JSON 与旧字符串两种形态。
 */

export type JobErrorCode =
  | 'rate_limit'        // 429 / 限流
  | 'auth'              // 401/403 / key 无效
  | 'timeout'           // 请求超时（消息级识别）
  | 'aborted'           // 中断（含超时触发的 AbortError，两者无法可靠区分）
  | 'provider_5xx'      // 提供方 5xx
  | 'provider_4xx'      // 提供方 4xx（除 401/403/429）
  | 'insufficient_context' // LLM 报告原文信息不足
  | 'internal';         // 其余一律归此码

export interface JobErrorPayload {
  code: JobErrorCode;
  message: string;
  /** 失败发生时所处阶段（1-4） */
  phase?: number;
  sceneIndex?: number;
  provider?: string;
  httpStatus?: number;
  retryCount?: number;
}

/** LLM 提供方 HTTP 错误：携带状态码，供分类器判码 */
export class LLMHttpError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = 'LLMHttpError';
    this.httpStatus = httpStatus;
  }
}

export function llmHttpError(message: string, httpStatus: number): LLMHttpError {
  return new LLMHttpError(message, httpStatus);
}

function isAbortError(err: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function extractHttpStatus(err: unknown): number | undefined {
  const direct = (err as { httpStatus?: unknown })?.httpStatus;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const message = err instanceof Error ? err.message : String(err ?? '');
  const match = message.match(/HTTP\s*(\d{3})/i) ?? message.match(/status(?:Code)?["':=\s]*(\d{3})/i);
  return match ? Number(match[1]) : undefined;
}

export function classifyJobError(err: unknown): JobErrorCode {
  if (isAbortError(err)) return 'aborted';

  const message = err instanceof Error ? err.message : String(err ?? '');
  const status = extractHttpStatus(err);

  if (status === 429 || /rate.?limit|429|限流/i.test(message)) return 'rate_limit';
  if (status === 401 || status === 403 || /unauthorized|invalid.*api.?key|api key|认证|密钥无效/i.test(message)) return 'auth';
  if (status !== undefined && status >= 500 && status < 600) return 'provider_5xx';
  if (status !== undefined && status >= 400 && status < 500) return 'provider_4xx';
  if (/insufficient_context|信息不足/.test(message)) return 'insufficient_context';
  if (/timeout|timed?\s*out|超时|ETIMEDOUT/i.test(message)) return 'timeout';
  return 'internal';
}

export function toJobErrorPayload(
  err: unknown,
  ctx: { phase?: number; sceneIndex?: number; provider?: string; retryCount?: number } = {},
): JobErrorPayload {
  const status = extractHttpStatus(err);
  return {
    code: classifyJobError(err),
    message: err instanceof Error ? err.message : String(err ?? '未知错误'),
    ...(ctx.phase !== undefined ? { phase: ctx.phase } : {}),
    ...(ctx.sceneIndex !== undefined ? { sceneIndex: ctx.sceneIndex } : {}),
    ...(ctx.provider !== undefined ? { provider: ctx.provider } : {}),
    ...(status !== undefined ? { httpStatus: status } : {}),
    ...(ctx.retryCount !== undefined ? { retryCount: ctx.retryCount } : {}),
  };
}

/** 解析已落库的 jobs.error：结构化 JSON → payload；旧字符串/损坏值 → null */
export function parseJobError(raw: string | undefined): JobErrorPayload | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { code?: unknown }).code === 'string' &&
      typeof (parsed as { message?: unknown }).message === 'string'
    ) {
      return parsed as JobErrorPayload;
    }
  } catch {
    // 旧格式：纯文本
  }
  return null;
}

/** 读取端格式化：结构化 → message（可带阶段前缀）；旧字符串原样返回；空值 → '' */
export function formatJobError(raw: string | undefined): string {
  if (!raw) return '';
  const payload = parseJobError(raw);
  if (!payload) return raw;
  return payload.phase !== undefined ? `[Phase ${payload.phase}] ${payload.message}` : payload.message;
}
