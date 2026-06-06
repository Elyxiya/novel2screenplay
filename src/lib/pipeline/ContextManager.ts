import { get_encoding } from 'tiktoken';

export const MAX_SCENE_TOKENS = 1500;
export const MAX_ANALYSIS_TOKENS = 30000;
export const MAX_SEGMENT_TOKENS = 8000;

const decoder = new TextDecoder();

export class ContextManager {
  private encoding: ReturnType<typeof get_encoding> | null = null;

  private getEnc(): ReturnType<typeof get_encoding> {
    if (!this.encoding) {
      try { this.encoding = get_encoding('cl100k_base'); }
      catch { return null as unknown as ReturnType<typeof get_encoding>; }
    }
    return this.encoding;
  }

  countTokens(text: string): number {
    const enc = this.getEnc();
    if (enc) return enc.encode(text).length;
    return Math.ceil(text.length * 1.3);
  }

  truncateToTokens(text: string, maxTokens: number): string {
    const enc = this.getEnc();
    if (enc) {
      const tokens = enc.encode(text);
      if (tokens.length <= maxTokens) return text;
      const decoded = enc.decode(tokens.slice(0, maxTokens));
      return decoder.decode(decoded);
    }
    const maxChars = Math.floor(maxTokens / 1.3);
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '\n\n[内容已截断...]';
  }

  splitIntoChunks(text: string, maxTokens: number): string[] {
    const enc = this.getEnc();
    if (enc) {
      const tokens = enc.encode(text);
      if (tokens.length <= maxTokens) return [text];
      const chunks: string[] = [];
      for (let i = 0; i < tokens.length; i += maxTokens) {
        const decoded = enc.decode(tokens.slice(i, i + maxTokens));
        chunks.push(decoder.decode(decoded));
      }
      return chunks;
    }
    const maxChars = Math.floor(maxTokens / 1.3);
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push(text.slice(i, i + maxChars));
    }
    return chunks;
  }

  isSceneTooLong(text: string): boolean {
    return this.countTokens(text) > MAX_SCENE_TOKENS;
  }
}
