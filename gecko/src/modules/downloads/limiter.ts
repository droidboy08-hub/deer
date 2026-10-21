// Speed limits: a token bucket per limit (one for all downloads, one per download). Port of
// app/src/main/modules/downloads/limiter.ts, unchanged in logic. A transfer asks how long to wait
// after each chunk; while it waits its channel is suspended, so Necko stops reading the socket and
// TCP back-pressure slows the server down.

export class RateLimiter {
  private tokens = 0;
  private last = Date.now();

  /** `kbps` is read on every call, so a changed setting applies at once. 0 means no limit. */
  constructor(private kbps: () => number) {}

  /** When take() last asked a transfer to wait: the limit was holding the speed down then. */
  private waitedAt = 0;

  /** A limit is set now. */
  get limited(): boolean {
    return this.kbps() > 0;
  }

  /**
   * A limit is set and held the speed down within the last `ms`: connections run at the speeds it gives
   * them, so ranged.ts tick() leaves them be. A limit the line never reaches does not count.
   */
  binding(ms: number): boolean {
    return this.kbps() > 0 && Date.now() - this.waitedAt < ms;
  }

  /** Milliseconds to wait before reading more, having just read `bytes`. */
  take(bytes: number): number {
    const rate = this.kbps() * 1024;
    const now = Date.now();
    if (rate <= 0) {
      this.tokens = 0;
      this.last = now;
      return 0;
    }
    // Half a second of burst, so short pauses don't add up to a slower average.
    this.tokens = Math.min(rate * 0.5, this.tokens + ((now - this.last) / 1000) * rate);
    this.last = now;
    this.tokens -= bytes;
    if (this.tokens >= 0) return 0;
    this.waitedAt = now;
    return Math.ceil((-this.tokens / rate) * 1000);
  }
}

/** The longest wait any of the limits asks for. */
export function throttle(limiters: RateLimiter[], bytes: number): number {
  let wait = 0;
  for (const l of limiters) wait = Math.max(wait, l.take(bytes));
  return wait;
}
