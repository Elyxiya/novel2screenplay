/**
 * Token Bucket rate limiter.
 * Limits requests to a specified rate (RPM - requests per minute).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;

  /**
   * @param maxTokens - Maximum burst capacity (typically RPM value)
   * @param intervalMs - Refill interval in ms (default = 60s for RPM)
   */
  constructor(maxTokens: number, intervalMs = 60_000) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens; // start full
    this.lastRefill = Date.now();
    this.refillIntervalMs = intervalMs;
  }

  /** Refill tokens based on elapsed time */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.refillIntervalMs) {
      // Full refill
      const periods = Math.floor(elapsed / this.refillIntervalMs);
      this.tokens = Math.min(this.maxTokens, this.tokens + periods * this.maxTokens);
      this.lastRefill = now - (elapsed % this.refillIntervalMs);
    }
  }

  /** Try to consume one token. Returns true if allowed, false if rate limited. */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }

  /**
   * Wait until a token is available.
   * Resolves immediately if tokens available, otherwise waits and retries.
   */
  async wait(signal?: AbortSignal): Promise<void> {
    while (!this.tryConsume()) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // Wait 200ms before retrying
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 200);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        }
      });
    }
  }

  /** Get current token count (for monitoring) */
  get availableTokens(): number {
    this.refill();
    return this.tokens;
  }
}
