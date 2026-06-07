import type { LLMProvider, LLMMessage, LLMChatOptions, LLMChatResponse, LLMStreamChunk } from './types';

/**
 * Abstract base class for HTTP-based LLM providers.
 * Provides shared logic: fetch with timeout, retry, token estimation.
 */
export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: string;
  abstract readonly modelId: string;
  abstract readonly description: string;
  abstract readonly contextWindow: number;
  protected abstract readonly baseUrl: string;
  protected abstract readonly apiKey: string;

  abstract chat(messages: LLMMessage[], options?: LLMChatOptions): Promise<LLMChatResponse>;
  abstract chatStream(messages: LLMMessage[], options?: LLMChatOptions): AsyncGenerator<LLMStreamChunk>;

  supportsJSONMode(): boolean {
    return true;
  }

  async estimateTokens(text: string): Promise<number> {
    try {
      const { get_encoding } = await import('tiktoken') as typeof import('tiktoken');
      const encoding = get_encoding('cl100k_base');
      const count = encoding.encode(text).length;
      encoding.free();
      return count;
    } catch {
      return Math.ceil(text.length * 1.3);
    }
  }

  /**
   * Fetch with timeout and retry logic.
   * - Timeout: 30s via AbortSignal
   * - Retry: up to 2 attempts with exponential backoff (1s, 3s)
   */
  protected async fetchWithRetry(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    retries = 2,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const modelName = (body as Record<string, unknown>)?.model ?? 'unknown';

    for (let attempt = 0; attempt <= retries; attempt++) {
      // Create a timeout controller for this attempt
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), 30_000);

      // Combine external signal with timeout signal
      const combinedSignal = signal
        ? combineAbortSignals(signal, timeoutController.signal)
        : timeoutController.signal;

      const t0 = Date.now();
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
        const elapsed = Date.now() - t0;

        if (response.status === 429 && attempt < retries) {
          console.log(`[LLM] ${modelName} 429 限流 (${elapsed}ms, attempt ${attempt + 1}/${retries + 1}), 等待后重试`);
          const backoffMs = attempt === 0 ? 1000 : 3000;
          await delay(backoffMs);
          continue;
        }

        if (!response.ok && attempt < retries) {
          const bodyText = await response.text().catch(() => '');
          console.log(`[LLM] ${modelName} HTTP ${response.status} (${elapsed}ms, attempt ${attempt + 1}/${retries + 1}), 等待后重试: ${bodyText.slice(0, 200)}`);
          const backoffMs = attempt === 0 ? 1000 : 3000;
          await delay(backoffMs);
          continue;
        }

        console.log(`[LLM] ${modelName} ${response.status} (${elapsed}ms, attempt ${attempt + 1}/${retries + 1})`);
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - t0;
        if (attempt < retries) {
          console.log(`[LLM] ${modelName} 请求失败 (${elapsed}ms, attempt ${attempt + 1}/${retries + 1}): ${(error as Error).message}，等待后重试`);
          const backoffMs = attempt === 0 ? 1000 : 3000;
          await delay(backoffMs);
          continue;
        }
        console.log(`[LLM] ${modelName} 请求失败 (${elapsed}ms, attempt ${attempt + 1}/${retries + 1}): ${(error as Error).message}，已耗尽重试次数`);
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new Error(`Failed after ${retries + 1} attempts`);
  }

  /** Shared streaming fetch */
  protected async *streamFetch(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamChunk> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });

    if (!response.ok) {
      yield { type: 'error', error: `HTTP ${response.status}: ${response.statusText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              yield { type: 'text', content };
            }
          } catch {
            // Skip unparseable chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'done' };
  }
}

/** Combine two AbortSignals into one */
function combineAbortSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  s1.addEventListener('abort', onAbort, { once: true });
  s2.addEventListener('abort', onAbort, { once: true });
  if (s1.aborted || s2.aborted) controller.abort();
  return controller.signal;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
