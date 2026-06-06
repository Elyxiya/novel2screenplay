import { getEncoding } from 'tiktoken';

/** Max tokens per scene before splitting */
export const MAX_SCENE_TOKENS = 1500;

/** Max tokens for Phase 1 analysis input */
export const MAX_ANALYSIS_TOKENS = 30000;

/** Max tokens for Phase 2 per chapter */
export const MAX_SEGMENT_TOKENS = 8000;

/**
 * Token-aware context manager.
 * Uses tiktoken cl100k_base for accurate estimation.
 */
export class ContextManager {
  private encoding: ReturnType<typeof getEncoding> | null = null;

  private getEncoding(): ReturnType<typeof getEncoding> {
    if (!this.encoding) {
      try {
        this.encoding = getEncoding('cl100k_base');
      } catch {
        return null as unknown as ReturnType<typeof getEncoding>;
      }
    }
    return this.encoding;
  }

  /** Count tokens in text using tiktoken */
  countTokens(text: string): number {
    const enc = this.getEncoding();
    if (enc) return enc.encode(text).length;
    // Fallback for Chinese text
    return Math.ceil(text.length * 1.3);
  }

  /** Truncate text to fit within maxTokens */
  truncateToTokens(text: string, maxTokens: number): string {
    const enc = this.getEncoding();
    if (enc) {
      const tokens = enc.encode(text);
      if (tokens.length <= maxTokens) return text;
      return enc.decode(tokens.slice(0, maxTokens));
    }
    // Fallback: rough character-based truncation
    const maxChars = Math.floor(maxTokens / 1.3);
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '\n\n[内容已截断...]';
  }

  /** Split text into chunks that fit within maxTokens */
  splitIntoChunks(text: string, maxTokens: number): string[] {
    const enc = this.getEncoding();
    if (enc) {
      const tokens = enc.encode(text);
      if (tokens.length <= maxTokens) return [text];

      const chunks: string[] = [];
      for (let i = 0; i < tokens.length; i += maxTokens) {
        const chunk = enc.decode(tokens.slice(i, i + maxTokens));
        chunks.push(chunk);
      }
      return chunks;
    }
    // Fallback: character-based splitting
    const maxChars = Math.floor(maxTokens / 1.3);
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push(text.slice(i, i + maxChars));
    }
    return chunks;
  }

  /** Check if scene text exceeds the limit and needs splitting */
  isSceneTooLong(text: string): boolean {
    return this.countTokens(text) > MAX_SCENE_TOKENS;
  }
}
