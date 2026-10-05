// Speed limits: a token bucket per limit (one for all downloads, one per download). Port of
// app/src/main/modules/downloads/limiter.ts, unchanged in logic. A transfer asks how long to wait
// after each chunk; while it waits its channel is suspended, so Necko stops reading the socket and
// TCP back-pressure slows the server down.

export class RateLimiter {
  #tokens = 0;
  #last = Date.now();
  #kbps;

  /** `kbps` is a function read on every call, so a changed setting applies at once. 0 = no limit. */
  constructor(kbps) {
    this.#kbps = kbps;
  }

  /** Milliseconds to wait before reading more, having just read `bytes`. */
  take(bytes) {
    const rate = this.#kbps() * 1024;
    const now = Date.now();
    if (rate <= 0) {
      this.#tokens = 0;
      this.#last = now;
      return 0;
    }
    // Half a second of burst, so short pauses don't add up to a slower average.
    this.#tokens = Math.min(rate * 0.5, this.#tokens + ((now - this.#last) / 1000) * rate);
    this.#last = now;
    this.#tokens -= bytes;
    return this.#tokens >= 0 ? 0 : Math.ceil((-this.#tokens / rate) * 1000);
  }
}

/** The longest wait any of the limits asks for. */
export function throttle(limiters, bytes) {
  let wait = 0;
  for (const l of limiters) wait = Math.max(wait, l.take(bytes));
  return wait;
}
