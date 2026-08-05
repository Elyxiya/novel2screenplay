export const MAX_SCENE_TOKENS = 1500;
export const MAX_ANALYSIS_TOKENS = 30000;
export const MAX_SEGMENT_TOKENS = 8000;

/**
 * Lazily-loaded singleton tiktoken encoding.
 * Loading the BPE rank table (cl100k_base, includes wasm) is expensive
 * (50-300ms). Reusing a single instance across all token counting calls
 * removes that per-call overhead entirely.
 */
let encodingPromise: Promise<import('tiktoken').Tiktoken> | null = null;

async function getEncoding(): Promise<import('tiktoken').Tiktoken> {
  if (!encodingPromise) {
    encodingPromise = import('tiktoken').then(({ get_encoding }) =>
      get_encoding('cl100k_base'),
    );
  }
  return encodingPromise;
}

/** Token count with tiktoken; falls back to char-length estimation on failure. */
async function countTokens(text: string): Promise<number | null> {
  try {
    const enc = await getEncoding();
    return enc.encode(text).length;
  } catch { return null; }
}

export class ContextManager {
  async countTokens(text: string): Promise<number> {
    const r = await countTokens(text);
    return r ?? Math.ceil(text.length * 1.3);
  }

  async truncateToTokens(text: string, maxTokens: number): Promise<string> {
    const r = await countTokens(text);
    if (r === null || r <= maxTokens) return text;
    // Estimate character ratio and slice
    const ratio = maxTokens / r;
    const sliceLen = Math.floor(text.length * ratio);
    return text.slice(0, sliceLen) + '\n\n[内容已截断...]';
  }

  async isSceneTooLong(text: string): Promise<boolean> {
    const r = await countTokens(text);
    if (r === null) return false;
    return r > MAX_SCENE_TOKENS;
  }

  /** Synchronous fallback that only uses character-length estimation */
  splitIntoChunks(text: string, maxTokens: number): string[] {
    const maxChars = Math.floor(maxTokens / 1.3);
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push(text.slice(i, i + maxChars));
    }
    return chunks;
  }
}
