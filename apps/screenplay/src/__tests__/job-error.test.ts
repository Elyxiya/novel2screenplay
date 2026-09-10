import { describe, it, expect } from 'vitest';
import {
  classifyJobError,
  toJobErrorPayload,
  parseJobError,
  formatJobError,
  llmHttpError,
} from '@/lib/errors';
import { parseErrorCode } from '@/lib/jobs/metrics';

describe('classifyJobError（FIX-22 错误分类）', () => {
  it('HTTP 状态码优先分类：429/401/403/5xx/4xx', () => {
    expect(classifyJobError(llmHttpError('DeepSeek API error: rate limited', 429))).toBe('rate_limit');
    expect(classifyJobError(llmHttpError('OpenAI API error: invalid key', 401))).toBe('auth');
    expect(classifyJobError(llmHttpError('Custom API error: forbidden', 403))).toBe('auth');
    expect(classifyJobError(llmHttpError('Custom API error: upstream', 500))).toBe('provider_5xx');
    expect(classifyJobError(llmHttpError('Custom API error: upstream', 502))).toBe('provider_5xx');
    expect(classifyJobError(llmHttpError('Custom API error: bad request', 400))).toBe('provider_4xx');
    expect(classifyJobError(llmHttpError('Custom API error: gone', 404))).toBe('provider_4xx');
  });

  it('消息级识别：限流/认证/信息不足/超时', () => {
    expect(classifyJobError(new Error('API 限流，请稍后重试'))).toBe('rate_limit');
    expect(classifyJobError(new Error('Invalid API key provided'))).toBe('auth');
    expect(classifyJobError(new Error('LLM 报告原文信息不足'))).toBe('insufficient_context');
    expect(classifyJobError(new Error('请求超时'))).toBe('timeout');
    expect(classifyJobError(new Error('HTTP 503 Service Unavailable'))).toBe('provider_5xx');
  });

  it('AbortError → aborted（含超时触发的中断）', () => {
    expect(classifyJobError(new DOMException('This operation was aborted', 'AbortError'))).toBe('aborted');
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    expect(classifyJobError(aborted)).toBe('aborted');
  });

  it('未知错误 → internal', () => {
    expect(classifyJobError(new Error('something odd'))).toBe('internal');
    expect(classifyJobError(undefined)).toBe('internal');
  });
});

describe('toJobErrorPayload', () => {
  it('包含 code/message 与上下文（phase/provider/httpStatus）', () => {
    const payload = toJobErrorPayload(llmHttpError('DeepSeek API error: rate limited', 429), {
      phase: 3,
      provider: 'deepseek-chat',
    });

    expect(payload.code).toBe('rate_limit');
    expect(payload.message).toContain('DeepSeek API error');
    expect(payload.phase).toBe(3);
    expect(payload.provider).toBe('deepseek-chat');
    expect(payload.httpStatus).toBe(429);
  });

  it('非 Error 输入不抛异常', () => {
    const payload = toJobErrorPayload('string failure');
    expect(payload.code).toBe('internal');
    expect(payload.message).toBe('string failure');
  });
});

describe('parseJobError / formatJobError（读取端兼容）', () => {
  it('结构化 JSON → payload；format 带阶段前缀', () => {
    const raw = JSON.stringify({ code: 'rate_limit', message: 'API 限流', phase: 3 });
    expect(parseJobError(raw)?.code).toBe('rate_limit');
    expect(formatJobError(raw)).toBe('[Phase 3] API 限流');
  });

  it('无 phase 时 format 只回 message', () => {
    const raw = JSON.stringify({ code: 'internal', message: 'fail' });
    expect(formatJobError(raw)).toBe('fail');
  });

  it('旧字符串原样返回；空值 → 空串', () => {
    expect(parseJobError('模型调用超时')).toBeNull();
    expect(formatJobError('模型调用超时')).toBe('模型调用超时');
    expect(formatJobError(undefined)).toBe('');
  });

  it('损坏 JSON / 缺字段 → 视为旧格式', () => {
    expect(parseJobError('{"code":123}')).toBeNull();
    expect(parseJobError('{"broken"')).toBeNull();
    expect(formatJobError('{"code":123}')).toBe('{"code":123}');
  });
});

describe('与聚合侧 parseErrorCode 的一致性', () => {
  it('结构化 payload 与旧字符串在 metrics 里都能出码', () => {
    const structured = JSON.stringify(toJobErrorPayload(llmHttpError('rate limited', 429)));
    expect(parseErrorCode(structured)).toBe('rate_limit');
    expect(parseErrorCode('未配置 LLM Provider')).toBe('legacy');
  });
});
