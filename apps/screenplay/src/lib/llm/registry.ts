import type { LLMProvider } from './types';
import { DeepSeekProvider } from './DeepSeekProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { getCustomOpenAIProvider } from './CustomOpenAIProvider';
import { getCustomAnthropicProvider } from './CustomAnthropicProvider';

/**
 * Registry for LLM providers.
 * Supports registration by name and retrieval.
 */
export class LLMProviderRegistry {
  private providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider): void {
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  get(name: string): LLMProvider | undefined {
    const direct = this.providers.get(name.toLowerCase());
    if (direct) return direct;
    // 支持按模型 ID 查找（自定义 Provider 注册了多模型）
    return this.getAll().find((p) => p.supportedModels?.includes(name));
  }

  getAll(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  /** Get a provider that supports JSON mode */
  getForJSONMode(): LLMProvider | undefined {
    return this.getAll().find((p) => p.supportsJSONMode());
  }

  getDefault(): LLMProvider | undefined {
    // 自定义 API（显式配置）优先，其次 DeepSeek，最后任意支持 JSON 模式的 Provider
    return (
      this.get('custom-anthropic') ||
      this.get('custom-openai') ||
      this.get('deepseek') ||
      this.getForJSONMode()
    );
  }
}

/** Singleton registry instance */
export const llmRegistry = new LLMProviderRegistry();

/**
 * Initialize providers from environment variables.
 * Call this once at app startup.
 */
export function initializeProviders(): void {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (deepseekKey) {
    llmRegistry.register(new DeepSeekProvider(deepseekKey));
  }

  if (openaiKey) {
    llmRegistry.register(new OpenAIProvider(openaiKey));
  }

  // 自定义 API（OpenAI 兼容 / Anthropic 原生格式）
  const customOpenAI = getCustomOpenAIProvider();
  if (customOpenAI) {
    llmRegistry.register(customOpenAI);
  }
  const customAnthropic = getCustomAnthropicProvider();
  if (customAnthropic) {
    llmRegistry.register(customAnthropic);
  }

  if (
    process.env.NODE_ENV === 'development' &&
    !deepseekKey &&
    !openaiKey &&
    !customOpenAI &&
    !customAnthropic
  ) {
    console.warn(
      '[novel2screenplay] No API keys configured. Set DEEPSEEK_API_KEY / OPENAI_API_KEY，或自定义 API：CUSTOM_OPENAI_BASE_URL / CUSTOM_ANTHROPIC_BASE_URL in .env.local',
    );
  }
}
