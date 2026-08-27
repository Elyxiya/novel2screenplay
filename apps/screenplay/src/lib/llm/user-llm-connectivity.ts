/**
 * UserLLM 连通性测试
 *
 * 对一条已导入的用户 LLM 配置发起一次最小对话请求，验证 baseUrl / apiKey /
 * 默认模型是否真实连通。供「测试连通性」按钮与 API 使用。
 *
 * 设计：默认用 createUserLLMProvider 构造实验实例（不影响已热注册的缓存实例），
 * 便于测试注入 fake provider 以做确定性单测，不触网。
 */

import type { LLMProvider } from './types';
import { createUserLLMProvider } from './user-llm-factory';
import type { UserLLMRecord } from '../store/sqlite';

export interface ConnectivityResult {
  ok: boolean;
  latencyMs: number;
  /** 连通时回显模型 */
  model?: string;
  message: string;
}

const TIMEOUT_MS = 15000;

/** 制造带超时的 AbortSignal（兼容 AbortSignal.timeout 缺失的环境） */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return (AbortSignal as { timeout: (m: number) => AbortSignal }).timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export async function testUserLLMConnection(
  record: UserLLMRecord,
  create: (r: UserLLMRecord) => LLMProvider = createUserLLMProvider,
): Promise<ConnectivityResult> {
  const provider = create(record);
  const t0 = Date.now();
  try {
    const res = await provider.chat(
      [{ role: 'user', content: 'ping' }],
      { maxTokens: 5, signal: timeoutSignal(TIMEOUT_MS) },
    );
    const latencyMs = Date.now() - t0;
    return {
      ok: true,
      latencyMs,
      model: res.model || record.defaultModel,
      message: '连接正常',
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs, message: `连接失败：${reason}` };
  }
}