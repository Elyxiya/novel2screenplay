import type { LLMProvider } from './types';
import { DeepSeekProvider } from './DeepSeekProvider';
import { OpenAIProvider } from './OpenAIProvider';

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
    return this.providers.get(name.toLowerCase());
  }

  getAll(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  /** Get a provider that supports JSON mode */
  getForJSONMode(): LLMProvider | undefined {
    return this.getAll().find((p) => p.supportsJSONMode());
  }

  getDefault(): LLMProvider | undefined {
    return this.get('deepseek') || this.getForJSONMode();
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

  if (process.env.NODE_ENV === 'development' && !deepseekKey && !openaiKey) {
    console.warn(
      '[novel2screenplay] No API keys configured. Set DEEPSEEK_API_KEY or OPENAI_API_KEY in .env.local',
    );
  }
}
