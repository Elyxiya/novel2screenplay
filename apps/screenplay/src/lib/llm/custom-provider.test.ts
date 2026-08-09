import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomOpenAIProvider, parseCustomOpenAISettings } from './CustomOpenAIProvider';
import {
  CustomAnthropicProvider,
  parseCustomAnthropicSettings,
} from './CustomAnthropicProvider';

const originalFetch = globalThis.fetch;

function mockFetchOnce(impl: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  };
}

/** 构造 SSE ReadableStream 响应体 */
function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(new TextEncoder().encode(c));
      }
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CustomOpenAIProvider（OpenAI 兼容格式）', () => {
  it('按 OpenAI 协议发送请求并解析响应（带 Bearer 鉴权）', async () => {
    let calledUrl = '';
    let calledInit: RequestInit | undefined;
    mockFetchOnce(async (url, init) => {
      calledUrl = String(url);
      calledInit = init;
      return jsonResponse({
        choices: [{ message: { content: '你好' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4o-mini',
      });
    });

    const p = new CustomOpenAIProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      name: 'Custom OpenAI',
      defaultModel: 'gpt-4o-mini',
      supportedModels: ['gpt-4o-mini', 'gpt-4o'],
      contextWindow: 128000,
    });

    const res = await p.chat([{ role: 'user', content: 'hi' }], { temperature: 0.5 });

    expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
    expect((calledInit?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(calledInit?.body));
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0.5);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);

    expect(res.content).toBe('你好');
    expect(res.usage?.totalTokens).toBe(15);
  });

  it('baseUrl 不带 /v1 时自动补齐 /v1/chat/completions', async () => {
    let calledUrl = '';
    mockFetchOnce(async (url) => {
      calledUrl = String(url);
      return jsonResponse({ choices: [{ message: { content: '' } }] });
    });

    const p = new CustomOpenAIProvider({
      baseUrl: 'https://my-proxy.com',
      apiKey: 'sk-test',
      name: 'Custom OpenAI',
      defaultModel: 'gpt-4o-mini',
      supportedModels: ['gpt-4o-mini'],
      contextWindow: 128000,
    });
    await p.chat([{ role: 'user', content: 'hi' }]);
    expect(calledUrl).toBe('https://my-proxy.com/v1/chat/completions');
  });

  it('未配置 API Key 时不发送 Authorization 头（本地服务）', async () => {
    let calledInit: RequestInit | undefined;
    mockFetchOnce(async (_url, init) => {
      calledInit = init;
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    });

    const p = new CustomOpenAIProvider({
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      name: 'Local',
      defaultModel: 'llama3',
      supportedModels: ['llama3'],
      contextWindow: 128000,
    });
    await p.chat([{ role: 'user', content: 'hi' }]);

    expect((calledInit?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('parseCustomOpenAISettings 按环境变量解析多模型并去重', () => {
    vi.stubEnv('CUSTOM_OPENAI_BASE_URL', 'https://x/v1');
    vi.stubEnv('CUSTOM_OPENAI_API_KEY', 'k');
    vi.stubEnv('CUSTOM_OPENAI_MODEL', 'gpt-4o-mini');
    vi.stubEnv('CUSTOM_OPENAI_MODELS', 'gpt-4o,gpt-4o-mini,claude-3-5');
    const s = parseCustomOpenAISettings();
    expect(s?.supportedModels).toEqual(['gpt-4o-mini', 'gpt-4o', 'claude-3-5']);
    vi.unstubAllEnvs();
  });

  it('未配置 CUSTOM_OPENAI_BASE_URL 时返回 null', () => {
    vi.stubEnv('CUSTOM_OPENAI_BASE_URL', '');
    expect(parseCustomOpenAISettings()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('CustomAnthropicProvider（Anthropic 原生格式）', () => {
  it('使用 x-api-key / anthropic-version，system 拆出顶层字段，解析 content 与 usage', async () => {
    let calledUrl = '';
    let calledInit: RequestInit | undefined;
    mockFetchOnce(async (url, init) => {
      calledUrl = String(url);
      calledInit = init;
      return jsonResponse({
        content: [{ type: 'text', text: '你' }, { type: 'text', text: '好' }],
        usage: { input_tokens: 20, output_tokens: 8 },
        model: 'claude-sonnet-4-20250514',
      });
    });

    const p = new CustomAnthropicProvider({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
      name: 'Custom Claude',
      defaultModel: 'claude-sonnet-4-20250514',
      supportedModels: ['claude-sonnet-4-20250514'],
      contextWindow: 200000,
    });

    const res = await p.chat(
      [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: 'hi' },
      ],
      { temperature: 0.3 },
    );

    expect(calledUrl).toBe('https://api.anthropic.com/v1/messages');
    const headers = calledInit?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers.Authorization).toBeUndefined();
    const body = JSON.parse(String(calledInit?.body));
    expect(body.system).toBe('你是助手');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.temperature).toBe(0.3);

    expect(res.content).toBe('你好');
    expect(res.usage?.promptTokens).toBe(20);
    expect(res.usage?.totalTokens).toBe(28);
  });

  it('流式解析 Anthropic content_block_delta（并兼容 OpenAI 格式代理）', async () => {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m1"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"世"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    mockFetchOnce(async () => ({
      ok: true,
      status: 200,
      body: sseBody(chunks),
      json: async () => ({}),
    }));

    const p = new CustomAnthropicProvider({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
      name: 'Custom Claude',
      defaultModel: 'claude-sonnet-4-20250514',
      supportedModels: ['claude-sonnet-4-20250514'],
      contextWindow: 200000,
    });

    const parts: string[] = [];
    for await (const chunk of p.chatStream([{ role: 'user', content: 'hi' }])) {
      if (chunk.type === 'text') parts.push(chunk.content ?? '');
    }
    expect(parts.join('')).toBe('你好世');
  });

  it('parseCustomAnthropicSettings 按环境变量解析', () => {
    vi.stubEnv('CUSTOM_ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
    vi.stubEnv('CUSTOM_ANTHROPIC_API_KEY', 'sk-ant');
    vi.stubEnv('CUSTOM_ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022');
    const s = parseCustomAnthropicSettings();
    expect(s?.defaultModel).toBe('claude-3-5-sonnet-20241022');
    expect(s?.apiKey).toBe('sk-ant');
    vi.unstubAllEnvs();
  });
});
