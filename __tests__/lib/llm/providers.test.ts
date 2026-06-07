import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenBucket } from '../../../src/lib/llm/rate-limiter';
import { DeepSeekProvider } from '../../../src/lib/llm/DeepSeekProvider';
import { OpenAIProvider } from '../../../src/lib/llm/OpenAIProvider';
import { LLMProviderRegistry, initializeProviders } from '../../../src/lib/llm/registry';

describe('TokenBucket', () => {
  it('should allow requests within rate limit', () => {
    const bucket = new TokenBucket(5, 60_000);
    for (let i = 0; i < 5; i++) {
      expect(bucket.tryConsume()).toBe(true);
    }
  });

  it('should block requests exceeding rate limit', () => {
    const bucket = new TokenBucket(3, 60_000);
    for (let i = 0; i < 3; i++) {
      bucket.tryConsume();
    }
    expect(bucket.tryConsume()).toBe(false);
  });

  it('should refill tokens over time', async () => {
    const bucket = new TokenBucket(10, 100); // 10 tokens per 100ms
    for (let i = 0; i < 10; i++) {
      bucket.tryConsume();
    }
    expect(bucket.tryConsume()).toBe(false);
    // Wait for refill
    await new Promise((r) => setTimeout(r, 150));
    expect(bucket.availableTokens).toBeGreaterThan(0);
  });
});

describe('DeepSeekProvider', () => {
  let provider: DeepSeekProvider;

  beforeEach(() => {
    provider = new DeepSeekProvider('test-key');
  });

  it('should have correct configuration', () => {
    expect(provider.name).toBe('DeepSeek');
    expect(provider.modelId).toBe('deepseek-chat');
    expect(provider.contextWindow).toBe(65536);
    expect(provider.supportsJSONMode()).toBe(true);
  });

  it('should estimate tokens for Chinese text', async () => {
    const text = '你好，世界';
    const tokens = await provider.estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should throw on invalid API key (mock test)', async () => {
    // Mock fetch to simulate error
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    });

    await expect(
      provider.chat([{ role: 'user', content: 'test' }]),
    ).rejects.toThrow('DeepSeek API error');
  });
});

describe('OpenAIProvider', () => {
  it('should have correct configuration', () => {
    const provider = new OpenAIProvider('test-key');
    expect(provider.name).toBe('OpenAI');
    expect(provider.modelId).toBe('gpt-4o');
    expect(provider.contextWindow).toBe(128000);
  });
});

describe('LLMProviderRegistry', () => {
  it('should register and retrieve providers', () => {
    const registry = new LLMProviderRegistry();
    const deepseek = new DeepSeekProvider('key1');
    const openai = new OpenAIProvider('key2');

    registry.register(deepseek);
    registry.register(openai);

    expect(registry.get('deepseek')).toBe(deepseek);
    expect(registry.get('openai')).toBe(openai);
    expect(registry.getAll()).toHaveLength(2);
  });

  it('should return undefined for unregistered providers', () => {
    const registry = new LLMProviderRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should handle case-insensitive lookups', () => {
    const registry = new LLMProviderRegistry();
    registry.register(new DeepSeekProvider('key'));
    expect(registry.get('DeepSeek')).toBeDefined();
    expect(registry.get('DEEPSEEK')).toBeDefined();
  });

  it('should initialize from env vars', () => {
    // Should not throw even without API keys
    expect(() => initializeProviders()).not.toThrow();
  });
});
