/**
 * 调试日志脱敏（FIX-23）
 *
 * 落盘（JSONL）前对条目做深遍历脱敏：密钥/JWT/邮箱/手机号掩码，超长文本 hash 化。
 * 内存环形缓冲保持原文（仅本地调试可见，见 conversation-logger.append 的持久化分支）。
 */
import { createHash } from 'crypto';

/** 超过该长度的文本不再落盘原文，替换为 sha256 前缀标记 */
const LONG_TEXT_LIMIT = 2000;

const API_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;

export function redactString(value: string): string {
  let out = value
    .replace(API_KEY_RE, 'sk-***')
    .replace(BEARER_RE, 'Bearer ***')
    .replace(JWT_RE, 'jwt:***')
    .replace(EMAIL_RE, '***@***')
    .replace(PHONE_RE, '[phone]');

  if (out.length > LONG_TEXT_LIMIT) {
    const hash = createHash('sha256').update(out).digest('hex').slice(0, 16);
    out = `[long-text sha256:${hash} len=${out.length}]`;
  }
  return out;
}

/** 深遍历脱敏：字符串按规则处理；对象/数组递归；其余原样返回 */
export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(item);
    }
    return out as unknown as T;
  }
  return value;
}
